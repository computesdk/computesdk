import { createServer as createH2Server, type Http2Server } from 'node:http2';
import { createServer as createH1Server, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http2Fetch } from '../http2-fetch';

const servers: (Http2Server | Server)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function listen<S extends Http2Server | Server>(server: S): Promise<string> {
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// Echoes method, path, the x-test header and the body after `delayMs`, counting sessions and peak
// concurrency.
function echoServer(delayMs = 0) {
  const stats = { sessions: 0, open: 0, peak: 0 };
  const server = createH2Server();
  server.on('session', () => stats.sessions++);
  server.on('stream', (stream, headers) => {
    stats.peak = Math.max(stats.peak, ++stats.open);
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () =>
      setTimeout(() => {
        stats.open--;
        if (stream.destroyed) return;
        stream.respond({ ':status': headers[':path'] === '/missing' ? 404 : 200, 'content-type': 'application/json', 'set-cookie': ['a=1', 'b=2'] });
        stream.end(JSON.stringify({ method: headers[':method'], path: headers[':path'], test: headers['x-test'], body: Buffer.concat(chunks).toString() }));
      }, delayMs),
    );
  });
  return { server, stats };
}

describe('http2Fetch', () => {
  it('multiplexes concurrent requests with bodies on one session', async () => {
    const { server, stats } = echoServer(50);
    const origin = await listen(server);
    const { fetch } = http2Fetch(origin);

    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        fetch(new Request(`${origin}/items?i=${i}`, { method: 'POST', body: JSON.stringify({ i }), headers: { 'x-test': `t${i}` } })).then((r) => r.json()),
      ),
    );

    expect(results[7]).toEqual({ method: 'POST', path: '/items?i=7', test: 't7', body: '{"i":7}' });
    expect(stats.sessions).toBe(1);
    expect(stats.peak).toBe(20);
    // Serial delivery would take 20 x 50 ms.
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('passes status and repeated headers through', async () => {
    const origin = await listen(echoServer().server);
    const response = await http2Fetch(origin).fetch(new Request(`${origin}/missing`));
    expect(response.status).toBe(404);
    expect(response.headers.get('set-cookie')).toBe('a=1, b=2');
  });

  it('rejects with the abort reason and cancels the stream', async () => {
    const { server, stats } = echoServer(1000);
    const origin = await listen(server);
    const controller = new AbortController();
    const pending = http2Fetch(origin).fetch(new Request(`${origin}/slow`, { signal: controller.signal }));
    await vi.waitFor(() => expect(stats.open).toBe(1));
    controller.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
  });

  it('sends other origins to the global fetch', async () => {
    const origin = await listen(echoServer().server);
    const global = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('elsewhere'));
    const response = await http2Fetch(origin).fetch(new Request('https://hub.example.com/v2/auth/token', { method: 'POST', body: 'x' }));
    expect(await response.text()).toBe('elsewhere');
    expect(global).toHaveBeenCalledOnce();
  });

  it('falls back to the global fetch when the server does not speak HTTP/2', async () => {
    const origin = await listen(createH1Server((req, res) => res.end('h1')));
    const global = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('fallback'));
    const { fetch } = http2Fetch(origin);

    const first = await fetch(new Request(`${origin}/a`, { method: 'POST', body: 'payload' }));
    expect(await first.text()).toBe('fallback');
    const sent = global.mock.calls[0][0] as Request;
    expect(sent.url).toBe(`${origin}/a`);
    expect(await sent.text()).toBe('payload');
  });

  it('does not keep the process alive once requests finish', async () => {
    const origin = await listen(echoServer().server);
    const script = fileURLToPath(new URL('./fixtures/exit-after-request.ts', import.meta.url));
    // Async, not spawnSync: the server runs in this process and must keep answering. A child that
    // can't exit is killed by the timeout, which rejects.
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', script, origin], { timeout: 10_000 });
    expect(stdout.trim()).toBe('200');
  });
});

describe('provider wiring', () => {
  it('constructs its SDK client with the HTTP/2 transport', async () => {
    // The SDK accepts only https API URLs; nothing listens on this port, so the session fails to open
    // and requests would fall back. What's under test is the client construction at sign-in.
    vi.stubEnv('SANDBOXES_API_URL', 'https://127.0.0.1:9/sandboxes');
    vi.stubEnv('DOCKER_SANDBOXES_USERNAME', 'user');
    vi.stubEnv('DOCKER_SANDBOXES_TOKEN', 'token');
    // The import-time token exchange goes to Docker Hub through the global fetch.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    vi.resetModules();
    try {
      // Signing in at import constructs the client, and the SDK throws there for an injected fetch
      // declared without transportRetries: 'none'.
      await expect(import('../index')).resolves.toHaveProperty('dockerSandboxes');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
