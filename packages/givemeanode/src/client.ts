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
 *
 * ## One connection for a burst
 *
 * On Node this client speaks HTTP/2 to an `https:` endpoint: one session
 * per client, every request a stream on it, opened when the provider is
 * constructed. Measured from us-east-1 against the us-east door, 100
 * concurrent create-then-command pairs took a median of 211 ms over
 * `fetch` and 40 ms over one HTTP/2 session, and the whole difference was
 * the client: `fetch` opens one TLS connection per in-flight request, and a
 * single-threaded runtime performs those 100 handshakes one after another,
 * so the median create waited ~170 ms for its turn before a byte reached
 * the door. `fetch` stays as the fallback wherever `node:http2` is not
 * there (browsers, edge runtimes) or a session cannot be opened, and it is
 * what an injected `fetch` selects, so tests against a stub are unchanged.
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
 * - `absorb` (default): never add a round trip to get one. The first
 *   request of a process pays the ordinary cost, its response carries the
 *   credential, and every request after it - including the command that
 *   follows that very first create - is cheaper.
 * - `prime`: pay ONE cheap authenticated request per token, up front and
 *   single-flighted, before the first create, so even the first burst's
 *   creates present the signed credential.
 * - `off`: never present a signed credential.
 *
 * The default was `absorb` through 1.0.x, `prime` in 1.1.x, and is
 * `absorb` again from 1.2.0. `prime` was chosen on 2026-09-09 against a
 * door that read its database to validate a `gmnt_` token, so N cold
 * creates queued N of those reads (~600 ms of a 767 ms create at N=100).
 * Later that same day the door began answering a `gmnt_` from an
 * in-memory replica of its token table, and the read the prime avoided
 * stopped costing anything - while the prime itself, a `GET
 * /preview/sandboxes`, is a workspace listing that crosses to the
 * database: 113 to 140 ms on the us-east door with either token. Measured
 * from us-east-1 on 2026-09-18, c100 over one HTTP/2 session, the median
 * time-to-interactive read 56 to 106 ms with no prime and 166 ms with the
 * burst waiting on one.
 */
export type FastTokenMode = 'absorb' | 'prime' | 'off'

/**
 * Which wire the client uses.
 *
 * - `auto` (default): HTTP/2 over one session to an `https:` endpoint on a
 *   runtime with `node:http2`; `fetch` everywhere else, and `fetch` from
 *   then on for a client whose session could not be opened.
 * - `http2`: HTTP/2 to any endpoint the base URL allows, plaintext loopback
 *   included (h2c, prior knowledge) - a test seam and a dev-server choice.
 *   Falls back to `fetch` if `node:http2` is missing or the session fails.
 * - `fetch`: never open a session. The default when a `fetch` is injected.
 */
export type TransportMode = 'auto' | 'http2' | 'fetch'

/**
 * What the provider does with its connection as it is constructed.
 *
 * - `connect` (default): open the HTTP/2 session, so the handshake is
 *   paid while the caller is still setting up. Nothing is sent on it: the
 *   credential first leaves the process with the first operation, which
 *   also pays the `prime`.
 * - `prime`: open the session AND pay the fast-token prime at once,
 *   whatever `fastToken` says short of `off`, so even the first create of
 *   a burst presents the signed credential. An authenticated request
 *   before any operation was asked for, which is why it is the opt-in and
 *   not the default.
 * - `off`: nothing until the first request.
 */
export type WarmMode = 'connect' | 'prime' | 'off'

/** How long a connection attempt may take, the same bound `fetch` applies. */
const CONNECT_TIMEOUT_MS = 10_000

export interface GmnClientOptions {
  /** `gmnt_` org service token. Falls back to `GMN_TOKEN`. */
  apiKey?: string
  /** Base URL. Falls back to `GMN_API_HOST`, then the public endpoint. */
  baseUrl?: string
  /** See {@link FastTokenMode}. Default `prime`. */
  fastToken?: FastTokenMode
  /** Per-request timeout in ms. Default 120000. */
  timeout?: number
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** See {@link TransportMode}. Default `auto`, or `fetch` when `fetch` is injected. */
  transport?: TransportMode
  /** See {@link WarmMode}. Default `connect`. */
  warm?: WarmMode
  /** How long opening the HTTP/2 session may take, in ms. Default 10000. */
  connectTimeout?: number
}

/** What either wire hands back: enough to absorb the credential and parse. */
interface Wire {
  status: number
  headers: Headers
  text: string
}

