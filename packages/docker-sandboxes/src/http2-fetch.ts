/**
 * A fetch that sends requests for one origin as streams on a single HTTP/2 session.
 *
 * Node's fetch opens one HTTP/1.1 connection per in-flight request, so a burst of N creates pays N
 * TCP+TLS handshakes, which a single-threaded runtime performs one after another. Multiplexing them
 * on one session pays the handshake once. undici's own HTTP/2 support (`allowH2`) can't be used
 * instead: it sends request bodies one at a time, so concurrent creates run serially.
 *
 * Requests for any other origin, and every request after the session fails to open or negotiates
 * HTTP/1.1, go to the global fetch.
 */

import { connect, constants, type ClientHttp2Session, type ClientHttp2Stream, type OutgoingHttpHeaders } from 'node:http2';
import { Readable } from 'node:stream';
import type { TLSSocket } from 'node:tls';

type Fetch = (request: Request) => Promise<Response>;

// Connection-specific headers are invalid in HTTP/2 (RFC 9113 section 8.2.2).
const HOP_BY_HOP = new Set(['connection', 'host', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade']);

/** How long opening the session may take before requests fall back to the global fetch. */
const CONNECT_TIMEOUT_MS = 10_000;

export interface Http2Fetch {
  fetch: Fetch;
  /** Opens the session without sending a request, so the first request finds the handshake done. */
  preconnect(): void;
}

/**
 * One HTTP/2 session to `connectOrigin`, opened on demand and replaced after it closes. `accept`
 * decides whether a freshly negotiated session may carry requests; a refused session sends every
 * later request to the global fetch. `authority`, when given, replaces the request's own host as
 * `:authority`, which lets one session carry requests for several hosts the server serves.
 */
function h2Session(connectOrigin: string, accept: (session: ClientHttp2Session) => boolean) {
  let ready: Promise<ClientHttp2Session | undefined> | undefined;
  let fallback = false;
  let current: ClientHttp2Session | undefined;
  // Requests between entering fetch and their stream closing, including any waiting for the session
  // to open. The session keeps the process alive only while this is non-zero.
  let held = 0;
  const hold = () => {
    if (held++ === 0) current?.ref();
  };
  const drop = () => {
    if (--held === 0 && current && !current.destroyed) current.unref();
  };

  const open = (): Promise<ClientHttp2Session | undefined> => {
    if (fallback) return Promise.resolve(undefined);
    if (ready) return ready;
    const attempt: Promise<ClientHttp2Session | undefined> = new Promise((resolve) => {
      const session = connect(connectOrigin);
      current = session;
      if (held === 0) session.unref();
      const fail = () => {
        fallback = true;
        session.destroy();
        resolve(undefined);
      };
      const timer = setTimeout(fail, CONNECT_TIMEOUT_MS);
      timer.unref();
      // Streams opened before the peer's SETTINGS arrive can exceed its concurrent-stream limit and be
      // refused; once SETTINGS are known, nghttp2 queues excess streams itself.
      session.once('remoteSettings', () => {
        clearTimeout(timer);
        if (!accept(session)) return fail();
        resolve(session);
      });
      // Kept for the session's life: an 'error' with no listener would crash the process. Streams
      // see the error themselves, and 'close' follows.
      session.on('error', () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      // A session the peer closes later (GOAWAY, idle timeout) is replaced on the next request.
      session.once('close', () => {
        if (ready === attempt) ready = undefined;
        if (current === session) current = undefined;
      });
    });
    ready = attempt;
    return attempt;
  };

  const send = (session: ClientHttp2Session, request: Request, body: Buffer | undefined, authority?: string): Promise<Response> =>
    new Promise((resolve, reject) => {
      const url = new URL(request.url);
      const headers: OutgoingHttpHeaders = { ':method': request.method, ':path': url.pathname + url.search };
      if (authority) headers[':authority'] = authority;
      request.headers.forEach((value, name) => {
        if (!HOP_BY_HOP.has(name)) headers[name] = value;
      });

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        request.signal.removeEventListener('abort', abort);
        drop();
      };

      let stream: ClientHttp2Stream;
      try {
        stream = session.request(headers, { endStream: !body });
      } catch (error) {
        // The session started closing (GOAWAY) after open() returned it.
        release();
        return reject(error);
      }
      const abort = () => {
        stream.close(constants.NGHTTP2_CANCEL);
        reject(request.signal.reason);
      };
      if (request.signal.aborted) {
        release();
        return abort();
      }
      request.signal.addEventListener('abort', abort, { once: true });

      stream.once('close', release);
      stream.once('error', (error) => {
        release();
        reject(error);
      });
      stream.once('response', (responseHeaders) => {
        const status = Number(responseHeaders[':status']);
        const out = new Headers();
        for (const [name, value] of Object.entries(responseHeaders)) {
          if (name.startsWith(':') || value === undefined) continue;
          for (const item of Array.isArray(value) ? value : [value]) out.append(name, String(item));
        }
        const empty = request.method === 'HEAD' || status === 204 || status === 304;
        if (empty) stream.resume();
        resolve(new Response(empty ? null : (Readable.toWeb(stream) as ReadableStream<Uint8Array>), { status, headers: out }));
      });
      if (body) stream.end(body);
    });

  return {
    preconnect: () => void open(),
    async fetch(request: Request, authority?: string): Promise<Response> {
      // Read the body before waiting on the session: a Request body can be read only once, and the
      // fallback needs it too.
      const body = request.body ? Buffer.from(await request.arrayBuffer()) : undefined;
      hold();
      const session = await open();
      if (session) return send(session, request, body, authority);
      drop();
      return globalThis.fetch(new Request(request, { body }));
    },
  };
}

const isH2 = (session: ClientHttp2Session) => session.alpnProtocol === 'h2' || session.alpnProtocol === 'h2c';

export function http2Fetch(origin: string): Http2Fetch {
  const session = h2Session(origin, isH2);
  return {
    fetch: (request) => (new URL(request.url).origin === origin ? session.fetch(request) : globalThis.fetch(request)),
    preconnect: session.preconnect,
  };
}

/**
 * A fetch for sandbox endpoints (`<id>.<parent>`): their requests share `size` HTTP/2 sessions
 * opened to `connectOrigin`, each request naming its own sandbox host as `:authority`. Without it,
 * every sandbox's first command opens its own TCP+TLS connection, and a burst of N sandboxes pays N
 * handshakes across the network.
 *
 * Over TLS a session carries requests only if it negotiated h2 and its certificate covers
 * `*.<parent>`, so one connection may serve every sandbox host (RFC 9113 section 9.1.1). Any other
 * session, and any request outside `<parent>`, goes to the global fetch.
 */
export function endpointHttp2Fetch(parent: string, connectOrigin: string, size: number): Http2Fetch {
  const wildcard = `DNS:*.${parent}`;
  const accept = (session: ClientHttp2Session) => {
    if (!isH2(session)) return false;
    const socket = session.socket as TLSSocket;
    if (typeof socket.getPeerCertificate !== 'function') return true; // h2c: no certificate, local only
    return (socket.getPeerCertificate().subjectaltname ?? '').split(', ').includes(wildcard);
  };
  const scheme = new URL(connectOrigin).protocol;
  const sessions = Array.from({ length: size }, () => h2Session(connectOrigin, accept));
  let next = 0;
  return {
    fetch: (request) => {
      const url = new URL(request.url);
      if (url.protocol !== scheme || !url.hostname.endsWith(`.${parent}`)) return globalThis.fetch(request);
      return sessions[next++ % size].fetch(request, url.host);
    },
    preconnect: () => sessions.forEach((session) => session.preconnect()),
  };
}
