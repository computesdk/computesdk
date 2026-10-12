import { createServer as createH2Server, createSecureServer, type Http2Server, type Http2SecureServer } from 'node:http2';
import { createServer as createH1Server, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { endpointHttp2Fetch, http2Fetch } from '../http2-fetch';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const servers: (Http2Server | Http2SecureServer | Server)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function listen<S extends Http2Server | Http2SecureServer | Server>(server: S): Promise<string> {
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

// Answers with the :authority each request arrived with, counting sessions.
function authorityServer(server: Http2Server | Http2SecureServer = createH2Server()) {
  const stats = { sessions: 0 };
  server.on('session', () => stats.sessions++);
  server.on('stream', (stream, headers) => {
    stream.respond({ ':status': 200 });
    stream.end(String(headers[':authority']));
  });
  return { server, stats };
}

// A throwaway certificate for `names`, made with openssl at test time.
function certificate(names: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'h2cert-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=test',
    '-addext', `subjectAltName=${names.map((n) => `DNS:${n}`).join(',')}`, '-keyout', join(dir, 'key'), '-out', join(dir, 'cert')], { stdio: 'ignore' });
  return { key: readFileSync(join(dir, 'key')), cert: readFileSync(join(dir, 'cert')) };
}

describe('endpointHttp2Fetch', () => {
  it('sends every sandbox host over the shared sessions with its own authority', async () => {
    const { server, stats } = authorityServer();
    const origin = await listen(server);
    const global = vi.spyOn(globalThis, 'fetch');
    const pool = endpointHttp2Fetch('sbx.test', origin, 4);
    pool.preconnect();

    const port = new URL(origin).port;
    const seen = await Promise.all(
      Array.from({ length: 20 }, (_, i) => pool.fetch(new Request(`http://s${i}.sbx.test:${port}/v1/processes/exec`, { method: 'POST', body: 'x' })).then((r) => r.text())),
    );

    expect(seen[13]).toBe(`s13.sbx.test:${port}`);
    expect(new Set(seen).size).toBe(20);
    expect(stats.sessions).toBe(4);
    expect(global).not.toHaveBeenCalled();
  });

  it('sends hosts outside the sandbox domain to the global fetch', async () => {
    const origin = await listen(authorityServer().server);
    const global = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('elsewhere'));
    const pool = endpointHttp2Fetch('sbx.test', origin, 2);
    for (const url of ['http://api.example.com/x', 'http://sbx.test/x', 'https://s1.sbx.test/x']) {
      expect(await (await pool.fetch(new Request(url))).text()).toBe('elsewhere');
    }
    expect(global).toHaveBeenCalledTimes(3);
  });

  it('uses a TLS session only when its certificate covers every sandbox host', async () => {
    for (const [names, pooled] of [[['*.sbx.test'], true], [['prewarm.sbx.test'], false]] as const) {
      const { server, stats } = authorityServer(createSecureServer(certificate([...names])));
      const port = new URL(await listen(server)).port;
      const global = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('fallback'));
      vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0'); // self-signed; only the SAN check is under test
      try {
        const pool = endpointHttp2Fetch('sbx.test', `https://127.0.0.1:${port}`, 1);
        const body = await (await pool.fetch(new Request(`https://s1.sbx.test:${port}/x`))).text();
        expect(body).toBe(pooled ? `s1.sbx.test:${port}` : 'fallback');
        expect(stats.sessions).toBe(1);
      } finally {
        vi.unstubAllEnvs();
        global.mockRestore();
      }
    }
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
