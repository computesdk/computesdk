import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BULK_BODY_BYTES, closeSessions, expectStatus, mayRetry, request, retryAfterMs, StyneApiError } from '../client';
import type { RequestError } from '../client';
import { styne } from '../provider';

const { NGHTTP2_ENHANCE_YOUR_CALM, NGHTTP2_INTERNAL_ERROR, NGHTTP2_NO_ERROR, NGHTTP2_REFUSED_STREAM } = http2.constants;

/**
 * A stand-in for the API that misbehaves on demand. `POST /sandboxes` honours `Idempotency-Key` the way the API
 * does: a repeat of a key answers with the sandbox the key started, so the count of sandboxes is what a real
 * account would be left running.
 */
describe('client over a failing HTTP/2 connection', () => {
  let server: http2.Http2Server;
  let connections = 0;
  let next = 0;
  const sandboxes = new Map<string, string>();
  const hits = new Map<string, number>();
  const poisoned = new WeakSet<http2.Http2Session>();
  const uploads: Array<{ bytes: number; length?: string }> = [];
  let burst = { left: 0 };
  let conflicts = 0;
  const keys: string[] = [];
  const open = new Set<http2.ServerHttp2Session>();

  beforeAll(async () => {
    server = http2.createServer();
    server.on('session', (session) => {
      connections++;
      open.add(session);
      session.on('close', () => open.delete(session));
      session.on('error', () => undefined);
    });
    server.on('stream', (stream, headers) => {
      stream.on('error', () => undefined);
      const method = String(headers[':method']);
      const path = String(headers[':path']);
      const key = headers['idempotency-key'] as string | undefined;
      hits.set(`${method} ${path}`, (hits.get(`${method} ${path}`) ?? 0) + 1);
      const json = (status: number, value: unknown, extra: http2.OutgoingHttpHeaders = {}) => {
        stream.respond({ ':status': status, 'content-type': 'application/json', ...extra });
        stream.end(JSON.stringify(value));
      };

      if (method === 'PUT' && path === '/huge-bulk') return stream.close(NGHTTP2_ENHANCE_YOUR_CALM);
      // A connection the server has given up on: every request is still acted on, and its answer is reset.
      if (poisoned.has(stream.session!)) {
        if (method === 'POST' && path === '/sandboxes' && key && !sandboxes.has(key)) sandboxes.set(key, `sbx-${++next}`);
        stream.close(NGHTTP2_ENHANCE_YOUR_CALM);
        return;
      }
      if (method === 'PUT' && path === '/huge') {
        poisoned.add(stream.session!);
        stream.close(NGHTTP2_ENHANCE_YOUR_CALM);
        return;
      }
      if (path === '/refuse-once') {
        if (hits.get(`${method} ${path}`) === 1) return stream.close(NGHTTP2_REFUSED_STREAM);
        return json(200, { ok: true });
      }
      if (path === '/goaway-once') {
        // The GOAWAY names the stream before this one as the last processed, so this request provably was not.
        if (hits.get(`${method} ${path}`) === 1) return stream.session!.goaway(NGHTTP2_NO_ERROR, stream.id! - 2);
        return json(200, { ok: true });
      }
      if (path === '/reset-after-work') return stream.close(NGHTTP2_INTERNAL_ERROR);
      const count = hits.get(`${method} ${path}`)!;
      // The API sheds load with 503 or limits a caller with 429, naming the error and when to come back.
      if (path === '/shed-once' && count === 1) return json(503, { error_code: 'overloaded', message: 'retry in a second' }, { 'retry-after': '0' });
      if (path === '/limited-once' && count === 1) return json(429, { error_code: 'file_rate_limited', message: 'slow down' }, { 'retry-after': '0' });
      if (path === '/shed-once' || path === '/limited-once') return json(200, { ok: true });
      if (path === '/shed-always') return json(503, { error_code: 'overloaded', message: 'retry in a second' }, { 'retry-after': '0' });
      if (path === '/proxy-503') {
        stream.respond({ ':status': 503, 'content-type': 'text/html' });
        return stream.end('<html>unavailable</html>');
      }
      if (path === '/hang') return;

      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        const body = Buffer.concat(chunks);
        if (method === 'PUT' && path.startsWith('/upload')) {
          uploads.push({ bytes: body.length, length: headers['content-length'] as string | undefined });
          stream.respond({ ':status': 204 });
          stream.end();
          return;
        }
        if (method === 'POST' && path === '/sandboxes') {
          let parsed: { templateID?: string };
          try {
            parsed = JSON.parse(body.toString('utf8')) as { templateID?: string };
          } catch {
            return;
          }
          if (!key) return json(400, { message: 'no idempotency key' });
          if (parsed.templateID === 'slow-first' && conflicts++ === 0) {
            return json(409, { code: 409, error_code: 'conflict', message: 'the first request with this key is still running' }, { 'retry-after': '0' });
          }
          if (parsed.templateID === 'busy-once' && (hits.get('busy') ?? 0) === 0) {
            hits.set('busy', 1);
            keys.push(key);
            return json(503, { code: 503, error_code: 'capacity', message: 'no node could take the create' }, { 'retry-after': '0' });
          }
          if (parsed.templateID === 'building-once' && (hits.get('building') ?? 0) === 0) {
            hits.set('building', 1);
            keys.push(key);
            return json(202, { error_code: 'image_building', message: 'the image is being prepared' }, { 'retry-after': '0' });
          }
          if (parsed.templateID === 'error-once' && (hits.get('error') ?? 0) === 0) {
            hits.set('error', 1);
            keys.push(key);
            return json(500, { code: 500, error_code: 'internal', message: 'internal error' }, { 'retry-after': '0' });
          }
          if (parsed.templateID === 'edge-502') {
            keys.push(key);
            stream.respond({ ':status': 502, 'content-type': 'text/html', 'retry-after': '0' });
            return stream.end('<html>bad gateway</html>');
          }
          if (['busy-once', 'building-once', 'error-once'].includes(parsed.templateID ?? '')) keys.push(key);
          const known = sandboxes.get(key);
          if (parsed.templateID === 'paused') return json(201, { sandboxID: 'sbx-p' });
          const id = known ?? `sbx-${++next}`;
          sandboxes.set(key, id);
          if (!known && parsed.templateID === 'lose-answer') return stream.close(NGHTTP2_INTERNAL_ERROR);
          if (!known && parsed.templateID === 'burst' && burst.left > 0 && --burst.left === 0) {
            // Mid-burst the server drops the whole connection after acting on this create.
            stream.session!.destroy();
            return;
          }
          return json(201, { sandboxID: id });
        }
        if (method === 'POST' && path === '/sandboxes/sbx-p/pause') return json(409, { code: 409, error_code: 'already_paused', message: 'Nothing changed' });
        if (method === 'POST' && path === '/sandboxes/sbx-p/resume') return json(409, { code: 409, error_code: 'already_running', message: 'Nothing changed' });
        if (method === 'POST' && path === '/sandboxes/sbx-p/exec') {
          stream.respond({ ':status': 200, 'content-type': 'application/x-ndjson' });
          stream.end(JSON.stringify({ exit: { exitCode: -1, signal: 9 } }) + '\n');
          return;
        }
        if (method === 'GET' && path === '/proxy-error') {
          stream.respond({ ':status': 502, 'content-type': 'text/html', 'x-request-id': 'req-edge' });
          stream.end('<html>' + 'x'.repeat(1000) + '</html>');
          return;
        }
        if (method === 'GET') return json(200, { ok: true });
        json(500, { message: `unexpected ${method} ${path}` });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    closeSessions();
    for (const session of open) session.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    closeSessions();
    sandboxes.clear();
    hits.clear();
  });

  const config = () => ({ apiKey: 'test-key', apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  const compute = () => styne(config());

  it('replaces a session the server answered with ENHANCE_YOUR_CALM, and creates after it leave no sandbox behind', async () => {
    const before = connections;
    const error = (await request(config(), 'PUT', '/huge', { body: 'x', timeoutMs: 2_000 }).catch((e: unknown) => e)) as RequestError;
    expect(error.message).toMatch(/ENHANCE_YOUR_CALM/);
    // Each attempt went out on a new connection, and each one was poisoned in turn.
    expect(hits.get('PUT /huge')).toBe(3);

    const created = [];
    for (let i = 0; i < 5; i++) created.push((await compute().instances.create({ templateId: 'base' })).instanceId);
    expect(new Set(created).size).toBe(5);
    expect([...sandboxes.values()].sort()).toEqual([...created].sort());
    expect(connections - before).toBe(4);
  });

  it('does not send a large body again after the server refused it', async () => {
    const body = Buffer.alloc(BULK_BODY_BYTES, 1);
    const error = (await request(config(), 'PUT', '/huge-bulk', { body }).catch((e: unknown) => e)) as RequestError;
    expect(error.message).toMatch(/ENHANCE_YOUR_CALM/);
    expect(hits.get('PUT /huge-bulk')).toBe(1);
    await expect(request(config(), 'GET', '/ping')).resolves.toMatchObject({ status: 200 });
  });

  it('sends a create again under the same key when its answer is lost, so exactly one sandbox exists', async () => {
    const sandbox = await compute().instances.create({ templateId: 'lose-answer' });
    expect(hits.get('POST /sandboxes')).toBe(2);
    expect([...sandboxes.values()]).toEqual([sandbox.instanceId]);
  });

  it('waits while the first request under a key is still being served', async () => {
    conflicts = 0;
    const sandbox = await compute().instances.create({ templateId: 'slow-first' });
    expect(hits.get('POST /sandboxes')).toBe(2);
    expect([...sandboxes.values()]).toEqual([sandbox.instanceId]);
  });

  it('repeats a create the API answered with 503 under the same key, and one with 202 under a new key', async () => {
    keys.length = 0;
    const busy = await compute().instances.create({ templateId: 'busy-once' });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect([...sandboxes.values()]).toEqual([busy.instanceId]);
    keys.length = 0;
    await compute().instances.create({ templateId: 'building-once' });
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('treats a pause of a paused sandbox and a resume of a running one as done', async () => {
    const sandbox = await compute().instances.create({ templateId: 'paused' });
    expect(sandbox.instanceId).toBe('sbx-p');
    await expect(sandbox.pause!()).resolves.toBeUndefined();
    await expect(sandbox.resume!()).resolves.toBeUndefined();
  });

  it('reports a command killed by a signal as 128 + the signal', async () => {
    const sandbox = await compute().instances.create({ templateId: 'paused' });
    expect((await sandbox.runCommand('kill -9 $$')).exitCode).toBe(137);
  });

  it('keeps the start of an error page and the request id header', async () => {
    const reply = await request(config(), 'GET', '/proxy-error');
    const error = (() => {
      try {
        expectStatus(reply, 'read', [200]);
      } catch (e) {
        return e as StyneApiError;
      }
    })();
    expect(error).toBeInstanceOf(StyneApiError);
    expect(error!.requestId).toBe('req-edge');
    expect(error!.message.length).toBeLessThan(400);
  });

  it('retries a non-idempotent request the server refused unprocessed (REFUSED_STREAM) on the same session', async () => {
    const before = connections;
    await expect(request(config(), 'POST', '/refuse-once', { body: '{}' })).resolves.toMatchObject({ status: 200 });
    expect(hits.get('POST /refuse-once')).toBe(2);
    expect(connections - before).toBe(1);
  });

  it('repeats a safe request the API shed (503) or limited (429) after its Retry-After', async () => {
    await expect(request(config(), 'GET', '/shed-once')).resolves.toMatchObject({ status: 200 });
    expect(hits.get('GET /shed-once')).toBe(2);
    await expect(request(config(), 'PUT', '/limited-once', { body: 'x' })).resolves.toMatchObject({ status: 200 });
    expect(hits.get('PUT /limited-once')).toBe(2);
  });

  it('repeats a shed request twice at most, never a non-idempotent one, and not a bare proxy 503', async () => {
    await expect(request(config(), 'GET', '/shed-always')).resolves.toMatchObject({ status: 503 });
    expect(hits.get('GET /shed-always')).toBe(3);
    await expect(request(config(), 'POST', '/shed-always', { body: '{}' })).resolves.toMatchObject({ status: 503 });
    expect(hits.get('POST /shed-always')).toBe(1);
    await expect(request(config(), 'GET', '/proxy-503')).resolves.toMatchObject({ status: 503 });
    expect(hits.get('GET /proxy-503')).toBe(1);
    await expect(request(config(), 'GET', '/shed-always', { repeatWhenBusy: false })).resolves.toMatchObject({ status: 503 });
    expect(hits.get('GET /shed-always')).toBe(4);
  });

  it('repeats a create answered 500 under the same key, and a proxy 502 twice at most', async () => {
    keys.length = 0;
    const sandbox = await compute().instances.create({ templateId: 'error-once' });
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect([...sandboxes.values()]).toEqual([sandbox.instanceId]);
    keys.length = 0;
    await expect(compute().instances.create({ templateId: 'edge-502' })).rejects.toMatchObject({ status: 502 });
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(1);
  });

  it('retries a request above the last stream id of a GOAWAY on a new session', async () => {
    const before = connections;
    await request(config(), 'GET', '/ping');
    await expect(request(config(), 'POST', '/goaway-once', { body: '{}' })).resolves.toMatchObject({ status: 200 });
    expect(hits.get('POST /goaway-once')).toBe(2);
    expect(connections - before).toBe(2);
  });

  it('never repeats a non-idempotent request without a key whose outcome is unknown, and the next call still works', async () => {
    const error = (await request(config(), 'POST', '/reset-after-work', { body: '{}' }).catch((e: unknown) => e)) as RequestError;
    expect(error.delivery).toBe('unknown');
    expect(hits.get('POST /reset-after-work')).toBe(1);
    await expect(request(config(), 'GET', '/ping')).resolves.toMatchObject({ status: 200 });
  });

  it('repeats an idempotent request whose outcome is unknown', async () => {
    const error = (await request(config(), 'DELETE', '/reset-after-work').catch((e: unknown) => e)) as RequestError;
    expect(error.delivery).toBe('unknown');
    expect(hits.get('DELETE /reset-after-work')).toBe(3);
  });

  it('survives a connection dropped in the middle of a burst of creates with one sandbox per create', async () => {
    burst = { left: 7 };
    const created = await Promise.all(
      Array.from({ length: 24 }, () => compute().instances.create({ templateId: 'burst' }).then((s) => s.instanceId)),
    );
    expect(new Set(created).size).toBe(24);
    expect([...sandboxes.values()].sort()).toEqual([...created].sort());
    await expect(request(config(), 'GET', '/ping')).resolves.toMatchObject({ status: 200 });
  });

  it('reports a connection that never opened as unsent', async () => {
    const closed = http2.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const { port } = closed.address() as AddressInfo;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const error = (await request({ apiKey: 'k', apiUrl: `http://127.0.0.1:${port}` }, 'POST', '/sandboxes', { body: '{}' }).catch(
      (e: unknown) => e,
    )) as RequestError;
    expect(error.delivery).toBe('unsent');
  });

  it('streams a large body on a session of its own with its length', async () => {
    const before = connections;
    uploads.length = 0;
    await request(config(), 'GET', '/ping');
    const body = Buffer.alloc(BULK_BODY_BYTES + 3 * 1024 * 1024, 7);
    await expect(request(config(), 'PUT', '/upload', { body, contentType: 'application/octet-stream' })).resolves.toMatchObject({ status: 204 });
    await expect(request(config(), 'PUT', '/upload-small', { body: 'hi' })).resolves.toMatchObject({ status: 204 });
    expect(uploads).toEqual([
      { bytes: body.length, length: String(body.length) },
      { bytes: 2, length: '2' },
    ]);
    expect(connections - before).toBe(2);
  });

  it('fails the requests of a session that stops answering PINGs, and the next request opens a new one', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const connect = http2.connect;
    const opened: http2.ClientHttp2Session[] = [];
    const spy = vi.spyOn(http2, 'connect').mockImplementation(((...args: Parameters<typeof http2.connect>) => {
      const session = connect(...args);
      opened.push(session);
      return session;
    }) as typeof http2.connect);
    try {
      await request(config(), 'GET', '/ping');
      const hanging = request(config(), 'POST', '/hang', { body: '{}', timeoutMs: 0 }).catch((e: unknown) => e as RequestError);
      await new Promise((resolve) => setTimeout(resolve, 50));
      vi.spyOn(opened[0], 'ping').mockReturnValue(false);
      vi.advanceTimersByTime(15_000);
      const error = (await hanging) as RequestError;
      expect(error.delivery).toBe('unknown');
      await expect(request(config(), 'GET', '/ping')).resolves.toMatchObject({ status: 200 });
      expect(opened).toHaveLength(2);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('opens sessions with large receive windows', async () => {
    const connect = http2.connect;
    const opened: http2.ClientHttp2Session[] = [];
    const spy = vi.spyOn(http2, 'connect').mockImplementation(((...args: Parameters<typeof http2.connect>) => {
      const session = connect(...args);
      opened.push(session);
      return session;
    }) as typeof http2.connect);
    try {
      await request(config(), 'GET', '/ping');
      expect(opened).toHaveLength(1);
      expect(opened[0].state.effectiveLocalWindowSize).toBeGreaterThanOrEqual(32 * 1024 * 1024);
      expect(opened[0].localSettings.initialWindowSize).toBe(8 * 1024 * 1024);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('retryAfterMs', () => {
  const reply = (value?: string) => ({ status: 503, body: Buffer.alloc(0), headers: value === undefined ? {} : { 'retry-after': value } });

  it('reads seconds and HTTP dates, and falls back without a usable header', () => {
    expect(retryAfterMs(reply('2'), 1000)).toBe(2000);
    expect(retryAfterMs(reply(), 1000)).toBe(1000);
    expect(retryAfterMs(reply('soon'), 1000)).toBe(1000);
    const inFive = retryAfterMs(reply(new Date(Date.now() + 5000).toUTCString()), 1000);
    expect(inFive).toBeGreaterThan(3000);
    expect(inFive).toBeLessThanOrEqual(5000);
    expect(retryAfterMs(reply(new Date(0).toUTCString()), 1000)).toBe(0);
  });
});

describe('mayRetry', () => {
  const fail = (delivery: RequestError['delivery']) => Object.assign(new Error('x'), { delivery }) as RequestError;

  it('repeats only what never arrived, or what is harmless to repeat', () => {
    expect(mayRetry('POST', {}, fail('unsent'))).toBe(true);
    expect(mayRetry('POST', {}, fail('unknown'))).toBe(false);
    expect(mayRetry('POST', { idempotencyKey: 'k' }, fail('unknown'))).toBe(true);
    expect(mayRetry('PUT', {}, fail('unknown'))).toBe(true);
    expect(mayRetry('GET', {}, fail('final'))).toBe(false);
  });
});
