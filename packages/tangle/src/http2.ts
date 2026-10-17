import { connect, type ClientHttp2Session, type OutgoingHttpHeaders } from 'node:http2';
import { Readable } from 'node:stream';
import { TimeoutError } from '@tangle-network/sandbox';

// Node initializes its fetch classes lazily. Resolve them while the adapter
// loads, alongside the SDK, rather than on the first create request.
const { Headers, Response, Request } = globalThis;

const decoder = new TextDecoder();

/** Already-buffered bodies need no stream unless a caller asks for one. */
class BufferedResponse extends Response {
  private consumed = false;
  private discarded = false;
  private streamed?: Response;
  private readonly buffer: Buffer;

  constructor(buffer: Buffer, init: ResponseInit) {
    super(null, init);
    this.buffer = buffer;
  }

  private asStream(): Response {
    if (!this.streamed) {
      this.streamed = new Response(this.consumed ? '' : new Uint8Array(this.buffer), { headers: this.headers });
      // Native consumption leaves a locked, disturbed body; cancellation leaves
      // it unlocked. Preserve both states when the stream is first requested.
      if (this.discarded) void this.streamed.body!.cancel();
      else if (this.consumed) void this.streamed.text();
    }
    return this.streamed;
  }

  override get body() { return this.asStream().body!; }
  override get bodyUsed(): boolean { return this.consumed || (this.streamed?.bodyUsed ?? false); }

  override async text(): Promise<string> {
    if (this.streamed) return this.streamed.text();
    if (this.consumed) throw new TypeError('Body has already been consumed.');
    this.consumed = true;
    return decoder.decode(this.buffer);
  }

  override async json(): Promise<any> { return JSON.parse(await this.text()); }

  async discard(): Promise<void> {
    if (this.streamed || this.consumed) await this.asStream().body?.cancel();
    else {
      this.consumed = true;
      this.discarded = true;
    }
  }

  override arrayBuffer(): Promise<ArrayBuffer> { return this.asStream().arrayBuffer(); }
  async bytes() { return new Uint8Array(await this.arrayBuffer()); }
  override async blob(): Promise<Blob> { return new Response(this.body, { headers: this.headers }).blob(); }
  override async formData(): Promise<FormData> { return new Response(this.body, { headers: this.headers }).formData(); }

  override clone(): Response {
    if (this.bodyUsed || this.streamed?.body?.locked) throw new TypeError('Body cannot be cloned.');
    if (this.streamed) {
      return new Response(this.streamed.clone().body, { status: this.status, headers: this.headers });
    }
    return new BufferedResponse(this.buffer, { status: this.status, headers: this.headers });
  }
}

export async function discardResponseBody(response: Response): Promise<void> {
  if (response instanceof BufferedResponse) await response.discard();
  else await response.body?.cancel();
}

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
export async function http2Fetch(
  url: URL,
  options: RequestInit = {},
  transport: { authorization?: string; timeoutMs?: number } = {},
): Promise<Response> {
  const startedAt = performance.now();
  const { authorization, timeoutMs } = transport;
  options.signal?.throwIfAborted();
  const pool = pools.get(url.origin) ?? openConnections(url.origin);
  const index = pool.next++ % pool.slots.length;
  let slot = pool.slots[index];
  if (slot.session.closed || slot.session.destroyed) {
    slot = openSession(url.origin);
    pool.slots[index] = slot;
  }
  const headers: OutgoingHttpHeaders = Object.create(null);
  headers[':method'] = options.method ?? 'GET';
  headers[':path'] = url.pathname + url.search;
  const supplied = options.headers;
  if (supplied) {
    const requestHeaders = supplied instanceof Headers ? supplied : new Headers(supplied);
    requestHeaders.forEach((value, key) => { headers[key] = value; });
  }
  if (authorization !== undefined) {
    headers.authorization = authorization;
    if (headers['content-type'] === undefined && !(options.body instanceof FormData)) {
      headers['content-type'] = 'application/json';
    }
  }
  // HTTP/2 forbids hop-by-hop headers. The URL owns the authority.
  for (const key of ['connection', 'host', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade']) {
    delete headers[key];
  }
  let body = options.body;
  if (body != null && typeof body !== 'string' && !(body instanceof Uint8Array)) {
    const request = new Request(url, { ...options, duplex: 'half' } as RequestInit);
    if (headers['content-type'] === undefined) headers['content-type'] = request.headers.get('content-type') ?? undefined;
    body = new Uint8Array(await request.arrayBuffer());
  }
  options.signal?.throwIfAborted();
  if (timeoutMs !== undefined && performance.now() - startedAt >= timeoutMs) throw new TimeoutError(timeoutMs);
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
    // A request timer can destroy the stream directly; no second abort signal
    // is needed alongside the caller's signal.
    const timer = timeoutMs === undefined ? undefined : setTimeout(
      () => stream.destroy(new TimeoutError(timeoutMs)),
      Math.max(1, timeoutMs - (performance.now() - startedAt)),
    );
    timer?.unref();
    const finish = (response: Response) => { clearTimeout(timer); resolve(response); };
    options.signal?.addEventListener('abort', abort, { once: true });
    stream.on('error', reject);
    stream.on('aborted', () => { stream.destroy(new Error('Tangle HTTP/2 response was interrupted.')); });
    stream.on('close', () => {
      clearTimeout(timer);
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
        stream.on('end', () => finish(new Response(null, { status, headers: responseHeaders })));
      } else if (status >= 400 || incoming['content-type']?.includes('json')) {
        // Finish small JSON/error bodies before constructing Response. This also
        // keeps the request deadline active through the final body byte.
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => finish(new BufferedResponse(
          chunks.length === 1 ? chunks[0] : Buffer.concat(chunks), { status, headers: responseHeaders },
        )));
      } else {
        finish(new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers: responseHeaders }));
      }
    });
    if (body != null) stream.end(body);
    if (options.signal?.aborted) abort();
  });
}
