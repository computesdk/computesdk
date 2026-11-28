/**
 * The one transport every Offstage call takes: a small pool of HTTP/2
 * sessions per API origin, shared by every sandbox in the process.
 *
 * A burst of creates rides a few connection handshakes instead of one each,
 * and is spread over the pool instead of queueing behind one connection.
 * A session that errs, closes or is sent GOAWAY leaves the pool, and the next
 * request opens its replacement. Idle sessions are unref'd, so a script that
 * used the provider still exits on its own; a session holds the process open
 * only while one of its requests is waiting for an answer.
 */

import * as http2 from 'node:http2';

import type { ClientHttp2Session, ClientHttp2Stream, IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http2';

/** Sessions per API origin. */
export const SESSIONS_PER_ORIGIN = 16;

/**
 * How long a session may take to connect before it is dropped. A peer that
 * never answers (a blackholed route drops the SYN; a stalled TLS handshake)
 * emits no event of its own, and `http2.connect(origin, { timeout })` does not
 * cover the TLS handshake, so without this a request on that session would
 * wait for the OS to give up, over a minute later.
 */
export const CONNECT_TIMEOUT_MS = 10_000;

/**
 * How long a request may go without progress before it is given up: its body
 * going out, or its answer coming in. The API answers every request within
 * 50 s (a command's long poll holds it that long at most), so a request quiet
 * for longer has lost its connection. A connection that NAT or a load
 * balancer dropped while idle gives no sign of it, and without this bound a
 * request on it would wait for the OS to give up on retransmits, about
 * 15 minutes on Linux.
 */
export const STREAM_IDLE_TIMEOUT_MS = 90_000;

const { NGHTTP2_CANCEL, NGHTTP2_NO_ERROR, NGHTTP2_REFUSED_STREAM } = http2.constants;

interface Pooled {
  readonly session: ClientHttp2Session;
  /** Set once the connection (and its TLS handshake) is up. Until then a request on it has not left the process. */
  connected: boolean;
  /** Requests waiting for an answer on this session. */
  streams: number;
}

const pools = new Map<string, Pooled[]>();

function open(origin: string, pool: Pooled[]): Pooled {
  const session = http2.connect(origin);
  const entry: Pooled = { session, connected: false, streams: 0 };
  const connectTimer = setTimeout(() => {
    session.destroy(new Error(`connecting to ${origin} took more than ${CONNECT_TIMEOUT_MS} ms`));
  }, CONNECT_TIMEOUT_MS);
  // A pending connect must not hold the process open by itself: a request waiting on it does.
  connectTimer.unref();
  const drop = (): void => {
    clearTimeout(connectTimer);
    const at = pool.indexOf(entry);
    if (at >= 0) pool.splice(at, 1);
  };
  session.once('connect', () => {
    entry.connected = true;
    clearTimeout(connectTimer);
  });
  // Kept for the session's whole life: an 'error' with no listener would crash the process.
  session.on('error', drop);
  session.once('close', drop);
  // Its open requests finish; it takes no new ones.
  session.once('goaway', drop);
  session.unref();
  return entry;
}

/** The pool for `origin`, with dead sessions dropped and the pool topped up to its size. */
function fill(origin: string): Pooled[] {
  let pool = pools.get(origin);
  if (pool === undefined) pools.set(origin, (pool = []));
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    const { session } = pool[i]!;
    if (session.closed || session.destroyed) pool.splice(i, 1);
  }
  while (pool.length < SESSIONS_PER_ORIGIN) pool.push(open(origin, pool));
  return pool;
}

/**
 * The session with the fewest requests in flight, a connected one on a tie:
 * a burst spreads over the whole pool, and a lone request takes a session
 * whose handshake is already done.
 */
function pick(origin: string, avoid?: Pooled): Pooled {
  let best: Pooled | undefined;
  for (const entry of fill(origin)) {
    if (entry === avoid) continue;
    if (best === undefined || entry.streams < best.streams || (entry.streams === best.streams && entry.connected && !best.connected)) {
      best = entry;
    }
  }
  return best!;
}

/** Opens the pool for the origin of `baseUrl` without sending anything. */
export function preconnect(baseUrl: string): void {
  fill(new URL(baseUrl).origin);
}

export interface HttpRequest {
  method: string;
  url: URL;
  /** Lower-case names. */
  headers: Record<string, string>;
  body?: string;
  /**
   * Whether the server treats a second copy as the same request (GET, PUT,
   * DELETE, a POST with an Idempotency-Key). Only such a request is sent
   * again after its connection failed once it may have reached the server.
   */
  idempotent: boolean;
}