type Http2 = typeof import('node:http2')
type Http2Session = import('node:http2').ClientHttp2Session

/**
 * `node:http2`, loaded once and lazily, or `null` where there is none.
 * Lazy so that merely importing this package on a runtime without it costs
 * nothing, and so a bundler for such a runtime sees a dynamic import it can
 * leave unresolved rather than a static one it must satisfy.
 */
let http2Load: Promise<Http2 | null> | undefined
function loadHttp2(): Promise<Http2 | null> {
  http2Load ??= import('node:http2').then(
    m => m,
    () => null,
  )
  return http2Load
}

/** The abort `fetch` would have thrown, so callers see one shape. */
function abortError(): Error {
  const err = new Error('The operation was aborted')
  err.name = 'AbortError'
  return err
}

/**
 * `work`, or an abort the moment `signal` fires, whichever comes first.
 * The work itself is not cancelled: it is shared with whoever else waits.
 */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
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

/**
 * The readable half of a refusal.
 *
 * The door answers a refusal with `{"error": {"code", "message"}}`, and
 * the `message` is written to be read - it names the limit that refused,
 * or the alternative that should have been passed instead. Stringifying
 * the object loses exactly that, so a 422 that explained itself arrives as
 * `[object Object]` and the caller has to reconstruct from the outside
 * what the door already said.
 *
 * The string form is still accepted because older deployments answer that
 * way, and an unrecognised shape falls back to its JSON rather than to
 * `[object Object]`: a body we cannot read is still worth showing.
 */
function refusalDetail(parsed: unknown, text: string): string {
  const fallback = () => text.slice(0, 400)
  if (!parsed || typeof parsed !== 'object' || !('error' in parsed)) return fallback()
  const error = (parsed as { error: unknown }).error
  if (typeof error === 'string') return error || fallback()
  if (!error || typeof error !== 'object') return fallback()
  const { code, message } = error as { code?: unknown; message?: unknown }
  const hasMessage = typeof message === 'string' && message !== ''
  const hasCode = typeof code === 'string' && code !== ''
  if (hasMessage) return hasCode ? `${code}: ${message}` : (message as string)
  if (hasCode) return code as string
  try {
    return JSON.stringify(error)?.slice(0, 400) ?? fallback()
  } catch {
    return fallback()
  }
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

/**
 * Refuse to carry a long-lived bearer over plaintext.
 *
 * Every request presents either the `gmnt_` token or a signed credential
 * minted from it, so an `http://` endpoint hands an organization credential
 * to anything on the path. A loopback host is exempt because that is how a
 * local API is developed against, and there is no network to observe.
 */
export function requireSecureBaseUrl(baseUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error(`givemeanode baseUrl is not a valid URL: ${baseUrl}`)
  }
  if (parsed.protocol === 'https:') return baseUrl
  const loopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1' ||
    parsed.hostname === '[::1]'
  if (parsed.protocol === 'http:' && loopback) return baseUrl
  throw new Error(
    `givemeanode baseUrl must use https (got ${parsed.protocol}//${parsed.hostname}). ` +
      'Requests carry a bearer token, so plaintext would expose it; only loopback is exempt.',
  )
}

export class GmnClient {
  readonly baseUrl: string
  readonly apiKey: string
  readonly fastToken: FastTokenMode
  readonly timeout: number
  readonly transport: TransportMode
  readonly warmMode: WarmMode
  readonly connectTimeout: number

  private readonly doFetch: typeof fetch
  private readonly cacheKey: string
  /** The session being opened or open; unset between sessions. */
  private h2?: Promise<Http2Session | null>
  /** Set once a session could not be opened: `fetch` for this client's life. */
  private h2Unavailable = false
  /**
   * Requests in progress, waiting on the session or on the wire. The
   * session's socket is referenced while this is above zero and
   * unreferenced when it returns to zero, so an idle session never keeps
   * a process alive that has nothing left to do.
   */
  private inflight = 0

