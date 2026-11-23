/**
 * Minimal client for the Styne REST API (https://docs.styne.ai/api-reference).
 *
 * Requests share one HTTP/2 session per API origin, so sandboxes created in a burst reuse a
 * single TLS connection instead of opening one each. An idle session does not keep the Node.js
 * process alive. It is checked with a PING every 15 seconds, so a request after a pause does not
 * pay for a new handshake and a connection dropped by a NAT or load balancer is discarded instead
 * of used or waited on; after 5 minutes without a request it is closed.
 *
 * A connection that has not opened within 10 seconds is given up. A session is replaced when the
 * connection fails (an error, a GOAWAY, a reset that condemns the connection): requests made
 * afterwards go out on a new connection. A reset of a single stream leaves the session in use.
 * Large request bodies share a separate session per origin, so a slow or refused upload never
 * holds up the calls next to it.
 */

import { randomUUID } from 'node:crypto';
import http2 from 'node:http2';

export const DEFAULT_API_URL = 'https://api.styne.ai';

export interface ClientConfig {
  apiKey: string;
  apiUrl: string;
}

export class StyneApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(status: number, message: string, code?: string, requestId?: string) {
    super(message);
    this.name = 'StyneApiError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export interface Reply {
  status: number;
  body: Buffer;
  headers: http2.IncomingHttpHeaders;
}

export interface RequestOptions {
  body?: string | Uint8Array;
  contentType?: string;
  /** Receives the body of a 2xx answer as it arrives instead of buffering it. */
  onData?: (chunk: Buffer) => void;
  /** Fails the request after this many milliseconds without any data from the API; `0` waits indefinitely. */
  timeoutMs?: number;
  /**
   * Sent as the `Idempotency-Key` header. The API answers a repeat of the same key with the
   * result of the first request, so a request that carries one is retried like an idempotent one.
   */
  idempotencyKey?: string;
  /**
   * Fails at once, without another attempt, when the connection to the API host never opened, for a caller
   * that has another host to send the request to.
   */
  failFastUnreachable?: boolean;
  /** Repeats a `429` or `503` answer to a request that is safe to repeat after its `Retry-After`; default `true`. */
  repeatWhenBusy?: boolean;
}

/**
 * How far a failed request got. `unsent`: it provably never reached the API (the session was
 * closed before it went out, the connection never opened, or the server refused the stream
 * unprocessed). `unknown`: the API may have acted on it. `final`: never repeated.
 */
export type Delivery = 'unsent' | 'unknown' | 'final';

/** `unreachable`: the connection to the API host never opened (no route, refused, TLS failure, connect timeout). */
export type RequestError = Error & { code?: string; delivery?: Delivery; unreachable?: boolean };

interface Session {
  key: string;
  http: http2.ClientHttp2Session;
  active: number;
  connected: boolean;
  lastUsed: number;
  /** Called if the connection closes without ever opening. */
  unreachable: Array<() => void>;
}

const sessions = new Map<string, Session>();

export const IDLE_SESSION_MS = 300_000;
export const KEEPALIVE_MS = 15_000;
const PING_TIMEOUT_MS = 5_000;
/** A connection that has not opened after this long is given up, so its requests fail instead of waiting on a silent host. */
const CONNECT_TIMEOUT_MS = 10_000;
const BUSY_PING_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ATTEMPTS = 3;
/**
 * A request that provably never reached the API is sent this many times in all: it costs nothing to send again,
 * and a burst can meet several connection rotations in a row.
 */
const MAX_UNSENT_ATTEMPTS = 10;
const RETRY_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 2_000;
/** A `429` or `503` answer to a request that is safe to repeat is repeated this many times, after its `Retry-After`. */
const MAX_BUSY_REPEATS = 2;
const MAX_BUSY_WAIT_MS = 5_000;
/** Node's 64 KiB default receive windows would hold every download on the shared session to 64 KiB per round trip. */
const STREAM_WINDOW_BYTES = 8 * 1024 * 1024;
const SESSION_WINDOW_BYTES = 32 * 1024 * 1024;
/** Request bodies of this size or more go out on a session of their own. */
export const BULK_BODY_BYTES = 8 * 1024 * 1024;
/** Large bodies are written in pieces of this size, each after the previous one has drained. */
const BODY_CHUNK_BYTES = 1024 * 1024;
const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE']);
/** Errors the client raises before a stream exists: the request was never written. */
const NOT_SENT = new Set(['ERR_HTTP2_INVALID_SESSION', 'ERR_HTTP2_GOAWAY_SESSION', 'ERR_HTTP2_OUT_OF_STREAMS']);
/** Stream reset codes after which the connection itself is no longer trusted. */
const BROKEN_CONNECTION = new Set<number>([
  http2.constants.NGHTTP2_PROTOCOL_ERROR,
  http2.constants.NGHTTP2_INTERNAL_ERROR,
  http2.constants.NGHTTP2_FLOW_CONTROL_ERROR,
  http2.constants.NGHTTP2_COMPRESSION_ERROR,
  http2.constants.NGHTTP2_CONNECT_ERROR,
  http2.constants.NGHTTP2_ENHANCE_YOUR_CALM,
]);