export interface HttpAnswer {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/** One try at a request that ended without a complete answer. */
class Unanswered extends Error {
  constructor(
    readonly cause: unknown,
    /** The response headers had arrived: the server acted on the request. */
    readonly answered: boolean,
    /** The request may have reached the server. False when its session never connected or refused it on the spot. */
    readonly sent: boolean,
    /** The server reset the stream with REFUSED_STREAM, which promises it did not act on it. */
    readonly refused: boolean,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

function attempt(entry: Pooled, request: HttpRequest): Promise<HttpAnswer> {
  return new Promise((resolve, reject) => {
    const headers: OutgoingHttpHeaders = {
      ':method': request.method,
      ':path': `${request.url.pathname}${request.url.search}`,
      ...request.headers,
      ...(request.body === undefined ? {} : { 'content-length': String(Buffer.byteLength(request.body)) }),
    };
    let stream: ClientHttp2Stream;
    try {
      stream = entry.session.request(headers, { endStream: request.body === undefined });
    } catch (error) {
      // The session closed or was sent GOAWAY since it was picked: nothing was sent.
      reject(new Unanswered(error, false, false, false));
      return;
    }
    entry.streams += 1;
    if (entry.streams === 1) entry.session.ref();

    let status: number | undefined;
    let responseHeaders: IncomingHttpHeaders = {};
    let failure: unknown;
    const chunks: Buffer[] = [];

    // While the body goes out, progress is read from the connection's byte
    // count: a body's write callbacks only fire once all of it has gone.
    let bodySent = request.body === undefined;
    let written = entry.session.socket.bytesWritten;
    const idle = setTimeout(() => {
      // The session is gone, and the stream closes with it.
      if (entry.session.destroyed) return;
      if (!bodySent && entry.session.socket.bytesWritten !== written) {
        written = entry.session.socket.bytesWritten;
        idle.refresh();
        return;
      }
      failure = new Error(`no progress for ${STREAM_IDLE_TIMEOUT_MS} ms, so the connection is presumed lost`);
      // No new request goes on this connection; the ones on it end by this same bound.
      entry.session.close();
      stream.close(NGHTTP2_CANCEL);
    }, STREAM_IDLE_TIMEOUT_MS);
    // Like the connect timer: the session holds the process open while a request waits.
    idle.unref();

    stream.on('response', (received) => {
      status = Number(received[':status']);
      responseHeaders = received;
      idle.refresh();
    });
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      idle.refresh();
    });
    stream.on('error', (error) => {
      failure = error;
    });
    // 'close' comes last whatever happened. A stream whose connection died
    // can still end its readable side cleanly, so only a NO_ERROR close
    // after a response is a complete answer.
    stream.on('close', () => {
      clearTimeout(idle);
      entry.streams -= 1;
      if (entry.streams === 0) entry.session.unref();
      if (status !== undefined && failure === undefined && stream.rstCode === NGHTTP2_NO_ERROR) {
        resolve({ status, headers: responseHeaders, body: Buffer.concat(chunks) });
        return;
      }
      const cause = failure ?? new Error(
        status === undefined
          ? `the stream closed with code ${stream.rstCode} before any answer`
          : `the answer was cut off (stream closed with code ${stream.rstCode})`,
      );
      reject(new Unanswered(cause, status !== undefined, !stream.pending, stream.rstCode === NGHTTP2_REFUSED_STREAM));
    });
    if (request.body !== undefined) {
      stream.end(request.body, () => {
        bodySent = true;
        idle.refresh();
      });
    }
  });
}

/**
 * Whether a request whose try got no answer may be sent once more. Never
 * after the server answered. Always when the server never had it: the
 * session never connected, or the stream was refused. Otherwise the server
 * may have acted on it, so only an idempotent request is sent again; a
 * command could run twice.
 */
function mayResend(request: HttpRequest, failure: Unanswered): boolean {
  if (failure.answered) return false;
  if (!failure.sent || failure.refused) return true;
  return request.idempotent;
}

function noAnswer(request: HttpRequest, failure: unknown, note: string): Error {
  const reason = failure instanceof Error ? failure.message : String(failure);
  const error = new Error(`Offstage: ${request.method} ${request.url.pathname} got no answer: ${reason}${note}`);
  Object.defineProperty(error, 'cause', { value: failure instanceof Unanswered ? failure.cause : failure, enumerable: false });
  return error;
}

/**
 * Sends one request over the pool. A try that ends without an answer is sent
 * once more, on another session, when {@link mayResend} allows it.
 */
export async function send(request: HttpRequest): Promise<HttpAnswer> {
  const origin = request.url.origin;
  const first = pick(origin);
  try {
    return await attempt(first, request);
  } catch (error) {
    if (!(error instanceof Unanswered)) throw error;
    if (!mayResend(request, error)) {
      throw noAnswer(request, error, error.answered ? '' : '. It was not sent again, as the server may have acted on it');
    }
  }
  try {
    return await attempt(pick(origin, first), request);
  } catch (error) {
    throw noAnswer(request, error, ' (tried twice)');
  }
}
