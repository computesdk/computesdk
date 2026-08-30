/**
 * The HTTP transport for the givemeanode ComputeSDK provider, and the only
 * place the signed fast token is handled.
 *
 * Deliberately dependency-free, and deliberately separate from `index.ts`.
 * Everything subtle about this provider lives here - the credential
 * migration, its cache key, its lifetime arithmetic - and none of it needs
 * `@computesdk/provider` to be exercised, so it can be unit tested on its
 * own against a stub `fetch`.
 *
 * ## The fast token, and why this file exists
 *
 * Every authenticated request on the givemeanode door opens with one
 * indexed database read that resolves the bearer to its org, workspace,
 * scopes and ban state. It is ~15 ms, it can only be served from the
 * primary, and a create-then-exec pays it TWICE.
 *
 * The door removes it for callers that opt in, by handing back a SIGNED
 * credential on the response of any request made with a `gmnt_` bearer:
 *
 *   gmn-fast-token:         gmns_<compact EdDSA JWT>
 *   gmn-fast-token-expires: 2026-08-30T19:48:19Z
 *
 * A request presenting the `gmns_` token is verified in CPU - a signature
 * check and two in-process hash lookups - and touches no database at all.
 * Every failure falls back to the ordinary challenge, so a token this
 * client cannot use is never worse than not having one.
 *
 * There is nothing to configure and nothing new to store: the offer rides
 * on a response the caller was already making, and the `gmnt_` token stays
 * the only secret anyone holds.
 */

/** The response header carrying the door's signed credential. */
export const FAST_TOKEN_HEADER = 'gmn-fast-token'

/** The response header carrying that credential's expiry, RFC 3339. */
export const FAST_TOKEN_EXPIRES_HEADER = 'gmn-fast-token-expires'

/**
 * How much of a token's life to leave unused.
 *
 * Not politeness, the round trip: a token that expires while the request
 * is in flight comes back 401 and costs an iteration. The door mints these
 * with a deliberately short lifetime (it is what bounds the revocation set
 * a region must remember), so the margin has to be sized by the network
 * rather than as a fraction of the TTL.
 */
const EXPIRY_MARGIN_MS = 2_000

/**
 * The life to assume when the expiry header is missing or unparseable.
 *
 * Short on purpose, and asymmetric on purpose. Guessing LONG hands out a
 * token past its life and turns every subsequent call into a 401 and a
 * retry; guessing SHORT costs one re-mint, which is one database read we
 * would have paid anyway.
 */
const FALLBACK_TTL_MS = 20_000

/**
 * The public door.
 *
 * givemeanode runs a door per region and they are not interchangeable for
 * latency: a caller in us-east-1 should point `baseUrl` at the us-east
 * door (`https://api.use1.givemeanode.com`) rather than pay a
 * cross-country round trip on every call.
 */
export const DEFAULT_BASE_URL = 'https://api.givemeanode.com'

/**
 * How this client treats the door's migration offer.
 *
 * - `absorb` (default): use a signed token whenever one has been handed to
 *   us, and never add a round trip to get one. The first request of a
 *   process pays the database read, its response carries the token, and
 *   every request after it - including the exec leg of that very first
 *   create - is served in CPU.
 * - `prime`: pay ONE cheap authenticated request per credential, up front
 *   and single-flighted, so even the first burst's creates are served in
 *   CPU. Right when N sandboxes start at once, because otherwise all N
 *   take their own first call down the database path.
 * - `off`: never present a signed token. Every request pays the read.
 */
export type FastTokenMode = 'absorb' | 'prime' | 'off'

export interface GmnClientOptions {
  /** `gmnt_` org service token. Falls back to `GMN_TOKEN`. */
  apiKey?: string
  /** Door base URL. Falls back to `GMN_API_HOST`, then the public door. */
  baseUrl?: string
  /** See {@link FastTokenMode}. Default `absorb`. */
  fastToken?: FastTokenMode
  /** Per-request timeout in ms. Default 120000. */
  timeout?: number
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch
}

interface Vended {
  token: string
  /** Epoch ms, already reduced by {@link EXPIRY_MARGIN_MS}. */
  usableUntil: number
}

/**
 * The vended credentials, keyed by the credential they were minted from.
 *
 * MODULE level rather than per client, and that is the load-bearing
 * choice. A signed token is a property of the `gmnt_` credential, not of a
 * connection or of an object: it is valid for every request that
 * credential could have made. Benchmark runners and job loops build a
 * fresh provider per task, so a per-instance cache would re-pay the
 * database read on every one of them and the migration would never take
 * effect. Keyed by base URL as well as by token, so pointing a second
 * client at a different door cannot pick up the first one's token.
 */