  constructor(options: GmnClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GMN_TOKEN
    if (!apiKey) {
      throw new Error(
        "Missing givemeanode API token. Pass 'apiKey' in the provider config or set GMN_TOKEN. " +
          'Mint one with `gman token create --name ci --workspace <slug>`.',
      )
    }
    this.apiKey = apiKey
    this.baseUrl = requireSecureBaseUrl(
      (options.baseUrl ?? process.env.GMN_API_HOST ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
    )
    this.fastToken = options.fastToken ?? 'absorb'
    this.timeout = options.timeout ?? 120_000
    this.doFetch = options.fetch ?? globalThis.fetch
    // An injected fetch is a test seam or a deliberate choice of wire, and
    // either way the requests must go through it.
    this.transport = options.transport ?? (options.fetch ? 'fetch' : 'auto')
    this.warmMode = options.warm ?? 'connect'
    this.connectTimeout = options.connectTimeout ?? CONNECT_TIMEOUT_MS
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
   * Do the construction-time work {@link WarmMode} names, ahead of the
   * first real request.
   *
   * Called when the provider is constructed, never awaited by it: the
   * session handshake (and, under `warm: 'prime'`, the credential read)
   * happens while the caller is still setting up, so the first create of a
   * burst finds it done. Every failure is swallowed - the first real
   * request repeats whichever step did not land and reports the error
   * properly. Awaitable, for a caller who wants to know it landed.
   */
  warm(): Promise<void> {
    if (this.warmMode === 'off') return Promise.resolve()
    const work: Promise<unknown> =
      this.warmMode === 'prime' ? Promise.all([this.session(), this.prime(true)]) : this.session()
    return work.then(
      () => undefined,
      () => undefined,
    )
  }

  /**
   * Let the session go. In-flight streams finish first; the next request
   * opens a fresh session. A session still being opened is closed as soon
   * as it lands.
   */
  close(): void {
    const opening = this.h2
    this.h2 = undefined
    if (!opening) return
    void opening.then(
      session => {
        if (session && !session.destroyed) session.close()
      },
      () => undefined,
    )
  }

  /**
   * The HTTP/2 session for this client, opening one if the wire allows,
   * or `null` when requests go over `fetch`.
   *
   * One session per client, shared by every concurrent request; a session
   * that closes or fails is forgotten so the next request opens another.
   * A session that cannot be OPENED at all switches this client to `fetch`
   * for good: an endpoint that does not speak HTTP/2 will not start to,
   * and flapping between wires would cost a failed connect on every call.
   */
  private session(): Promise<Http2Session | null> {
    if (this.transport === 'fetch' || this.h2Unavailable) return Promise.resolve(null)
    if (this.transport === 'auto' && !this.baseUrl.startsWith('https:')) return Promise.resolve(null)
    if (this.h2) return this.h2
    const opening: Promise<Http2Session | null> = loadHttp2().then(http2 => {
      if (!http2) {
        this.h2Unavailable = true
        return null
      }
      return new Promise<Http2Session | null>(resolve => {
        const session = http2.connect(this.baseUrl)
        const forget = () => {
          if (this.h2 === opening) this.h2 = undefined
        }
        let settled = false
        // A handshake that never completes is not a session that failed to
        // open, so nothing above would ever give up on it: bound it here,
        // and treat the bound like the connect error it stands in for.
        const giveUp = () => {
          if (settled) return
          settled = true
          forget()
          this.h2Unavailable = true
          session.destroy()
          resolve(null)
        }
        const deadline = setTimeout(giveUp, this.connectTimeout)
        session.once('connect', () => {
          clearTimeout(deadline)
          if (settled) return
          settled = true
          // Nothing is waiting on it: let the process exit if it wants to.
          if (this.inflight === 0) session.unref()
          resolve(session)
        })
        session.on('error', () => {
          clearTimeout(deadline)
          forget()
          giveUp()
        })
        session.on('close', forget)
        // The peer is going away: let in-flight streams finish, and open a
        // fresh session for whatever comes next.
        session.on('goaway', () => {
          forget()
          session.close()
        })
      })
    })
    this.h2 = opening
    return opening
  }

  /**
   * Pay one cheap authenticated request so the burst that follows does
   * not have to, single-flighted across every caller sharing the
   * credential.
   *
   * A no-op unless `fastToken: 'prime'` - or `force`, which is
   * `warm: 'prime'` asking for it under any mode short of `off` - and we
   * do not already hold a usable credential. Failure is swallowed by design: this is an
   * optimisation, and a caller whose prime failed should still get to make
   * its real request and find out why properly.
   */
  async prime(force = false): Promise<void> {
    if (this.fastToken === 'off' || (!force && this.fastToken !== 'prime') || this.hasFastToken()) return
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
    // A signed credential can be revoked, or its clock can disagree with
    // ours, before the expiry we cached for it. The 401 that follows is not
    // the caller's fault and is not retried by anything above us, so every
    // request would fail until the entry aged out on its own. Drop it and
    // let the `gmnt_` token answer; that retry also absorbs a fresh
    // credential, so the burst after it is fast again.
    //
    // Retrying a POST is safe HERE specifically because a 401 is refused at
    // the door: the request had no effect, so there is nothing to duplicate.
    const presentedSigned = this.hasFastToken()
    try {
      return await this.attempt<T>(method, path, body, signal, timeoutMs)
    } catch (err) {
      if (presentedSigned && err instanceof GmnError && err.status === 401) {
        vended.delete(this.cacheKey)
        return await this.attempt<T>(method, path, body, signal, timeoutMs)
      }
      throw err
    }
  }

  private async attempt<T = any>(
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
    const payload = body === undefined ? undefined : JSON.stringify(body)
    let wire: Wire
    let session: Http2Session | null = null
    this.inflight += 1
    try {
      // Inside the try, so the deadline covers the body too: a response
      // whose headers arrive and whose body then stalls would otherwise
      // hang here with no timer left to abort it. The wait for the session
      // is under the same deadline, without cancelling the open itself,
      // which every other request on this client shares.
      session = await untilAborted(this.session(), controller.signal)
      if (session) session.ref()
      wire = session
        ? await this.overHttp2(session, method, path, payload, controller.signal)
        : await this.overFetch(method, path, payload, controller.signal)
      this.absorb(wire.headers, Date.now())
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
      this.release(session)
    }
    const { status, text } = wire
    let parsed: unknown
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { raw: text.slice(0, 400) }
      }
    }
    if (status < 200 || status >= 300) {
      const detail = refusalDetail(parsed, text)
      throw new GmnError(`givemeanode ${method} ${path} failed (${status}): ${detail}`, status, parsed)
    }
    return parsed as T
  }

