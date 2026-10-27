/**
 * Thin client for the hosted ComputeSDK platform API.
 *
 * This is the single platform transport: `@computesdk/platform` (the SDK
 * provider) and `@computesdk/cli` both use it. Wire types for Actions and
 * sandboxes live in `types.ts` (sandboxes) and in the CLI (Actions); the API
 * is the contract.
 */


export const DEFAULT_BASE_URL = 'https://platform.computesdk.com';

/** Bump with the package version — sent as `User-Agent: @computesdk/platform/<version>`. */
const SDK_VERSION = '0.1.0';

/**
 * Market order codes the platform returns. Retrying never changes the
 * outcome, so errors carrying them are `retryable: false`.
 */
export const MARKET_CODES: ReadonlySet<string> = new Set([
  'market_cap_required',
  'market_access_required',
  'limit_not_met',
  'above_protection_limit',
  'insufficient_credits',
  'no_market_capacity',
  'no_provider_configured',
  'market_lane_not_approved',
]);

/**
 * Codes a `PlatformApiError` can carry — the market order codes, the sandbox
 * lifecycle codes, and `codeForStatus`'s status-table codes. Kept open for
 * codes added later; callers can `switch (err.code)`.
 */
export type PlatformApiErrorCode =
  | 'market_cap_required'
  | 'market_access_required'
  | 'limit_not_met'
  | 'above_protection_limit'
  | 'insufficient_credits'
  | 'no_market_capacity'
  | 'no_provider_configured'
  | 'market_lane_not_approved'
  | 'sandbox_booting'
  | 'idempotency_key_reused'
  | 'bad_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'server_error'
  | 'http_error'
  | (string & {});

export interface PlatformAuth {
  apiKey: string;
  baseUrl: string;
  /** Sent as `X-Org-Slug` when set (--org / COMPUTE_ORG / stored login org). */
  orgSlug?: string;
}
export class PlatformApiError extends Error {
  /** details.code ?? body.code ?? codeForStatus(status) */
  readonly code: PlatformApiErrorCode;
  /** The body's `details` object, when the error response carried one. */
  readonly details?: Record<string, unknown>;
  /** 429/502/503/504 — except market codes, which don't change on retry. */
  readonly retryable: boolean;
  /** Parsed `Retry-After` in ms, when the response carried the header. */
  retryAfterMs?: number;

  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'PlatformApiError';
    const details = errorDetails(body);
    const bodyCode =
      body && typeof body === 'object' && 'code' in body && typeof (body as { code: unknown }).code === 'string'
        ? (body as { code: string }).code
        : undefined;
    this.details = details;
    this.code = (details && typeof details.code === 'string' ? details.code : undefined) ?? bodyCode ?? codeForStatus(status);
    this.retryable =
      !MARKET_CODES.has(this.code) &&
      (status === 429 || status === 502 || status === 503 || status === 504);
  }
}

/** Stable machine-readable codes for errors raised by the client itself. */
export type PlatformClientErrorCode =
  | 'no_credentials'
  | 'untrusted_host'
  | 'untrusted_host_stored_auth'
  | 'insecure_transport'
  | 'invalid_argument'
  | 'stream_ended'
  | 'create_outcome_unknown'
  | 'workflow_not_found'
  | (string & {});

/** An error the client raised before or instead of an API call. */
export class PlatformClientError extends Error {
  /**
   * `false` means falling back to another provider is unsafe — e.g.
   * create_outcome_unknown, where a box may exist and be billing.
   */
  public fallback?: boolean;

  constructor(
    public code: PlatformClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformClientError';
  }
}

/** The `--json` error envelope; `code` is stable, `message` is for humans. */
export interface PlatformErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    /** Present when the platform answered; absent for local/transport failures. */
    httpStatus?: number;
    retryable: boolean;
    /** The platform's `details` object, when its error response carried one. */
    details?: Record<string, unknown>;
  };
}

export function codeForStatus(status: number): string {
  switch (status) {
    case 400: return 'bad_request';
    case 401: return 'unauthenticated';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 413: return 'payload_too_large';
    case 429: return 'rate_limited';
    default: return status >= 500 ? 'server_error' : 'http_error';
  }
}

export function errorDetails(body: unknown): Record<string, unknown> | undefined {
  if (body && typeof body === 'object' && 'details' in body) {
    const details = (body as { details: unknown }).details;
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      return details as Record<string, unknown>;
    }
  }
  return undefined;
}

/**
 * Classify any error thrown by an Actions command. API errors carry the HTTP
 * status; CLI errors carry their own code; a fetch rejection (DNS, refused
 * connection, TLS) is `network`; anything else is `unknown`.
 */
