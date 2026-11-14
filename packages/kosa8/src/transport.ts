/**
 * HTTP for the kosa8 provider: one HTTP/2 session per origin, shared by every request, instead of
 * a TLS connection per request.
 *
 * With `fetch`, 100 sandboxes created at once open 100 connections, each paying its own TCP and
 * TLS handshake before the request is sent. On kosa8 Cloud that was ~260 ms of each create in a
 * 100-at-once burst from Virginia (2026-11-13), against ~40 ms for a request on a connection that
 * was already open. Over one HTTP/2 session the handshake is paid once, and `preconnect` pays it
 * before the first request (when the provider is configured).
 *
 * `fetch` stays the fallback: where `node:http2` is not available, for an origin whose session
 * could not be opened, and whenever the global `fetch` has been replaced (tests, proxies,
 * instrumentation), which is then honoured for every request.
 */

type Http2 = typeof import('node:http2');
type Session = import('node:http2').ClientHttp2Session;

export interface HttpResponse {
  status: number;
  ok: boolean;
  text: string;
  /** Response headers, names in lower case. */
  headers: Record<string, string>;
}

export interface HttpInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** The global fetch as it was when this module loaded; a different one later was put there on purpose. */
const nativeFetch: typeof fetch | undefined = typeof fetch === 'function' ? fetch : undefined;

let http2Load: Promise<Http2 | null> | undefined;
function loadHttp2(): Promise<Http2 | null> {
  http2Load ??= import('node:http2').then(
    (m) => ((m as unknown as { default?: Http2 }).default ?? m) as Http2,
    () => null,
  );
  return http2Load;
}

interface Origin {
  session?: Promise<Session | null>;
  /** Set once a session could not be opened: `fetch` for this origin from then on. */
  failed?: boolean;
}

const origins = new Map<string, Origin>();

/**
 * Requests in progress on each session. A session's socket is referenced only while this is above
 * zero, so an idle session never keeps the process alive. Counted per session, not per origin: a
 * session the origin has stopped using (GOAWAY) is still released by the requests that were on it.
 */
const inFlight = new WeakMap<Session, number>();
/** Sessions that received GOAWAY: closed once their last request finishes. */
const retired = new WeakSet<Session>();

function hold(s: Session): void {
  inFlight.set(s, (inFlight.get(s) ?? 0) + 1);
  s.ref();
}

function release(s: Session): void {
  const n = (inFlight.get(s) ?? 1) - 1;
  inFlight.set(s, n);
  if (n > 0 || s.destroyed) return;
  if (retired.has(s)) s.close();
  else s.unref();
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('The operation was aborted');
}

/** p, or the signal's abort, whichever comes first; p itself is left to settle for its other waiters. */
function untilAborted<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

/** How long opening a session may take before the origin falls back to `fetch`. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * KOSA8_HTTP_TRANSPORT: unset (auto), `fetch` (never HTTP/2), or `http2` (HTTP/2 even when the
 * global fetch was replaced, and plaintext h2c to a loopback `http:` URL, for tests).
 */
function mode(): 'auto' | 'fetch' | 'http2' {
  const m = typeof process !== 'undefined' ? process.env?.KOSA8_HTTP_TRANSPORT : undefined;
  return m === 'fetch' || m === 'http2' ? m : 'auto';
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return u.origin;
    const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
    return u.protocol === 'http:' && loopback && mode() === 'http2' ? u.origin : null;
  } catch {
    return null;
  }
}

function useHttp2(): boolean {
  if (typeof process === 'undefined' || !process.versions?.node) return false;
  const m = mode();
  if (m === 'fetch') return false;
  return m === 'http2' || (typeof fetch === 'function' && fetch === nativeFetch);
}

function session(origin: string): Promise<Session | null> {
  let o = origins.get(origin);
  if (!o) {
    o = {};
    origins.set(origin, o);
  }
  if (o.failed) return Promise.resolve(null);
  if (o.session) return o.session;
  const entry = o;
  const opening: Promise<Session | null> = loadHttp2().then((http2) => {
    if (!http2) {
      entry.failed = true;
      return null;
    }
    return new Promise<Session | null>((resolve) => {
      let settled = false;
      const s = http2.connect(origin);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        entry.failed = true;
        s.destroy();
        resolve(null);
      }, CONNECT_TIMEOUT_MS);
      timer.unref?.();
      const forget = () => {
        if (entry.session === opening) entry.session = undefined;
      };
      s.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Unreferenced until a request holds it (hold), so a preconnect alone never keeps the
        // process alive.
        if (!inFlight.get(s)) s.unref();
        resolve(s);
      });
      s.on('error', () => {
        forget();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          entry.failed = true;
          resolve(null);
        }
      });
      s.once('goaway', () => {
        // No new streams on it: later requests open a new session, and this one is closed once
        // the requests already on it finish.
        forget();
        retired.add(s);
        if (!inFlight.get(s)) s.close();
      });
      s.once('close', forget);
    });
  });
  entry.session = opening;
  return opening;
}