const vended = new Map<string, Vended>()

/** In-flight primes, so N concurrent creates make one request, not N. */
const priming = new Map<string, Promise<void>>()

/** Test seam: forget every cached credential. */
export function resetFastTokenCache(): void {
  vended.clear()
  priming.clear()
}

export class GmnError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'GmnError'
    this.status = status
    this.body = body
  }
}

export class GmnClient {
  readonly baseUrl: string
  readonly apiKey: string
  readonly fastToken: FastTokenMode
  readonly timeout: number

  private readonly doFetch: typeof fetch
  private readonly cacheKey: string

  constructor(options: GmnClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GMN_TOKEN
    if (!apiKey) {
      throw new Error(
        "Missing givemeanode API token. Pass 'apiKey' in the provider config or set GMN_TOKEN. " +
          'Mint one with `gman token create --name ci --workspace <slug>`.',
      )
    }
    this.apiKey = apiKey
    this.baseUrl = (options.baseUrl ?? process.env.GMN_API_HOST ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.fastToken = options.fastToken ?? 'absorb'
    this.timeout = options.timeout ?? 120_000
    this.doFetch = options.fetch ?? globalThis.fetch
    // A NUL cannot appear in a URL or in a bearer token, so no pair of
    // distinct (door, credential) can collide on one key.
    this.cacheKey = `${this.baseUrl}\u0000${this.apiKey}`
  }

  /**
   * The bearer to present: the signed token while it has margin left,
   * otherwise the `gmnt_` credential it was minted from.
   *
   * Never throws and never blocks. A missing or stale signed token is not
   * an error, it is the ordinary path.
   */
  bearer(now: number = Date.now()): string {
    if (this.fastToken === 'off') return this.apiKey
    const held = vended.get(this.cacheKey)
    if (held && now < held.usableUntil) return held.token
    return this.apiKey
  }

  /** True when the next request will be served without a database read. */
  hasFastToken(now: number = Date.now()): boolean {
    return this.bearer(now) !== this.apiKey
  }

  /**
   * Take the migration offer off a response, if it carries one.
   *
   * Only the `gmnt_` branch of the door vends, which is exactly the point:
   * the request that paid the database read is the one that hands back the
   * credential letting the next request skip it. A signed token may not
   * mint another - renewal deliberately goes back through the credential,
   * because that is where the ban gate runs.
   */
  private absorb(headers: Headers, now: number): void {
    if (this.fastToken === 'off') return
    const token = headers.get(FAST_TOKEN_HEADER)
    if (!token) return
    let ttl = FALLBACK_TTL_MS
    const raw = headers.get(FAST_TOKEN_EXPIRES_HEADER)
    if (raw) {
      const at = Date.parse(raw)
      if (Number.isFinite(at)) ttl = at - now
    }
    const usableUntil = now + ttl - EXPIRY_MARGIN_MS
    // A token with no usable life left is not worth caching: presenting it
    // would 401 and cost a retry, where not caching costs nothing.
    if (usableUntil <= now) return
    vended.set(this.cacheKey, { token, usableUntil })
  }

  /**
   * Pay one cheap authenticated request so the burst that follows does
   * not have to, single-flighted across every caller sharing the
   * credential.
   *
   * A no-op unless `fastToken: 'prime'` and we do not already hold a
   * usable token. Failure is swallowed by design: this is an optimisation,
   * and a caller whose prime failed should still get to make its real
   * request and find out why properly.
   */
  async prime(): Promise<void> {
    if (this.fastToken !== 'prime' || this.hasFastToken()) return
    const inFlight = priming.get(this.cacheKey)
    if (inFlight) return inFlight
    const run = this.request('GET', '/preview/sandboxes')
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        priming.delete(this.cacheKey)
      })
    priming.set(this.cacheKey, run)
    return run
  }

  /** One authenticated call against the door. */
  async request<T = any>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(), this.timeout)
    let response: Response
    try {
      response = await this.doFetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.bearer()}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }
    this.absorb(response.headers, Date.now())
    const text = await response.text()
    let parsed: unknown
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { raw: text.slice(0, 400) }
      }
    }
    if (!response.ok) {
      const detail =
        parsed && typeof parsed === 'object' && 'error' in parsed
          ? String((parsed as { error: unknown }).error)
          : text.slice(0, 400)
      throw new GmnError(
        `givemeanode ${method} ${path} failed (${response.status}): ${detail}`,
        response.status,
        parsed,
      )
    }
    return parsed as T
  }
}