/** Takes a session out of use: requests made afterwards open a new one. */
function retire(session: Session, broken: boolean): void {
  if (sessions.get(session.key) === session) sessions.delete(session.key);
  if (session.http.destroyed) return;
  if (broken) session.http.destroy();
  else session.http.close();
}

function sessionFor(origin: string, bulk: boolean): Session {
  const key = bulk ? `${origin} bulk` : origin;
  const open = sessions.get(key);
  if (open && !open.http.closed && !open.http.destroyed) return open;

  const http = http2.connect(origin, { settings: { initialWindowSize: STREAM_WINDOW_BYTES } });
  const session: Session = { key, http, active: 0, connected: false, lastUsed: Date.now(), unreachable: [] };
  const connectTimer = setTimeout(() => {
    if (!session.connected) http.destroy(Object.assign(new Error(`no connection to ${origin} within ${CONNECT_TIMEOUT_MS} ms`), { code: 'ETIMEDOUT' }));
  }, CONNECT_TIMEOUT_MS);
  connectTimer.unref();
  http.once('close', () => {
    clearTimeout(connectTimer);
    if (!session.connected) for (const notify of session.unreachable.splice(0)) notify();
  });
  http.once('connect', () => {
    clearTimeout(connectTimer);
    session.connected = true;
    session.unreachable.length = 0;
    try {
      http.setLocalWindowSize(SESSION_WINDOW_BYTES);
    } catch {
      // The session ended while connecting; its requests fail on their own.
    }
  });
  http.on('error', () => retire(session, true));
  http.on('close', () => retire(session, true));
  http.on('goaway', () => retire(session, false));
  const keepalive = setInterval(() => checkSession(session), KEEPALIVE_MS);
  keepalive.unref();
  http.once('close', () => clearInterval(keepalive));
  http.unref();
  sessions.set(key, session);
  return session;
}

/**
 * Checks a session every 15 seconds. An idle one is closed after 5 minutes without a request; until then, and
 * while requests are running on it, it must answer a PING (within 5 seconds when idle, 30 seconds when busy, since
 * the answer may queue behind a download). A session that does not answer is destroyed, so a connection that died
 * without a reset fails its requests instead of leaving them waiting, and the next request opens a new one.
 */
function checkSession(session: Session): void {
  const { http } = session;
  if (http.closed || http.destroyed || !session.connected) return;
  const busy = session.active > 0;
  if (!busy && Date.now() - session.lastUsed >= IDLE_SESSION_MS) {
    retire(session, false);
    return;
  }
  const timer = setTimeout(() => retire(session, true), busy ? BUSY_PING_TIMEOUT_MS : PING_TIMEOUT_MS);
  timer.unref();
  let sent = false;
  try {
    sent = http.ping((error) => {
      clearTimeout(timer);
      if (error) retire(session, true);
    });
  } catch {
    // The session ended between the check and the PING.
  }
  if (!sent) {
    clearTimeout(timer);
    retire(session, true);
  }
}

/**
 * Whether a connection to the origin of `apiUrl` is open. When none is, one is opened in the background, and
 * `onUnreachable` is called if it closes without ever opening.
 */
export function connectionReady(apiUrl: string, onUnreachable: () => void): boolean {
  const session = sessionFor(new URL(apiUrl).origin, false);
  if (session.connected) return true;
  session.unreachable.push(onUnreachable);
  return false;
}

function failure(message: string, delivery: Delivery, code?: string, unreachable = false): RequestError {
  return Object.assign(new Error(message), { delivery, ...(code ? { code } : {}), ...(unreachable ? { unreachable } : {}) });
}

/** Writes a body in pieces, each after the stream has taken the one before, so a large upload follows flow control. */
function writeBody(stream: http2.ClientHttp2Stream, body: Buffer): void {
  if (body.length <= BODY_CHUNK_BYTES) {
    stream.end(body);
    return;
  }
  let offset = 0;
  const pump = () => {
    while (!stream.destroyed && offset < body.length) {
      const chunk = body.subarray(offset, offset + BODY_CHUNK_BYTES);
      offset += chunk.length;
      if (offset >= body.length) {
        stream.end(chunk);
        return;
      }
      if (!stream.write(chunk)) {
        stream.once('drain', pump);
        return;
      }
    }
  };
  pump();
}

