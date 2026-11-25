import * as http2 from 'node:http2';
import * as net from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONNECT_TIMEOUT_MS, SESSIONS_PER_ORIGIN, send } from '../transport';
import { runWithProvider } from './child-process';
import { json, killSession, startApi, until, type FakeApi, type Reply, type Seen } from './fake-api';

// The pool and its retry rules, against a local plaintext HTTP/2 server.

const ok: Reply = { status: 200, text: 'ok' };
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const call = (base: string, method: string, idempotent: boolean) =>
  send({
    method,
    url: new URL('/v1/sandboxes/sbx_1/commands', base),
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' || method === 'DELETE' ? undefined : '{"cmd":"true"}',
    idempotent,
  });
const get = (base: string) => call(base, 'GET', true);

/** Requests per server session, in order of first use. */
function perSession(seen: Seen[]): number[] {
  const counts = new Map<http2.ServerHttp2Session, number>();
  for (const { session } of seen) counts.set(session, (counts.get(session) ?? 0) + 1);
  return [...counts.values()];
}

/** A TCP server that accepts connections and never says a word, so a TLS handshake against it never ends. */
async function silentServer(): Promise<{ url: string; connections: () => number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  let connections = 0;
  const server = net.createServer((socket) => {
    connections += 1;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `https://127.0.0.1:${port}`,
    connections: () => connections,
    close: () => new Promise((done) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => done());
    }),
  };
}

describe('HTTP/2 pool', () => {
  let api: FakeApi;

  beforeEach(async () => {
    api = await startApi();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await api.close();
  });

  /** One request, then every pool session connected on both ends. */
  async function warm(): Promise<void> {
    await get(api.url);
    await until(() => api.sessions.size === SESSIONS_PER_ORIGIN);
    await sleep(50);
  }

  it('opens the pool once and sends one request after another over the same warm session', async () => {
    api.otherwise(() => ok);
    await warm();
    for (let i = 0; i < 10; i += 1) expect((await get(api.url)).status).toBe(200);
    expect(api.sessions.size).toBe(SESSIONS_PER_ORIGIN);
    expect(perSession(api.requests.slice(1))).toEqual([10]);
  });

  it('spreads a burst over the whole pool', async () => {
    api.otherwise(() => ({ ...ok, delayMs: 20 }));
    await warm();
    const answers = await Promise.all(Array.from({ length: 4 * SESSIONS_PER_ORIGIN }, () => get(api.url)));
    expect(answers.every(({ status }) => status === 200)).toBe(true);
    expect(api.sessions.size).toBe(SESSIONS_PER_ORIGIN);
    expect(perSession(api.requests.slice(1))).toEqual(Array(SESSIONS_PER_ORIGIN).fill(4));
  });

  it('spreads a cold burst over the pool while it connects', async () => {
    api.otherwise(() => ({ ...ok, delayMs: 20 }));
    const answers = await Promise.all(Array.from({ length: 2 * SESSIONS_PER_ORIGIN }, () => get(api.url)));
    expect(answers.every(({ status }) => status === 200)).toBe(true);
    expect(perSession(api.requests)).toEqual(Array(SESSIONS_PER_ORIGIN).fill(2));
  });

  it('replaces sessions that closed', async () => {
    api.otherwise(() => ok);
    await warm();
    for (const session of api.sessions) session.destroy();
    await sleep(50);
    expect((await get(api.url)).status).toBe(200);
    await until(() => api.sessions.size === 2 * SESSIONS_PER_ORIGIN);
  });

  it('sends nothing more on a session told to go away, and opens its replacement', async () => {
    api.otherwise(() => ok);
    await warm();
    const leaving = api.requests[0].session;
    leaving.goaway();
    await sleep(50);
    for (let i = 0; i < 5; i += 1) await get(api.url);
    expect(api.requests.slice(1).some(({ session }) => session === leaving)).toBe(false);
    await until(() => api.sessions.size === SESSIONS_PER_ORIGIN + 1);
  });

  it('gives up on a connect that never completes within the bound, and tries a request that never left once more', async () => {
    const silent = await silentServer();
    const realSetTimeout = globalThis.setTimeout;
    const delays: unknown[] = [];
    // The bound is 10 s; shorten it so the test does not wait it out.
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void, delay?: number, ...rest: unknown[]) => {
      delays.push(delay);
      return realSetTimeout(handler, delay === CONNECT_TIMEOUT_MS ? 100 : delay, ...rest);
    }) as typeof setTimeout);
    try {
      const start = Date.now();
      // A command POST: sent again only because it never left the process.
      await expect(call(silent.url, 'POST', false)).rejects.toThrow(/took more than 10000 ms[\s\S]*\(tried twice\)/);
      // At most two bounds: the first session's, then the one the second try waited on.
      expect(Date.now() - start).toBeLessThan(2_000);
      expect(delays.every((delay) => delay === CONNECT_TIMEOUT_MS)).toBe(true);
      // The pool, plus at least one session opened to replace a dropped one.
      await until(() => silent.connections() > SESSIONS_PER_ORIGIN);
    } finally {
      await silent.close();
    }
  });

  it('fails at once when the connection is refused', async () => {
    const closed = await startApi();
    const url = closed.url;
    await closed.close();
    const start = Date.now();
    await expect(get(url)).rejects.toThrow(/ECONNREFUSED/);
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});