  /**
   * One request fewer in flight. At zero the session's socket is
   * unreferenced - the one this request rode, and the current one if the
   * session turned over underneath it - so a process with nothing left to
   * do is free to exit.
   */
  private release(used: Http2Session | null): void {
    this.inflight -= 1
    if (this.inflight !== 0) return
    if (used && !used.destroyed) used.unref()
    void this.h2?.then(
      current => {
        if (current && current !== used && this.inflight === 0 && !current.destroyed) current.unref()
      },
      () => undefined,
    )
  }

  private async overFetch(
    method: string,
    path: string,
    payload: string | undefined,
    signal: AbortSignal,
  ): Promise<Wire> {
    const response = await this.doFetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.bearer()}`,
        'content-type': 'application/json',
      },
      body: payload,
      signal,
    })
    return { status: response.status, headers: response.headers, text: await response.text() }
  }

  /**
   * One request as a stream on the session. A stream that fails before
   * the response is complete rejects the way a `fetch` network error
   * would, and is not retried here: a POST may have been acted on.
   */
  private overHttp2(
    session: Http2Session,
    method: string,
    path: string,
    payload: string | undefined,
    signal: AbortSignal,
  ): Promise<Wire> {
    return new Promise<Wire>((resolve, reject) => {
      if (signal.aborted) {
        reject(abortError())
        return
      }
      const stream = session.request({
        ':method': method,
        ':path': path,
        authorization: `Bearer ${this.bearer()}`,
        'content-type': 'application/json',
      })
      let status = 0
      const headers = new Headers()
      const chunks: Buffer[] = []
      let done = false
      const finish = (fn: () => void) => {
        if (done) return
        done = true
        signal.removeEventListener('abort', onAbort)
        fn()
      }
      const onAbort = () => {
        // NGHTTP2_CANCEL, without importing the constants table for one number.
        stream.close(8)
        finish(() => reject(abortError()))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      stream.on('response', incoming => {
        for (const [name, value] of Object.entries(incoming)) {
          if (name === ':status') status = Number(value)
          else if (name.startsWith(':') || value === undefined) continue
          else if (Array.isArray(value)) for (const v of value) headers.append(name, v)
          else headers.set(name, String(value))
        }
      })
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () =>
        finish(() => resolve({ status, headers, text: Buffer.concat(chunks).toString('utf8') })),
      )
      stream.on('error', err => finish(() => reject(err)))
      // The peer closed the stream without an end: a reset. Same shape as
      // a connection dropped under a fetch.
      stream.on('close', () =>
        finish(() =>
          reject(
            new Error(`givemeanode ${method} ${path}: the HTTP/2 stream closed before the response completed`),
          ),
        ),
      )
      stream.end(payload)
    })
  }
}