/** Opens the session to url's origin now, so the first request does not pay the handshake. */
export function preconnect(url: string): void {
  const origin = originOf(url);
  if (!origin || !useHttp2()) return;
  void session(origin);
}

async function viaFetch(url: string, init: HttpInit): Promise<HttpResponse> {
  const res = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  });
  const headers: Record<string, string> = {};
  res.headers?.forEach?.((v, k) => (headers[k.toLowerCase()] = v));
  return { status: res.status, ok: res.ok, text: await res.text(), headers };
}

/** One request: over the origin's HTTP/2 session when there is one, else `fetch`. */
export async function httpRequest(url: string, init: HttpInit): Promise<HttpResponse> {
  const origin = originOf(url);
  if (!origin || !useHttp2()) return viaFetch(url, init);
  // Waiting for the session honours this request's abort; the opening itself goes on for the
  // other requests sharing it.
  const s = await untilAborted(session(origin), init.signal);
  if (!s || s.closed || s.destroyed) return viaFetch(url, init);
  hold(s);
  try {
    return await viaSession(s, url, init);
  } catch (e) {
    // The server took no part in the request (refused stream, or the session was going away
    // or gone when it was sent): sent once more, over fetch. Anything else may have been
    // processed and is reported, never repeated.
    if (notProcessed(e) && !init.signal?.aborted) return await viaFetch(url, init);
    throw e;
  } finally {
    release(s);
  }
}

function notProcessed(e: unknown): boolean {
  const x = e as { code?: string; rstCode?: number } | null;
  return (
    !!x &&
    (x.code === 'ERR_HTTP2_GOAWAY_SESSION' ||
      x.code === 'ERR_HTTP2_INVALID_SESSION' ||
      x.rstCode === 7) /* REFUSED_STREAM */
  );
}

function viaSession(s: Session, url: string, init: HttpInit): Promise<HttpResponse> {
  const u = new URL(url);
  return new Promise<HttpResponse>((resolve, reject) => {
    const headers: Record<string, string> = {
      ':method': init.method,
      ':path': u.pathname + u.search,
    };
    for (const [k, v] of Object.entries(init.headers)) headers[k.toLowerCase()] = v;
    let req: import('node:http2').ClientHttp2Stream;
    try {
      req = s.request(headers);
    } catch (e) {
      reject(e);
      return;
    }
    let done = false;
    const finish = (f: () => void) => {
      if (done) return;
      done = true;
      init.signal?.removeEventListener('abort', onAbort);
      f();
    };
    const aborted = () => (init.signal ? abortError(init.signal) : new Error('The operation was aborted'));
    const onAbort = () => {
      finish(() => reject(aborted()));
      req.close(0x8); // NGHTTP2_CANCEL
    };
    if (init.signal) {
      if (init.signal.aborted) {
        onAbort();
        return;
      }
      init.signal.addEventListener('abort', onAbort, { once: true });
    }
    const chunks: Buffer[] = [];
    let status = 0;
    const got: Record<string, string> = {};
    req.on('response', (h) => {
      status = Number(h[':status'] ?? 0);
      for (const [k, v] of Object.entries(h)) if (!k.startsWith(':') && v !== undefined) got[k] = String(v);
    });
    req.on('data', (c: Buffer) => chunks.push(c));
    // Settled on 'close', the last event. Node emits 'end' even when the connection drops part way
    // through the body (the session is already destroyed by then), so only a stream that ended
    // while its session was alive, and closed without a reset (rstCode 0, NO_ERROR), is an answer.
    // Anything else (no response, an interrupted body) is an error, never a truncated answer and
    // never left pending. finish ignores this after 'error'.
    let ended = false;
    req.on('end', () => {
      ended = !s.destroyed;
    });
    req.on('close', () => {
      if (status !== 0 && ended && !req.rstCode) {
        finish(() =>
          resolve({
            status,
            ok: status >= 200 && status < 300,
            text: Buffer.concat(chunks).toString('utf8'),
            headers: got,
          }),
        );
        return;
      }
      const why = status === 0 ? 'without a response' : 'before the response completed';
      finish(() => reject(new Error(`kosa8: the HTTP/2 stream closed ${why}`)));
    });
    req.on('error', (e) =>
      finish(() => reject(init.signal?.aborted ? aborted() : Object.assign(e, { rstCode: req.rstCode }))),
    );
    req.end(init.body);
  });
}

/** Closes every session (for tests and orderly shutdown). */
export function closeSessions(): void {
  for (const o of origins.values()) {
    void o.session?.then((s) => s?.close());
  }
  origins.clear();
}