describe('sending a request again', () => {
  let api: FakeApi;

  beforeEach(async () => {
    api = await startApi();
  });

  afterEach(async () => {
    await api.close();
  });

  it.each(['GET', 'PUT', 'DELETE'])('sends a %s again on another session when its connection dies before the answer', async (method) => {
    api.reply(killSession, ok);
    expect((await call(api.url, method, true)).status).toBe(200);
    expect(api.requests.map((seen) => seen.method)).toEqual([method, method]);
    expect(api.requests[0].session).not.toBe(api.requests[1].session);
  });

  it('does not send a command POST again once it may have reached the server', async () => {
    api.reply(killSession, ok);
    await expect(call(api.url, 'POST', false)).rejects.toThrow(/got no answer[\s\S]*not sent again/);
    expect(api.requests).toHaveLength(1);
  });

  it('sends a POST that carries an Idempotency-Key again', async () => {
    api.reply(killSession, ok);
    expect((await call(api.url, 'POST', true)).status).toBe(200);
    expect(api.requests).toHaveLength(2);
    expect(api.requests[1].body).toBe(api.requests[0].body);
  });

  it('sends a command POST again when the server refused its stream, as it promises it did not act on it', async () => {
    api.reply((_seen, stream) => stream.close(http2.constants.NGHTTP2_REFUSED_STREAM), json(200, { ok: true }));
    expect((await call(api.url, 'POST', false)).status).toBe(200);
    expect(api.requests).toHaveLength(2);
  });

  it('does not send even a GET again once its answer started', async () => {
    api.reply((_seen, stream) => {
      stream.respond({ ':status': 200 });
      stream.write('{"par');
      setTimeout(() => stream.session?.destroy(), 10);
    }, ok);
    await expect(get(api.url)).rejects.toThrow(/answer was cut off/);
    expect(api.requests).toHaveLength(1);
  });
});

describe('process lifetime', () => {
  let api: FakeApi;
  const RECORD = { id: 'sbx_1', name: 'swift-otter', session: 'headless', state: 'ready', createdAt: 0, expiresAt: 0, timeoutMs: 0, idleTimeoutMs: 0 };

  beforeEach(async () => {
    api = await startApi();
  });

  afterEach(async () => {
    await api.close();
  });

  it('lets a script that used the provider exit on its own, with its pool still open', async () => {
    api.otherwise(() => json(200, RECORD));
    // The server never closes the child's sessions: only their being unref'd lets it exit.
    const result = await runWithProvider(`
      const found = await provider.offstage({ apiKey: 'sk_offstage_test', baseUrl: ${JSON.stringify(api.url)} }).sandbox.getById('sbx_1');
      console.log('found', found.sandboxId);
    `, {});
    expect(result, result.stderr).toMatchObject({ killed: false, code: 0 });
    expect(result.stdout).toContain('found sbx_1');
    expect(api.sessions.size).toBe(SESSIONS_PER_ORIGIN);
  }, 30_000);

  it('holds the process open while a request waits for its answer', async () => {
    api.otherwise(() => ({ status: 200, json: RECORD, delayMs: 500 }));
    // Not awaited: only the request in flight can keep this process alive.
    const result = await runWithProvider(`
      provider.offstage({ apiKey: 'sk_offstage_test', baseUrl: ${JSON.stringify(api.url)} }).sandbox.getById('sbx_1')
        .then((found) => console.log('found', found.sandboxId));
    `, {});
    expect(result, result.stderr).toMatchObject({ killed: false, code: 0 });
    expect(result.stdout).toContain('found sbx_1');
  }, 30_000);
});