function send(session: Session, method: string, path: string, apiKey: string, options: RequestOptions, body?: Buffer): Promise<Reply> {
  return new Promise<Reply>((resolve, reject) => {
    const headers: http2.OutgoingHttpHeaders = {
      ':method': method,
      ':path': path,
      authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
    };
    if (body !== undefined) {
      headers['content-type'] = options.contentType ?? 'application/json';
      headers['content-length'] = body.length;
    }
    if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

    let stream: http2.ClientHttp2Stream;
    try {
      stream = session.http.request(headers, { endStream: body === undefined });
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      retire(session, false);
      reject(Object.assign(error as Error, { delivery: NOT_SENT.has(code) ? 'unsent' : 'unknown' }));
      return;
    }
    session.active += 1;
    session.lastUsed = Date.now();
    session.http.ref();

    let status = 0;
    let replyHeaders: http2.IncomingHttpHeaders = {};
    let delivered = false;
    let cancelled = false;
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error?: RequestError) => {
      if (settled) return;
      settled = true;
      session.active -= 1;
      session.lastUsed = Date.now();
      if (session.active === 0 && !session.http.destroyed) session.http.unref();
      if (error) reject(error);
      else resolve({ status, body: Buffer.concat(chunks), headers: replyHeaders });
    };
    const cancel = () => {
      cancelled = true;
      stream.close(http2.constants.NGHTTP2_CANCEL);
    };

    stream.on('response', (head) => {
      status = Number(head[':status']);
      replyHeaders = head;
    });
    stream.on('data', (chunk: Buffer) => {
      if (settled) return;
      if (!options.onData || status < 200 || status >= 300) {
        chunks.push(chunk);
        return;
      }
      delivered = true;
      try {
        options.onData(chunk);
      } catch (error) {
        cancel();
        finish(Object.assign(error as Error, { delivery: 'final' as const }));
      }
    });
    // A stream that ends without an answer was cut off; its close says why.
    stream.on('end', () => {
      if (status !== 0) finish();
    });
    let streamError: RequestError | undefined;
    stream.on('error', (error) => {
      streamError = error;
    });
    stream.on('close', () => {
      if (settled) return;
      const rst = stream.rstCode ?? http2.constants.NGHTTP2_NO_ERROR;
      // REFUSED_STREAM and CANCEL concern this stream only; the session and the requests queued on it stay.
      if (!cancelled && BROKEN_CONNECTION.has(rst)) retire(session, true);
      // A refused stream was not processed (RFC 9113 section 8.7); streams above a GOAWAY's last stream id end the same way.
      // A connection that never opened never carried the request either.
      const unreachable = !session.connected;
      const unsent = rst === http2.constants.NGHTTP2_REFUSED_STREAM || unreachable;
      const delivery: Delivery = delivered ? 'final' : unsent ? 'unsent' : 'unknown';
      const reason = streamError?.message ?? (rst !== http2.constants.NGHTTP2_NO_ERROR ? `stream reset with HTTP/2 error ${rst}` : 'the connection closed');
      finish(failure(`${method} ${path}: ${reason} before the answer was complete`, delivery, streamError?.code ?? 'ERR_HTTP2_STREAM_ERROR', unreachable));
    });

    const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    if (timeoutMs > 0) {
      stream.setTimeout(timeoutMs, () => {
        cancel();
        finish(failure(`${method} ${path}: no answer from the Styne API within ${timeoutMs} ms`, 'final', 'ETIMEDOUT'));
      });
    }

    if (body !== undefined) writeBody(stream, body);
  });
}

/** Whether sending a request twice has the effect of sending it once: an idempotent method, or an `Idempotency-Key`. */
export function repeatable(method: string, options: Pick<RequestOptions, 'idempotencyKey'>): boolean {
  return IDEMPOTENT.has(method) || Boolean(options.idempotencyKey);
}

/** Whether a failed request may be sent again: never if it may have been acted on, unless repeating it is harmless. */
export function mayRetry(method: string, options: Pick<RequestOptions, 'idempotencyKey'>, error: RequestError): boolean {
  if (error.delivery === 'unsent') return true;
  if (error.delivery !== 'unknown') return false;
  return repeatable(method, options);
}

/** Exponential backoff with jitter, so the requests of a burst that failed together do not return together. */
function retryDelay(attempt: number): number {
  const base = Math.min(RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
  return base / 2 + Math.random() * (base / 2);
}

/** The wait an answer's `Retry-After` header asks for (seconds or an HTTP date), or `fallbackMs` without one. */
export function retryAfterMs(reply: Reply, fallbackMs: number): number {
  const header = reply.headers['retry-after'];
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || value.trim() === '') return fallbackMs;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? fallbackMs : Math.max(0, date - Date.now());
}

