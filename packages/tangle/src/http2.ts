import { connect, type ClientHttp2Session, type OutgoingHttpHeaders } from 'node:http2';
import { Readable } from 'node:stream';

// Node initializes its fetch classes lazily. Resolve them while the adapter
// loads, alongside the SDK, rather than on the first create request.
const { Headers, Response, Request } = globalThis;

type Slot = { session: ClientHttp2Session; active: number };
type Pool = { slots: Slot[]; next: number };
const pools = new Map<string, Pool>();

function openSession(origin: string): Slot {
  const session = connect(origin);
  const slot = { session, active: 0 };
  // An import must neither keep the process alive nor issue an HTTP request.
  session.unref();
  session.on('connect', () => { if (slot.active === 0) session.unref(); });
  session.on('error', () => { session.destroy(); });
  session.on('goaway', () => { session.close(); });
  session.on('close', () => {
    const pool = pools.get(origin);
    if (pool?.slots.every((entry) => entry.session.destroyed)) pools.delete(origin);
  });
  session.setTimeout(30_000, () => {
    if (slot.active === 0) session.close();
  });
  return slot;
}

export function openConnections(baseUrl: string): Pool {
  const url = new URL(baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('Tangle baseUrl must be an HTTP(S) URL without credentials.');
  }
  let pool = pools.get(url.origin);
  if (!pool) {
    pool = { slots: Array.from({ length: 4 }, () => openSession(url.origin)), next: 0 };
    pools.set(url.origin, pool);
  }
  return pool;
}

/** SDK transport: one stream per request, with no request replay or redirects. */
export async function http2Fetch(url: URL, options: RequestInit = {}): Promise<Response> {
  options.signal?.throwIfAborted();
  const pool = pools.get(url.origin) ?? openConnections(url.origin);
  const index = pool.next++ % pool.slots.length;
  let slot = pool.slots[index];
  if (slot.session.closed || slot.session.destroyed) {
    slot = openSession(url.origin);
    pool.slots[index] = slot;
  }
  const headers: OutgoingHttpHeaders = {
    ':method': options.method ?? 'GET',
    ':path': url.pathname + url.search,
  };
  const requestHeaders = options.headers instanceof Headers ? options.headers : new Headers(options.headers);
  requestHeaders.forEach((value, key) => { headers[key] = value; });
  // HTTP/2 forbids hop-by-hop headers. The URL owns the authority.
  for (const key of ['connection', 'host', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade']) {
    delete headers[key];
  }
  let body = options.body;
  if (body != null && typeof body !== 'string' && !(body instanceof Uint8Array)) {
    const request = new Request(url, { ...options, duplex: 'half' } as RequestInit);
    if (!requestHeaders.has('content-type')) headers['content-type'] = request.headers.get('content-type') ?? undefined;
    body = new Uint8Array(await request.arrayBuffer());
  }
  options.signal?.throwIfAborted();
  slot.active++;
  slot.session.ref();
  return new Promise<Response>((resolve, reject) => {
    let stream;
    try {
      stream = slot.session.request(headers, { endStream: body == null });
    } catch (error) {
      slot.active--;
      if (slot.active === 0) slot.session.unref();
      reject(error);
      return;
    }
    const abort = () => { stream.destroy(options.signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    options.signal?.addEventListener('abort', abort, { once: true });
    stream.on('error', reject);
    stream.on('aborted', () => { stream.destroy(new Error('Tangle HTTP/2 response was interrupted.')); });
    stream.on('close', () => {
      options.signal?.removeEventListener('abort', abort);
      slot.active--;
      if (slot.active === 0) slot.session.unref();
      if (!stream.readableEnded) reject(new Error('Tangle HTTP/2 stream closed before completing.'));
    });
    stream.on('response', (incoming) => {
      const status = Number(incoming[':status']);
      const responseHeaders: [string, string][] = [];
      for (const [key, value] of Object.entries(incoming)) {
        if (!key.startsWith(':') && value !== undefined) {
          for (const item of Array.isArray(value) ? value : [value]) responseHeaders.push([key, String(item)]);
        }
      }
      if (options.method === 'HEAD' || status === 204 || status === 205 || status === 304) {
        stream.resume();
        stream.on('end', () => resolve(new Response(null, { status, headers: responseHeaders })));
      } else if (status >= 400 || incoming['content-type']?.includes('json')) {
        // Finish small JSON/error bodies before constructing Response. This also
        // keeps the request deadline active through the final body byte.
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => resolve(new Response(Buffer.concat(chunks), { status, headers: responseHeaders })));
      } else {
        resolve(new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers: responseHeaders }));
      }
    });
    if (body != null) stream.end(body);
    if (options.signal?.aborted) abort();
  });
}
