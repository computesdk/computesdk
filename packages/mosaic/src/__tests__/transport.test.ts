import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSecureServer, type Http2ServerRequest, type Http2ServerResponse, type ServerHttp2Session } from 'node:http2';
import { createServer as createHttpsServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import type { Agent } from 'undici';
import type { Socket } from 'node:net';
import { mosaic } from '../index.js';
import { acquireTransport } from '../transport.js';

// Trust only the checked-in localhost test CA. Production still uses normal
// TLS verification; no rejectUnauthorized override or global CA mutation.
vi.mock('undici', async () => {
  const actual = await vi.importActual<typeof import('undici')>('undici');
  return {
    ...actual,
    buildConnector: (options: Parameters<typeof actual.buildConnector>[0]) => actual.buildConnector({
      ...options,
      ca: readFileSync(resolve(__dirname, 'fixtures/tls-cert.pem')),
    }),
  };
});

const cert = readFileSync(resolve(__dirname, 'fixtures/tls-cert.pem'));
const key = readFileSync(resolve(__dirname, 'fixtures/tls-key.pem'));
const originalFetch = globalThis.fetch;
let fallback: Agent;
const cleanup: Array<() => Promise<void>> = [];

beforeEach(async () => {
  const { Agent, fetch } = await import('undici');
  fallback = new Agent({ allowH2: false, connect: { ca: cert } });
  // Native HTTP/1.1 fallback also needs the test CA. Preserve the candidate's
  // dispatcher when present and leave unrelated global dispatcher state alone.
  globalThis.fetch = vi.fn((input, init) => fetch(input as string, {
    ...init,
    dispatcher: (init as RequestInit & { dispatcher?: Agent })?.dispatcher ?? fallback,
  } as unknown as Parameters<typeof fetch>[1]) as unknown as Promise<globalThis.Response>);
});

afterEach(async () => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  await fallback.destroy();
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

type Request = IncomingMessage | Http2ServerRequest;
type Response = ServerResponse | Http2ServerResponse;

async function gateway(handler: (request: Request, response: Response) => void | Promise<void>, h2 = true, serverCert = cert) {
  const server = h2
    ? createSecureServer({ key, cert: serverCert, allowHTTP1: true })
    : createHttpsServer({ key, cert: serverCert, ALPNProtocols: ['http/1.1'] });
  const sessions = new Set<ServerHttp2Session>();
  const sockets = new Set<Socket>();
  const attempts: Array<{ method: string; url: string; version: string; authorization: string }> = [];
  server.on('session', (session: ServerHttp2Session) => {
    sessions.add(session);
    session.on('error', () => {});
  });
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('request', (request: Request, response: Response) => {
    request.on('error', () => {});
    response.on('error', () => {});
    attempts.push({
      method: request.method!, url: request.url!, version: request.httpVersion,
      authorization: String(request.headers.authorization ?? ''),
    });
    Promise.resolve(handler(request, response)).catch((error) => response.destroy(error));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  cleanup.push(async () => {
    for (const session of sessions) session.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((done) => server.close(() => done()));
  });
  return { url: `https://127.0.0.1:${(server.address() as { port: number }).port}`, sessions, sockets, attempts };
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function json(response: Response, value: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
describe.skipIf(nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 19))('Mosaic shared Node transport', () => {
  it('shares at most four H2 sessions across two 100-factory lifecycle bursts', async () => {
    let created = 0;
    let peak = 0;
    let active = 0;
    let activePosts = 0;
    let peakPosts = 0;
    const allocations = new Set<string>();
    const server = await gateway(async (request, response) => {
      active += 1;
      peak = Math.max(peak, active);
      if (request.method === 'POST') peakPosts = Math.max(peakPosts, ++activePosts);
      await sleep(3);
      if (request.method === 'POST' && request.url === '/v1/sandboxes') {
        const options = await body(request);
        expect(options).toEqual({ template: 'node-20', memory_mb: 4096, vcpu: 2, enable_ssh: false, network_enabled: true });
        const id = `sbx-${++created}`;
        allocations.add(id);
        json(response, { id, state: 'running', tti_ms: 1 });
      } else if (request.method === 'POST') {
        expect((await body(request)).cmd).toBe('node -v');
        json(response, { stdout: 'v20.0.0\n', stderr: '', exit_code: 0, tti_ms: 1 });
      } else {
        allocations.delete(request.url!.split('/')[3]);
        response.writeHead(204);
        response.end();
      }
      active -= 1;
      if (request.method === 'POST') activePosts -= 1;
    });
    for (let burst = 0; burst < 2; burst += 1) {
      await Promise.all(Array.from({ length: 100 }, async (_, i) => {
        const provider = mosaic({ baseUrl: server.url, apiKey: `test-${burst}-${i}` });
        const sandbox = await provider.sandbox.create();
        try {
          const result = await sandbox.runCommand('node -v');
          expect(result.stdout).toBe('v20.0.0\n');
          expect(result.exitCode).toBe(0);
        } finally {
          await sandbox.destroy();
        }
      }));
      expect(allocations.size).toBe(0);
    }
    expect(server.attempts).toHaveLength(600);
    expect(server.attempts.every((request) => request.version === '2.0')).toBe(true);
    expect(new Set(server.attempts.map((request) => request.authorization)).size).toBe(200);
    expect(server.sessions.size).toBeGreaterThan(0);
    expect(server.sessions.size).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(4);
    expect(peakPosts).toBeGreaterThan(4);
  });

  it('keeps HTTP/1.1 fallback concurrency and sends no HTTP probe', async () => {
    let active = 0;
    let peak = 0;
    const server = await gateway(async (_request, response) => {
      peak = Math.max(peak, ++active);
      await sleep(30);
      json(response, { sandboxes: [] });
      active -= 1;
    }, false);
    await Promise.all(Array.from({ length: 12 }, () => mosaic({ baseUrl: server.url }).sandbox.list()));
    expect(server.attempts).toHaveLength(12);
    expect(server.attempts.every((request) => request.version === '1.1')).toBe(true);
    expect(peak).toBeGreaterThan(4);
    expect(vi.mocked(globalThis.fetch).mock.calls.every(([, init]) => !('dispatcher' in init!))).toBe(true);
  });

  it('supports opting out with the existing fetch transport', async () => {
    const server = await gateway((_request, response) => json(response, { sandboxes: [] }));
    await mosaic({ baseUrl: server.url, http2: false }).sandbox.list();
    expect(server.sessions.size).toBe(0);
    expect(server.attempts[0].version).toBe('1.1');
  });

  it('rejects an already aborted create before any HTTP request', async () => {
    const server = await gateway((_request, response) => json(response, {}));
    const abort = new AbortController();
    abort.abort(new Error('cancelled before create'));
    await expect(mosaic({ baseUrl: server.url }).sandbox.create({ signal: abort.signal })).rejects.toThrow(/abort|cancel/i);
    expect(server.attempts).toHaveLength(0);
    expect(server.sockets.size).toBe(0);
  });

  it('rejects a TLS hostname mismatch before dispatching a POST', async () => {
    const mismatch = readFileSync(resolve(__dirname, 'fixtures/tls-mismatch-cert.pem'));
    const server = await gateway((_request, response) => json(response, {}), true, mismatch);
    await expect(mosaic({ baseUrl: server.url }).sandbox.create()).rejects.toThrow(/certificate|cert|IP/i);
    expect(server.attempts).toHaveLength(0);
  });

  it('cancels one pending negotiation without cancelling another caller', async () => {
    const server = await gateway((_request, response) => json(response, { id: 'sbx-ok', state: 'running' }));
    const abort = new AbortController();
    const provider = mosaic({ baseUrl: server.url });
    const cancelled = provider.sandbox.create({ signal: abort.signal });
    const healthy = provider.sandbox.create();
    abort.abort(new Error('cancel one'));
    await expect(cancelled).rejects.toThrow(/abort|cancel/i);
    expect((await healthy).sandboxId).toBe('sbx-ok');
    expect(server.attempts).toHaveLength(1);
  });

  it('holds its request slot until the response body finishes', async () => {
    let finish!: () => void;
    const waiting = new Promise<void>((done) => { finish = done; });
    let firstHeaders!: () => void;
    const headers = new Promise<void>((done) => { firstHeaders = done; });
    let count = 0;
    const server = await gateway(async (_request, response) => {
      if (++count === 1) {
        response.writeHead(200, { 'content-type': 'application/json' });
        (response as ServerResponse).write('{"sandboxes":[');
        firstHeaders();
        await waiting;
        response.end(']}');
      } else json(response, { sandboxes: [] });
    });
    const provider = mosaic({ baseUrl: server.url, maxConcurrentRequests: 1 });
    const first = provider.sandbox.list();
    await headers;
    const second = provider.sandbox.list();
    await sleep(30);
    expect(server.attempts).toHaveLength(1);
    finish();
    await Promise.all([first, second]);
    expect(server.attempts).toHaveLength(2);
  });

  it('enforces deadlines through a partial response and leaves other streams usable', async () => {
    let requests = 0;
    const server = await gateway((_request, response) => {
      if (++requests === 1) {
        response.writeHead(200, { 'content-type': 'application/json' });
        (response as ServerResponse).write('{"sandboxes":[');
      } else json(response, { sandboxes: [] });
    });
    const partial = mosaic({ baseUrl: server.url, requestTimeoutMs: 100 }).sandbox.list();
    const rejection = expect(partial).rejects.toThrow();
    while (server.attempts.length === 0) await sleep(1);
    expect(await mosaic({ baseUrl: server.url }).sandbox.list()).toEqual([]);
    await rejection;
    expect(server.attempts).toHaveLength(2);
  });

  it('does not replay an ambiguous POST after session loss and can reconnect', async () => {
    let count = 0;
    const server = await gateway(async (request, response) => {
      await body(request);
      if (++count === 1) (request as Http2ServerRequest).stream.session!.destroy();
      else json(response, { id: 'sbx-new', state: 'running' });
    });
    const provider = mosaic({ baseUrl: server.url, requestTimeoutMs: 1000 });
    const started = Date.now();
    await expect(provider.sandbox.create()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(500);
    await sleep(20);
    expect(count).toBe(1);
    expect((await provider.sandbox.create()).sandboxId).toBe('sbx-new');
    expect(count).toBe(2);
  });

  it('preserves gzip/unicode bodies, API errors and base URL paths', async () => {
    let calls = 0;
    const server = await gateway((request, response) => {
      expect(request.url).toBe('/prefix/v1/sandboxes');
      if (++calls === 1) {
        response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
        response.end(gzipSync(JSON.stringify({ sandboxes: [{ id: '日本語', template: 'node-20', memory_mb: 4096, vcpu: 2, state: 'running' }] })));
      } else json(response, { error: 'capacity', message: 'Try again later', remediation: 'Keep ownership' }, 507);
    });
    const provider = mosaic({ baseUrl: `${server.url}/prefix` });
    expect((await provider.sandbox.list())[0].sandboxId).toBe('日本語');
    await expect(provider.sandbox.list()).rejects.toThrow('capacity: Try again later: Keep ownership');
  });

  it('closes an idle H2 pool and negotiates a new session on reuse', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const server = await gateway((_request, response) => json(response, { sandboxes: [] }));
    const provider = mosaic({ baseUrl: server.url });
    await provider.sandbox.list();
    expect(server.sessions.size).toBe(1);
    await vi.advanceTimersByTimeAsync(30_001);
    await provider.sandbox.list();
    expect(server.sessions.size).toBe(2);
  });

  it('bounds busy origin entries and closes negotiated-but-unused sockets', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const servers = await Promise.all(Array.from({ length: 17 }, () => gateway((_request, response) => json(response, { sandboxes: [] }))));
    const leases = [];
    for (const server of servers) {
      leases.push(await acquireTransport(server.url, true, new AbortController().signal));
    }
    try {
      expect(leases.filter((lease) => lease.dispatcher).length).toBe(16);
      expect(servers[16].sockets.size).toBe(0);
    } finally {
      for (const lease of leases) lease.release();
    }
    await vi.advanceTimersByTimeAsync(30_001);
    const resumed = await acquireTransport(servers[16].url, true, new AbortController().signal);
    expect(resumed.dispatcher).toBeDefined();
    resumed.release();
    await vi.advanceTimersByTimeAsync(30_001);
  });
});