export function toErrorEnvelope(error: unknown): PlatformErrorEnvelope {
  if (error instanceof PlatformApiError) {
    const details = errorDetails(error.body);
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        httpStatus: error.status,
        retryable: error.retryable,
        ...(details !== undefined && { details }),
      },
    };
  }
  if (error instanceof PlatformClientError) {
    return { ok: false, error: { code: error.code, message: error.message, retryable: false } };
  }
  // undici/Node fetch rejects with a TypeError whose cause is the socket error.
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) {
    const cause = (error as { cause?: unknown }).cause;
    const detail = cause instanceof Error ? `: ${cause.message}` : '';
    return {
      ok: false,
      error: { code: 'network', message: `${error.message}${detail}`, retryable: true },
    };
  }
  return {
    ok: false,
    error: {
      code: 'unknown',
      message: error instanceof Error ? error.message : String(error),
      retryable: false,
    },
  };
}

export class PlatformClient {
  constructor(
    private readonly auth: PlatformAuth,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get baseUrl(): string {
    return this.auth.baseUrl;
  }

  async get<T>(
    path: string,
    params?: Record<string, string | string[] | undefined>,
    opts?: RequestOpts,
  ): Promise<T> {
    const url = new URL(`${this.auth.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
    }
    const res = await this.fetchImpl(url, { headers: this.headers(), signal: opts?.signal });
    return this.parse<T>(res);
  }

  async post<T>(path: string, body: Record<string, unknown> = {}, opts?: RequestOpts): Promise<T> {
    const res = await this.fetchImpl(`${this.auth.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    return this.parse<T>(res);
  }

  /**
   * POST JSON and return the raw response body for SSE reading
   * (Accept: text/event-stream). Callers feed it to `readSseNamedEvents`.
   */
  async postStream(
    path: string,
    body: Record<string, unknown> = {},
    opts?: RequestOpts,
  ): Promise<ReadableStream<Uint8Array>> {
    const res = await this.fetchImpl(`${this.auth.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    if (!res.ok) {
      await this.parse(res); // throws
    }
    if (!res.body) throw new PlatformClientError('stream_ended', 'SSE response has no body');
    return res.body;
  }

  /** POST a raw text body (e.g. a unified diff to `/api/v1/actions/patches`). */
  async postText<T>(path: string, body: string, contentType: string, opts?: RequestOpts): Promise<T> {
    const res = await this.fetchImpl(`${this.auth.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': contentType },
      body,
      signal: opts?.signal,
    });
    return this.parse<T>(res);
  }

  async put<T>(path: string, body: Record<string, unknown> = {}, opts?: RequestOpts): Promise<T> {
    const res = await this.fetchImpl(`${this.auth.baseUrl}${path}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    return this.parse<T>(res);
  }

  async patch<T>(path: string, body: Record<string, unknown> = {}, opts?: RequestOpts): Promise<T> {
    const res = await this.fetchImpl(`${this.auth.baseUrl}${path}`, {
      method: 'PATCH',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    return this.parse<T>(res);
  }

  async del<T>(path: string, opts?: RequestOpts): Promise<T> {
    const res = await this.fetchImpl(`${this.auth.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
      signal: opts?.signal,
    });
    return this.parse<T>(res);
  }

  /**
   * One `data:` JSON payload per SSE event. `next()` resolves to the payload,
   * or null when the stream ends. Call `close()` to abort.
   */
  async *sse(
    path: string,
    params?: Record<string, string | string[] | undefined>,
    opts?: RequestOpts,
  ): AsyncGenerator<unknown> {
    const url = new URL(`${this.auth.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
    }
    const res = await this.fetchImpl(url, {
      headers: { ...this.headers(), accept: 'text/event-stream' },
      signal: opts?.signal,
    });
    if (!res.ok) {
      await this.parse(res); // throws
    }
    if (!res.body) throw new Error('SSE response has no body');
    yield* readSseEvents(res.body);
  }

  /**
   * `sse()` with the frame's `event:` name preserved — for streams whose
   * events are distinguished by name rather than payload shape (process
   * follow: stdout/stderr share a `{chunk}` payload).
   */
  async *sseNamed(
    path: string,
    params?: Record<string, string | string[] | undefined>,
    opts?: RequestOpts,
  ): AsyncGenerator<{ event: string; data: unknown }> {
    const url = new URL(`${this.auth.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
    }
    const res = await this.fetchImpl(url, {
      headers: { ...this.headers(), accept: 'text/event-stream' },
      signal: opts?.signal,
    });
    if (!res.ok) {
      await this.parse(res); // throws
    }
    if (!res.body) throw new Error('SSE response has no body');
    yield* readSseNamedEvents(res.body);
  }

  /** Download bytes following redirects (artifact URLs 302 to storage). */
  async download(path: string, opts?: RequestOpts): Promise<Uint8Array> {
    // Follow redirects manually: the bearer token is only ever sent to the
    // origin that authenticated this request — a redirect target elsewhere
    // (a signed storage URL carries its own credentials) must not see it.
    let url = `${this.auth.baseUrl}${path}`;
    let res = await this.fetchImpl(url, {
      headers: this.headers(),
      redirect: 'manual',
      signal: opts?.signal,
    });
    const baseOrigin = new URL(this.auth.baseUrl).origin;
    for (let hops = 0; hops < 5 && res.status >= 300 && res.status < 400; hops += 1) {
      const location = res.headers.get('location');
      if (!location) break;
      const target = new URL(location, url);
      const sameOrigin = target.origin === baseOrigin;
      res = await this.fetchImpl(target, {
        headers: sameOrigin ? this.headers() : { accept: '*/*' },
        redirect: 'manual',
        signal: opts?.signal,
      });
      url = target.toString();
    }
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      throw apiError(res, body);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.auth.apiKey}`,
      accept: 'application/json',
      'user-agent': `@computesdk/platform/${SDK_VERSION}`,
    };
    if (this.auth.orgSlug) headers['X-Org-Slug'] = this.auth.orgSlug;
    return headers;
  }

  private async parse<T>(res: Response): Promise<T> {
    const body = await res.json().catch(() => undefined);
    if (!res.ok) throw apiError(res, body);
    return body as T;
  }
}

function apiError(res: Response, body: unknown): PlatformApiError {
  const error = new PlatformApiError(res.status, errorMessage(body, res.status), body);
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    error.retryAfterMs = Number.isFinite(seconds)
      ? seconds * 1000
      : Math.max(0, new Date(retryAfter).getTime() - Date.now());
  }
  return error;
}

export interface RequestOpts {
  signal?: AbortSignal;
}

function errorMessage(body: unknown, status: number): string {
  let message: string;
  if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
    message = (body as { error: string }).error;
  } else {
    message = `Request failed with status ${status}`;
  }
  // The OAuth layer answers 403 insufficient_scope when the stored login's
  // grant doesn't cover the call — point at re-login rather than leaving the
  // raw error.
  if (
    message.includes('insufficient_scope') ||
    (typeof body === 'object' && body !== null && JSON.stringify(body).includes('insufficient_scope'))
  ) {
    message += ' — run `compute login` to sign in again.';
  }
  const requestId =
    body && typeof body === 'object' && 'requestId' in body && typeof (body as { requestId: unknown }).requestId === 'string'
      ? (body as { requestId: string }).requestId
      : undefined;
  if (requestId) message += ` (requestId: ${requestId})`;
  return message;
}

/** Minimal SSE reader: yields the JSON payload of each `data:` event. */
export async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of event.split('\n')) {
          if (line.startsWith('data: ')) {
            yield JSON.parse(line.slice(6));
          }
        }
      }
    }
  } finally {
    // Cancel, not just releaseLock: an early exit (e.g. the command's `exit`
    // event) must close the HTTP stream rather than leave it dangling.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** `readSseEvents` with the `event:` name preserved alongside the JSON payload. */
export async function* readSseNamedEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: unknown }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = 'message';
        const dataLines: string[] = [];
        for (const line of frame.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
        }
        if (dataLines.length > 0) {
          yield { event, data: JSON.parse(dataLines.join('\n')) };
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}


/** The subset of `@benchsdk/cli`'s `resolveAuth` result Actions needs. */
export type StoredPlatformAuth = { apiKey?: string; token?: string; orgSlug?: string; orgId?: string };
export type StoredPlatformAuthResolver = (opts: { baseUrl: string }) => Promise<StoredPlatformAuth>;

export const NO_CREDENTIALS_HINT =
  'Set COMPUTE_API_KEY, pass apiKey, or run `compute login`.';

/**
 * Precedence: `--api-key` > `COMPUTE_API_KEY` > `BENCHMARKS_PLATFORM_API_KEY`
 * (legacy) > platform OAuth credentials stored by `compute login`
 * (`~/.benchsdk/credentials.json`, via `@benchsdk/cli`'s `resolveAuth`, which
 * refreshes an expired access token but never opens a browser). `compute
 * login` writes the same store, so a platform login covers these commands.
 */
export async function resolvePlatformAuth(
  opts: {
    apiKey?: string;
    baseUrl?: string;
    allowUntrustedHost?: boolean;
    /** One-off org override: sent as X-Org-Slug (also settable via COMPUTE_ORG). */
    org?: string;
  },
  resolveStored: StoredPlatformAuthResolver = resolveStoredPlatformAuth,
  /** Overrides the no-credentials message's credential hint (the CLI passes `--api-key`). */
  credentialsHint: string = NO_CREDENTIALS_HINT,
): Promise<PlatformAuth> {
  const baseUrl = (
    opts.baseUrl ||
    process.env.COMPUTE_PLATFORM_URL ||
    process.env.BENCHMARKS_PLATFORM_URL || // legacy name
    DEFAULT_BASE_URL
  ).replace(/\/+$/, '');

  // One-off org override: --org flag or COMPUTE_ORG sends X-Org-Slug on every
  // request. Falls back to the stored login's saved org. The platform ignores
  // the header for org API keys (they are already org-scoped).
  let orgSlug = opts.org || process.env.COMPUTE_ORG || undefined;

  // The bearer key is attached to every request, so an attacker-controlled
  // --base-url would exfiltrate it. Only trusted hosts are allowed silently;
  // anything else must be opted into with --allow-untrusted-host.
  if (!opts.allowUntrustedHost && !isTrustedPlatformHost(baseUrl)) {
    throw new PlatformClientError(
      'untrusted_host',
      `Refusing to send the API key to ${baseUrl} — it is not a computesdk.com or localhost host. ` +
        'If this is a self-hosted/dev deployment you trust, pass --allow-untrusted-host.',
    );
  }
  // Host trust and transport security are separate: --allow-untrusted-host
  // says who may receive the key, never that it may travel in plaintext.
  if (!isSecurePlatformTransport(baseUrl)) {
    throw new PlatformClientError(
      'insecure_transport',
      `Refusing to send the API key over plaintext HTTP to ${baseUrl}. ` +
        'Use an https:// base URL; http:// is only allowed for localhost/loopback.',
    );
  }

  // `||` not `??`: empty-string env vars (common in CI matrices) should fall
  // through to the next source, not count as configured.
  let apiKey =
    opts.apiKey ||
    process.env.COMPUTE_API_KEY ||
    process.env.BENCHMARKS_PLATFORM_API_KEY || // legacy name
    undefined;
  if (!apiKey) {
    // Stored platform OAuth is only ever resolved (and refreshed) for trusted
    // hosts. --allow-untrusted-host opts an explicit key into a host, not the
    // user's saved session.
    if (!isTrustedPlatformHost(baseUrl)) {
      throw new PlatformClientError(
        'untrusted_host_stored_auth',
        `Refusing to use stored platform credentials with untrusted host ${baseUrl}. ` +
          'Pass --api-key or set COMPUTE_API_KEY to use an explicit key with --allow-untrusted-host.',
      );
    }
    let stored: StoredPlatformAuth;
    try {
      stored = await resolveStored({ baseUrl });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // `@benchsdk/cli`'s "nothing stored" message names `bench` commands and
      // env vars that only apply to that CLI; keep ours for that case and
      // surface the reason only for expired/failed-refresh sessions.
      const detail = reason.startsWith('No credentials found') ? 'No API key.' : reason;
      throw new PlatformClientError('no_credentials', `${detail} ${credentialsHint}`);
    }
    apiKey = stored.apiKey || stored.token || undefined;
    // The stored orgSlug is only a cache of the last `org use` on this
    // machine — the server's consent row is the source of truth, and
    // sending it would pin this machine to a stale org after a switch
    // elsewhere. Only --org/COMPUTE_ORG send X-Org-Slug.
  }
  if (!apiKey) {
    throw new PlatformClientError('no_credentials', `No API key. ${credentialsHint}`);
  }
  return { apiKey, baseUrl, ...(orgSlug && { orgSlug }) };
}

async function resolveStoredPlatformAuth(opts: { baseUrl: string }): Promise<StoredPlatformAuth> {
  const { resolveAuth } = await import('@benchsdk/cli');
  const auth = await resolveAuth({ baseUrl: opts.baseUrl });
  return { apiKey: auth.apiKey, token: auth.token, orgSlug: auth.orgSlug, orgId: auth.orgId };
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/** https://, or http:// to a loopback host only. */
export function isSecurePlatformTransport(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopbackHost(url.hostname);
}

/** computesdk.com (and subdomains) or localhost — safe to receive the API key. */
export function isTrustedPlatformHost(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  return host === 'computesdk.com' || host.endsWith('.computesdk.com') || isLoopbackHost(host);
}