/**
 * Whether an answer asks for the same request a little later: a `429` or `503` from the API (it names its errors
 * with an `error_code`) or with a `Retry-After`. A proxy's bare `503` page is not one; it says nothing about the API.
 */
function askedToWait(reply: Reply): boolean {
  if (reply.status !== 429 && reply.status !== 503) return false;
  return reply.headers['retry-after'] !== undefined || errorCodeOf(reply) !== undefined;
}

/**
 * Sends one request. A request that failed on the way is sent again when it provably never reached
 * the API (up to ten times in all, with a growing delay), or when repeating it is harmless: an
 * idempotent method, or a request with an `Idempotency-Key` (up to three times in all). A large
 * body is sent again only when it never went out. With `failFastUnreachable`, a host that cannot
 * be reached is not tried again. A request that is safe to repeat and that the API asked to send
 * again later (`429`, `503`) is repeated after its `Retry-After`, unless `repeatWhenBusy` is `false`.
 */
export async function request(
  config: ClientConfig,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Reply> {
  const url = new URL(config.apiUrl);
  const prefix = url.pathname.replace(/\/+$/, '');
  const body = options.body === undefined ? undefined : Buffer.from(options.body);
  const bulk = body !== undefined && body.length >= BULK_BODY_BYTES;
  const repeatBusy = options.repeatWhenBusy !== false && !bulk && repeatable(method, options);
  let busyRepeats = 0;
  for (let attempt = 1; ; attempt++) {
    const session = sessionFor(url.origin, bulk);
    let reply: Reply;
    try {
      reply = await send(session, method, prefix + path, config.apiKey, options, body);
    } catch (error) {
      const failed = error as RequestError;
      // A large body is sent again only when it never went out: the body itself may be what the server refused.
      const again = mayRetry(method, options, failed) && (!bulk || failed.delivery === 'unsent') && !(failed.unreachable && options.failFastUnreachable);
      const limit = failed.delivery === 'unsent' && !failed.unreachable ? MAX_UNSENT_ATTEMPTS : MAX_ATTEMPTS;
      if (!again || attempt >= limit) throw failed;
      await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt)));
      continue;
    }
    if (!repeatBusy || busyRepeats >= MAX_BUSY_REPEATS || !askedToWait(reply)) return reply;
    busyRepeats += 1;
    attempt = 0;
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfterMs(reply, 1_000), MAX_BUSY_WAIT_MS)));
  }
}

/** A fresh key for a request that must take effect at most once. */
export const newIdempotencyKey = (): string => randomUUID();

/** The `error_code` of an API error answer, if its body is JSON. */
export function errorCodeOf(reply: Reply): string | undefined {
  try {
    const code = (JSON.parse(reply.body.toString('utf8')) as { error_code?: unknown }).error_code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

/** Throws a StyneApiError unless the answer's status is one of `ok`. */
export function expectStatus(reply: Reply, action: string, ok: readonly number[]): void {
  if (ok.includes(reply.status)) return;
  const text = reply.body.toString('utf8');
  // A body that is not JSON (a proxy's HTML error page) is cut to its start.
  let message = text.slice(0, 300) || `HTTP ${reply.status}`;
  let code: string | undefined;
  const header = reply.headers['x-request-id'];
  let requestId = typeof header === 'string' ? header : undefined;
  try {
    const parsed = JSON.parse(text) as { message?: string; error_code?: string; request_id?: string };
    if (parsed.message) message = parsed.message;
    code = parsed.error_code;
    requestId = parsed.request_id ?? requestId;
  } catch {
    // Not a JSON error body; keep the raw text.
  }
  throw new StyneApiError(reply.status, `Styne ${action} failed (${reply.status}${code ? ` ${code}` : ''}): ${message}`, code, requestId);
}

export function parseJson<T>(reply: Reply, action: string): T {
  try {
    return JSON.parse(reply.body.toString('utf8')) as T;
  } catch {
    throw new StyneApiError(reply.status, `Styne ${action} returned a response that is not JSON`);
  }
}

/** Sends a JSON request and returns the parsed answer, which must have one of the `ok` statuses. */
export async function call<T>(
  config: ClientConfig,
  method: string,
  path: string,
  body: unknown,
  action: string,
  ok: readonly number[] = [200, 201],
): Promise<T> {
  const reply = await request(config, method, path, body === undefined ? {} : { body: JSON.stringify(body) });
  expectStatus(reply, action, ok);
  return parseJson<T>(reply, action);
}

/** Closes every open session. Requests made afterwards open a new one. */
export function closeSessions(): void {
  for (const session of sessions.values()) session.http.close();
  sessions.clear();
}
