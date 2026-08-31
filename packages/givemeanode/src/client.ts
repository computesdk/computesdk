/**
 * The HTTP transport for the givemeanode ComputeSDK provider, and the only
 * place the signed credential is handled.
 *
 * Deliberately dependency-free, and deliberately separate from `index.ts`.
 * Everything subtle about this provider lives here - the credential
 * migration, its cache key, its lifetime arithmetic - and none of it needs
 * `@computesdk/provider` to be exercised, so it can be unit tested on its
 * own against a stub `fetch`.
 *
 * ## The signed credential
 *
 * Authenticating a request costs a round trip that presenting a signed
 * credential does not. givemeanode hands one back on the response to any
 * request made with a `gmnt_` bearer:
 *
 *   gmn-fast-token:         gmns_<compact JWT>
 *   gmn-fast-token-expires: 2026-08-30T19:48:19Z
 *
 * A request presenting that credential skips the ordinary authentication
 * work. Every failure falls back to the ordinary challenge, so a
 * credential this client cannot use is never worse than not having one.
 *
 * There is nothing to configure and nothing new to store: the offer rides
 * on a response the caller was already making, and the `gmnt_` token stays
 * the only secret anyone holds.
 */

/** The response header carrying the signed credential. */
export const FAST_TOKEN_HEADER = 'gmn-fast-token'

/** The response header carrying that credential's expiry, RFC 3339. */
export const FAST_TOKEN_EXPIRES_HEADER = 'gmn-fast-token-expires'

/**
 * How much of a credential's life to leave unused.
 *
 * Not politeness, the round trip: a credential that expires while the
 * request is in flight comes back 401 and costs an iteration. These are
 * issued with a deliberately short lifetime, so the margin has to be sized
 * by the network rather than as a fraction of it.
 */
const EXPIRY_MARGIN_MS = 2_000

/**
 * The life to assume when the expiry header is missing or unparseable.
 *
 * Short on purpose, and asymmetric on purpose. Guessing LONG hands out a
 * credential past its life and turns every subsequent call into a 401 and
 * a retry; guessing SHORT costs one re-issue, which is one ordinary
 * authentication we would have paid anyway.
 */
const FALLBACK_TTL_MS = 20_000

/**
 * The public endpoint.
 *
 * givemeanode runs one per region and they are not interchangeable for
 * latency: a caller in us-east-1 should point `baseUrl` at the us-east
 * endpoint (`https://api.use1.givemeanode.com`) rather than pay a
 * cross-country round trip on every call.
 */
export const DEFAULT_BASE_URL = 'https://api.givemeanode.com'

/**
 * How this client treats the offer of a signed credential.
 *
 * - `absorb` (default): use a signed credential whenever one has been
 *   handed to us, and never add a round trip to get one. The first request
 *   of a process pays the ordinary cost, its response carries the
 *   credential, and every request after it - including the command that
 *   follows that very first create - is cheaper.
 * - `prime`: pay ONE cheap authenticated request per token, up front and
 *   single-flighted, so even the first burst's creates are cheap. Right
 *   when N sandboxes start at once, because otherwise all N take the
 *   ordinary path.
 * - `off`: never present a signed credential.
 */
export type FastTokenMode = 'absorb' | 'prime' | 'off'

export interface GmnClientOptions {
  /** `gmnt_` org service token. Falls back to `GMN_TOKEN`. */
  apiKey?: string
  /** Base URL. Falls back to `GMN_API_HOST`, then the public endpoint. */
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
 * The signed credentials, keyed by the token they were issued from.
 *
 * MODULE level rather than per client, and that is the load-bearing
 * choice. A signed credential is a property of the `gmnt_` token, not of a
 * connection or of an object: it is valid for every request that token
 * could have made. Benchmark runners and job loops build a fresh provider
 * per task, so a per-instance cache would re-pay the ordinary cost on
 * every one of them and the migration would never take effect. Keyed by
 * base URL as well as by token, so pointing a second client at a different
 * endpoint cannot pick up the first one's credential.
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
    // distinct (endpoint, token) can collide on one key.
    this.cacheKey = `${this.baseUrl}\u0000${this.apiKey}`
  }

  /**
   * The bearer to present: the signed credential while it has margin left,
   * otherwise the `gmnt_` token it was issued from.
   *
   * Never throws and never blocks. A missing or stale signed credential is
   * not an error, it is the ordinary path.
   */
  bearer(now: number = Date.now()): string {
    if (this.fastToken === 'off') return this.apiKey
    const held = vended.get(this.cacheKey)
    if (held && now < held.usableUntil) return held.token
    return this.apiKey
  }

  /** True when the next request will present a signed credential. */
  hasFastToken(now: number = Date.now()): boolean {
    return this.bearer(now) !== this.apiKey
  }

  /**
   * Take the offer off a response, if it carries one.
   *
   * Only a request made with the `gmnt_` token is offered one, which is
   * exactly the point: the request that paid the ordinary cost is the one
   * that hands back the credential letting the next request skip it. A
   * signed credential cannot issue another, so renewal goes back through
   * the token.
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
    // A credential with no usable life left is not worth caching:
    // presenting it would 401 and cost a retry, where not caching costs
    // nothing.
    if (usableUntil <= now) return
    vended.set(this.cacheKey, { token, usableUntil })
  }

  /**
   * Pay one cheap authenticated request so the burst that follows does
   * not have to, single-flighted across every caller sharing the
   * credential.
   *
   * A no-op unless `fastToken: 'prime'` and we do not already hold a
   * usable credential. Failure is swallowed by design: this is an
   * optimisation, and a caller whose prime failed should still get to make
   * its real request and find out why properly.
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

  /**
   * One authenticated call against the API.
   *
   * `timeoutMs` overrides the client's default for this call only.
   * Preparing a container image is the case that needs it: it legitimately
   * takes minutes, and the ordinary timeout is sized for a call that
   * should answer in milliseconds.
   */
  async request<T = any>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<T> {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.timeout)
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
