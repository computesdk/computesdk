import http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeSessions, httpRequest, preconnect } from '../transport';

/** A loopback h2c server: counts sessions, records requests, answers JSON. */
let server: http2.Http2Server;
let base = '';
let sessions = 0;
const seen: { method: string; path: string; auth: string; body: string }[] = [];

beforeAll(async () => {
  server = http2.createServer();
  server.on('session', () => {
    sessions += 1;
  });
  server.on('stream', (stream, headers) => {
    let body = '';
    stream.on('data', (c) => (body += c));
    stream.on('end', () => {
      const path = String(headers[':path']);
      seen.push({ method: String(headers[':method']), path, auth: String(headers.authorization ?? ''), body });
      const reply = () => {
        if (stream.destroyed || stream.closed) return;
        stream.respond({ ':status': path === '/missing' ? 404 : 200, 'content-type': 'application/json' });
        stream.end(JSON.stringify({ ok: true, path }));
      };
      if (path === '/slow') setTimeout(reply, 500);
      else reply();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  closeSessions();
  server.close();
});

afterEach(() => {
  closeSessions();
  vi.unstubAllEnvs();
  sessions = 0;
  seen.length = 0;
});

describe('kosa8 HTTP/2 transport', () => {
  it('sends 100 concurrent requests over one session', async () => {
    vi.stubEnv('KOSA8_HTTP_TRANSPORT', 'http2');
    const rs = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        httpRequest(`${base}/v1/sandboxes/${i}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
          body: JSON.stringify({ i }),
        }),
      ),
    );
    expect(rs.every((r) => r.ok && r.status === 200)).toBe(true);
    expect(sessions).toBe(1);
    expect(seen).toHaveLength(100);
    expect(seen[0].auth).toBe('Bearer k');
    expect(JSON.parse(rs[7].text).path).toBe('/v1/sandboxes/7');
    expect(rs[7].headers['content-type']).toBe('application/json');
  });

  it('opens the session on preconnect, before the first request', async () => {
    vi.stubEnv('KOSA8_HTTP_TRANSPORT', 'http2');
    preconnect(base);
    await new Promise((r) => setTimeout(r, 100));
    expect(sessions).toBe(1);
    expect(seen).toHaveLength(0);
    await httpRequest(`${base}/x`, { method: 'GET', headers: {} });
    expect(sessions).toBe(1);
  });

  it('passes statuses through and honours an abort signal', async () => {
    vi.stubEnv('KOSA8_HTTP_TRANSPORT', 'http2');
    const r = await httpRequest(`${base}/missing`, { method: 'GET', headers: {} });
    expect(r.status).toBe(404);
    expect(r.ok).toBe(false);
    await expect(
      httpRequest(`${base}/slow`, { method: 'GET', headers: {}, signal: AbortSignal.timeout(50) }),
    ).rejects.toThrow();
  });

  it('uses fetch when told to, and for plain http without the test mode', async () => {
    const fetchSpy = vi.fn(async () => new Response('{"via":"fetch"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubEnv('KOSA8_HTTP_TRANSPORT', 'fetch');
    expect((await httpRequest(`${base}/a`, { method: 'GET', headers: {} })).text).toBe('{"via":"fetch"}');
    vi.stubEnv('KOSA8_HTTP_TRANSPORT', '');
    expect((await httpRequest(`${base}/b`, { method: 'GET', headers: {} })).text).toBe('{"via":"fetch"}');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(sessions).toBe(0);
    vi.unstubAllGlobals();
  });

  it('falls back to fetch for an origin whose session cannot be opened', async () => {
    vi.stubEnv('KOSA8_HTTP_TRANSPORT', 'http2');
    const fetchSpy = vi.fn(async () => new Response('{"via":"fetch"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    // Nothing listens on port 1.
    const r = await httpRequest('http://127.0.0.1:1/x', { method: 'GET', headers: {} });
    expect(r.text).toBe('{"via":"fetch"}');
    vi.unstubAllGlobals();
  });
});

describe('kosa8 HTTP/2 transport keeps the process alive while requests are in progress', () => {
  it('finishes a burst after a preconnect left the session idle', async () => {
    const { execFileSync } = await import('node:child_process');
    const { resolve } = await import('node:path');
    const src = resolve(__dirname, '../transport.ts');
    // A child process with nothing else to keep it alive: it must not exit before the replies.
    const script = `
      const http2 = require('node:http2');
      const srv = http2.createServer();
      srv.on('stream', (st) => setTimeout(() => { st.respond({ ':status': 200 }); st.end('ok'); }, 200));
      srv.listen(0, '127.0.0.1', async () => {
        const base = 'http://127.0.0.1:' + srv.address().port;
        process.env.KOSA8_HTTP_TRANSPORT = 'http2';
        const t = await import(${JSON.stringify(src)});
        t.preconnect(base);
        await new Promise((r) => setTimeout(r, 100));
        srv.unref();
        const rs = await Promise.all(Array.from({ length: 20 }, () => t.httpRequest(base + '/x', { method: 'GET', headers: {} })));
        console.log(rs.filter((r) => r.text === 'ok').length);
        t.closeSessions();
      });`;
    const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '-e', script], { encoding: 'utf8' });
    expect(out.trim()).toBe('20');
  });
});
