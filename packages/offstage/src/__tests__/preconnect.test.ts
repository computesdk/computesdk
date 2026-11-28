import * as net from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSIONS_PER_ORIGIN } from '../transport';
import { runWithProvider } from './child-process';
import { until } from './fake-api';

// Import-time behaviour can only be seen on a freshly evaluated module, so each
// case clears the module registry and imports again under its own
// environment. A plain TCP server stands in for the API: it counts the
// connections the pool opens, and the TLS handshake that never completes
// against it is beside the point.

async function importFresh(): Promise<typeof import('../index')> {
  vi.resetModules();
  return import('../index');
}

interface CountingServer {
  url: string;
  connections: () => number;
  close: () => Promise<void>;
}

async function countingServer(): Promise<CountingServer> {
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

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('preconnect on import', () => {
  let server: CountingServer;

  beforeEach(async () => {
    server = await countingServer();
    vi.stubEnv('OFFSTAGE_API_URL', server.url);
    vi.stubEnv('OFFSTAGE_API_KEY', 'sk_offstage_test');
    vi.stubEnv('OFFSTAGE_PRECONNECT', '');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await server.close();
  });

  it('opens the pool to OFFSTAGE_API_URL when imported with an Offstage key in the environment', async () => {
    await importFresh();
    await until(() => server.connections() === SESSIONS_PER_ORIGIN);
    await settle(100);
    expect(server.connections()).toBe(SESSIONS_PER_ORIGIN);
  });

  it('opens nothing without a key', async () => {
    vi.stubEnv('OFFSTAGE_API_KEY', '');
    await importFresh();
    await settle(200);
    expect(server.connections()).toBe(0);
  });

  it('opens nothing for a key that is not an Offstage key', async () => {
    vi.stubEnv('OFFSTAGE_API_KEY', 'msk_not_offstage');
    await importFresh();
    await settle(200);
    expect(server.connections()).toBe(0);
  });

  it.each(['0', 'false', ' FALSE '])('opens nothing with OFFSTAGE_PRECONNECT=%j', async (value) => {
    vi.stubEnv('OFFSTAGE_PRECONNECT', value);
    await importFresh();
    await settle(200);
    expect(server.connections()).toBe(0);
  });

  it.each(['not a url', 'ftp://127.0.0.1:1', 'http://127.0.0.1:1'])('never fails the import, even with OFFSTAGE_API_URL=%j', async (url) => {
    vi.stubEnv('OFFSTAGE_API_URL', url);
    const loaded = await importFresh();
    expect(typeof loaded.offstage).toBe('function');
    await settle(100);
  });

  it('lets a script that only imported the provider exit at once, with the pool still connecting', async () => {
    const result = await runWithProvider('', { OFFSTAGE_API_KEY: 'sk_offstage_test', OFFSTAGE_API_URL: server.url });
    expect(result, result.stderr).toMatchObject({ killed: false, code: 0 });
    // Well inside the 10 s connect bound: nothing waited for it.
    expect(result.ms).toBeLessThan(8_000);
    expect(server.connections()).toBe(SESSIONS_PER_ORIGIN);
  }, 30_000);
});
