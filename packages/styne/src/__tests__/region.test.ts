import http2 from 'node:http2';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BULK_BODY_BYTES, closeSessions, connectionReady, StyneApiError } from '../client';
import { styne } from '../provider';
import { clearRoutes, learnRoute, MAX_ROUTES, regionalApiUrl, sandboxApiUrl } from '../region';

const GLOBAL = 'https://api.example.test';
const EAST = 'https://east.api.example.test';
const DOWN = 'https://down.api.example.test';
const TLS = 'https://tls.api.example.test';
const SILENT = 'https://silent.api.example.test';

describe('regionalApiUrl', () => {
  it("names the API host of a sandbox's region", () => {
    expect(regionalApiUrl(GLOBAL, 'east.example.test')).toBe(EAST);
    expect(regionalApiUrl(`${GLOBAL}/v1/`, 'East.Example.Test')).toBe(`${EAST}/v1`);
  });

  it('keeps a custom API URL, a local one, and one with no usable sandbox domain', () => {
    for (const [apiUrl, domain] of [
      ['https://eu.example.test', 'east.example.test'],
      ['http://127.0.0.1:8080', 'east.example.test'],
      [GLOBAL, undefined],
      [GLOBAL, 'example.test'],
      [GLOBAL, 'east.other.test'],
      [EAST, 'east.example.test'],
    ] as const) {
      expect(regionalApiUrl(apiUrl, domain)).toBeUndefined();
    }
  });

  it('keeps routes for a bounded number of sandboxes', () => {
    clearRoutes();
    const client = { apiKey: 'k', apiUrl: GLOBAL };
    for (let i = 0; i <= MAX_ROUTES; i++) learnRoute(client, `sbx-${i}`, 'east.example.test');
    expect(sandboxApiUrl(client, 'sbx-0')).toBe(GLOBAL);
    expect(sandboxApiUrl(client, 'sbx-1')).toBe(EAST);
    expect(sandboxApiUrl(client, `sbx-${MAX_ROUTES}`)).toBe(EAST);
    clearRoutes();
  });
});

/**
 * Two stand-ins for the API, the global host and the east region's host, with one set of sandboxes between them.
 * `http2.connect` is pointed at them by origin; `down` is a closed port, `tls` a server that does not speak TLS.
 */
describe('regional routing', () => {
  const servers: Record<string, http2.Http2Server> = {};
  const sessions: Record<string, number> = { global: 0, east: 0 };
  const calls: Array<{ host: string; method: string; path: string }> = [];
  const dialed: string[] = [];
  /** Makes the east host fail: with `code`, as the API does (an `error_code` and a `Retry-After`); else as a proxy. `times` limits it. */
  const failing: { status?: number; method?: string; code?: string; times?: number; reset?: boolean } = {};
  const files = new Map<string, Buffer>();
  let next = 0;
  const open = new Set<http2.ServerHttp2Session>();
  let plain: net.Server;
  let silent: net.Server;
  const held = new Set<net.Socket>();
  let origins: Record<string, string> = {};
  let restore = () => undefined as void;

  const handler = (host: 'global' | 'east') => (stream: http2.ServerHttp2Stream, headers: http2.IncomingHttpHeaders) => {
    stream.on('error', () => undefined);
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      const method = String(headers[':method']);
      const path = String(headers[':path']);
      const body = Buffer.concat(chunks);
      calls.push({ host, method, path });
      const json = (status: number, value: unknown, extra: http2.OutgoingHttpHeaders = {}) => {
        stream.respond({ ':status': status, 'content-type': 'application/json', ...extra });
        stream.end(JSON.stringify(value));
      };
      if (host === 'east' && failing.status && (!failing.method || failing.method === method) && (failing.times === undefined || failing.times-- > 0)) {
        if (failing.reset) return stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
        if (failing.code) return json(failing.status, { error_code: failing.code, message: 'retry in a second' }, { 'retry-after': '0' });
        return json(failing.status, { message: 'regional host failure' });
      }
      if (method === 'POST' && path === '/sandboxes') {
        const { templateID } = JSON.parse(body.toString('utf8')) as { templateID?: string };
        return json(201, { sandboxID: `sbx-${++next}`, domain: `${templateID ?? 'east'}.example.test` });
      }
      if (method === 'GET' && path === '/sandboxes') return json(200, [{ sandboxID: 'sbx-listed', domain: 'east.example.test' }]);
      const match = /^\/sandboxes\/([^/?]+)(\/[^?]*)?(?:\?path=(.*))?$/.exec(path);
      if (!match) return json(404, { message: 'no route' });
      const [, id, rest = '', file] = match;
      if (method === 'GET' && rest === '') return json(200, { sandboxID: id, domain: 'east.example.test', state: 'running' });
      if (method === 'DELETE' && rest === '') return json(200, {});
      if (method === 'POST' && rest === '/exec') {
        stream.respond({ ':status': 200, 'content-type': 'application/x-ndjson' });
        stream.write(JSON.stringify({ stdout: Buffer.from(host).toString('base64') }) + '\n');
        stream.end(JSON.stringify({ exit: { exitCode: 0 } }) + '\n');
        return;
      }
      if (rest === '/files' && method === 'PUT') {
        files.set(`${id} ${file}`, body);
        stream.respond({ ':status': 204 });
        return stream.end();
      }
      if (rest === '/files' && method === 'GET') {
        stream.respond({ ':status': 200 });
        return stream.end(files.get(`${id} ${file}`) ?? Buffer.alloc(0));
      }
      if (rest === '/snapshots') return json(201, { snapshotID: 'snap-1', name: 'saved', sandboxID: id });
      if (rest === '/pause' || rest === '/refreshes') {
        stream.respond({ ':status': 204 });
        return stream.end();
      }
      if (rest === '/resume') return json(201, { sandboxID: id });
      json(404, { message: `unexpected ${method} ${path}` });
    });
  };

  beforeAll(async () => {
    const listen = async (host: 'global' | 'east') => {
      const server = http2.createServer();
      server.on('session', (session) => {
        sessions[host]++;
        open.add(session);
        session.on('close', () => open.delete(session));
        session.on('error', () => undefined);
      });
      server.on('stream', handler(host));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      servers[host] = server;
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };
    const closed = http2.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const downPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    plain = net.createServer((socket) => {
      socket.on('error', () => undefined);
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n', () => socket.destroy());
    });
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
    silent = net.createServer((socket) => {
      held.add(socket);
      socket.resume();
      socket.on('close', () => held.delete(socket));
      socket.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    origins = {
      [GLOBAL]: await listen('global'),
      [EAST]: await listen('east'),
      [DOWN]: `http://127.0.0.1:${downPort}`,
      [TLS]: `https://127.0.0.1:${(plain.address() as AddressInfo).port}`,
      [SILENT]: `https://127.0.0.1:${(silent.address() as AddressInfo).port}`,
    };
    const connect = http2.connect;
    const spy = vi.spyOn(http2, 'connect').mockImplementation(((authority: string | URL, ...rest: unknown[]) => {
      dialed.push(String(authority));
      return (connect as (...args: unknown[]) => http2.ClientHttp2Session)(origins[String(authority)] ?? authority, ...rest);
    }) as typeof http2.connect);
    restore = () => spy.mockRestore();
  });

  afterAll(async () => {
    restore();
    closeSessions();
    for (const session of open) session.destroy();
    for (const server of Object.values(servers)) await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => plain.close(() => resolve()));
    for (const socket of held) socket.destroy();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  });

  beforeEach(() => {
    closeSessions();
    clearRoutes();
    calls.length = 0;
    dialed.length = 0;
    delete failing.status;
    delete failing.method;
    delete failing.code;
    delete failing.times;
    delete failing.reset;
  });

  const provider = () => styne({ apiKey: 'test-key', apiUrl: GLOBAL });
  /** Waits until the east host's connection, opened when its first sandbox was seen, is open. */
  const regionalOpen = () => vi.waitFor(() => expect(connectionReady(EAST, () => undefined)).toBe(true), { interval: 2 });
  const where = (filter: (call: { method: string; path: string }) => boolean) =>
    calls.filter(filter).map((call) => `${call.host} ${call.method} ${call.path}`);

  it('creates on the global host and sends every call about the sandbox to its regional host', async () => {
    const compute = provider();
    const sandbox = await compute.instances.create();
    const id = sandbox.instanceId;
    await regionalOpen();
    expect((await sandbox.runCommand('echo')).stdout).toBe('east');
    await sandbox.filesystem.writeFile('/root/a.txt', 'hello');
    expect(await sandbox.filesystem.readFile('/root/a.txt')).toBe('hello');
    expect((await sandbox.getInfo()).status).toBe('running');
    await sandbox.pause!();
    await sandbox.resume!();
    await sandbox.extendLifetime!(60_000);
    await compute.snapshot!.create(id, { name: 'saved' });
    await sandbox.destroy();
    expect(where((call) => call.path === '/sandboxes')).toEqual(['global POST /sandboxes']);
    expect(calls.filter((call) => call.path !== '/sandboxes').every((call) => call.host === 'east')).toBe(true);
    expect(where((call) => call.path.startsWith(`/sandboxes/${id}`)).map((line) => line.split(' ').slice(0, 2).join(' '))).toEqual([
      'east POST', 'east PUT', 'east GET', 'east GET', 'east POST', 'east POST', 'east POST', 'east POST', 'east DELETE',
    ]);
  });

  it('sends calls through the global host while the regional connection opens, without waiting for it', async () => {
    const sandbox = await provider().instances.create();
    expect((await sandbox.runCommand('echo')).stdout).toBe('global');
    await regionalOpen();
    expect((await sandbox.runCommand('echo')).stdout).toBe('east');
    expect(dialed.filter((origin) => origin === EAST)).toHaveLength(1);
  });

  it('sends a large body to the regional host even before its connection is open', async () => {
    const sandbox = await provider().instances.create();
    await sandbox.filesystem.writeFile('/root/big.bin', 'x'.repeat(BULK_BODY_BYTES));
    expect(where((call) => call.method === 'PUT')).toEqual([`east PUT /sandboxes/${sandbox.instanceId}/files?path=%2Froot%2Fbig.bin`]);
  });

  it('shares one connection per host between all the sandboxes of a burst', async () => {
    const before = { ...sessions };
    const compute = provider();
    const created = await Promise.all(Array.from({ length: 40 }, () => compute.instances.create()));
    const outputs = await Promise.all(created.map((sandbox) => sandbox.runCommand('echo').then((result) => result.stdout)));
    await Promise.all(created.map((sandbox) => sandbox.destroy()));
    expect(outputs.every((host) => host === 'east' || host === 'global')).toBe(true);
    expect(sessions.global - before.global).toBe(1);
    expect(sessions.east - before.east).toBe(1);
  });

  it('routes a sandbox found by id, started by another process, to its region', async () => {
    const compute = provider();
    const found = await compute.instances.getById('sbx-elsewhere');
    expect(found).not.toBeNull();
    await regionalOpen();
    expect((await found!.runCommand('echo')).stdout).toBe('east');
    await compute.instances.destroy('sbx-elsewhere');
    expect(where((call) => call.path.startsWith('/sandboxes/sbx-elsewhere') && !call.path.includes('/files'))).toEqual([
      'global GET /sandboxes/sbx-elsewhere',
      'east POST /sandboxes/sbx-elsewhere/exec',
      'east DELETE /sandboxes/sbx-elsewhere',
    ]);
  });

  it('routes listed sandboxes to their region', async () => {
    const [listed] = await provider().instances.list();
    await regionalOpen();
    expect((await listed.runCommand('echo')).stdout).toBe('east');
  });

  it('falls back to the global host for good when the regional host refuses the connection', async () => {
    const sandbox = await provider().instances.create({ templateId: 'down' });
    expect((await sandbox.runCommand('echo')).stdout).toBe('global');
    expect((await sandbox.runCommand('echo')).stdout).toBe('global');
    await sandbox.destroy();
    expect(dialed.filter((origin) => origin === DOWN)).toHaveLength(1);
    expect(where((call) => call.path.includes('/exec'))).toHaveLength(2);
  });

  it('falls back to the global host when the TLS handshake with the regional host fails', async () => {
    const sandbox = await provider().instances.create({ templateId: 'tls' });
    expect((await sandbox.runCommand('echo')).stdout).toBe('global');
    await sandbox.filesystem.writeFile('/root/b.txt', 'x');
    expect(dialed.filter((origin) => origin === TLS)).toHaveLength(1);
  });

  it('falls back to the global host when the regional host accepts the connection but never opens it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const sandbox = await provider().instances.create({ templateId: 'silent' });
      expect((await sandbox.runCommand('echo')).stdout).toBe('global');
      await vi.waitFor(() => expect(held.size).toBe(1), { interval: 5 });
      vi.advanceTimersByTime(10_000);
      await vi.waitFor(() => expect(held.size).toBe(0), { interval: 5 });
      expect((await sandbox.runCommand('echo')).stdout).toBe('global');
      expect(dialed.filter((origin) => origin === SILENT)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('repeats a safe request on the global host after a server error from the regional host, and stays there', async () => {
    const sandbox = await provider().instances.create();
    await regionalOpen();
    failing.status = 502;
    expect((await sandbox.getInfo()).status).toBe('running');
    expect((await sandbox.runCommand('echo')).stdout).toBe('global');
    expect(where((call) => call.path.startsWith(`/sandboxes/${sandbox.instanceId}`))).toEqual([
      `east GET /sandboxes/${sandbox.instanceId}`,
      `global GET /sandboxes/${sandbox.instanceId}`,
      `global POST /sandboxes/${sandbox.instanceId}/exec`,
    ]);
  });

  it('never runs a command twice after a server error, and sends the next one to the global host', async () => {
    const sandbox = await provider().instances.create();
    await regionalOpen();
    failing.status = 502;
    failing.method = 'POST';
    const error = await sandbox.runCommand('echo').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StyneApiError);
    expect(error).toMatchObject({ status: 502 });
    expect(where((call) => call.path.endsWith('/exec'))).toEqual([`east POST /sandboxes/${sandbox.instanceId}/exec`]);
    expect((await sandbox.runCommand('echo')).stdout).toBe('global');
  });

  it('repeats a command on the global host after a 503 from the regional host', async () => {
    const sandbox = await provider().instances.create();
    await regionalOpen();
    failing.status = 503;
    expect((await sandbox.runCommand('echo')).stdout).toBe('global');
  });

  it("returns the API's own server error from the regional host, and the sandbox keeps its route", async () => {
    const sandbox = await provider().instances.create();
    await regionalOpen();
    failing.status = 500;
    failing.code = 'volume_mount_failed';
    failing.method = 'POST';
    await expect(sandbox.runCommand('echo')).rejects.toMatchObject({ status: 500, code: 'volume_mount_failed' });
    delete failing.status;
    expect((await sandbox.runCommand('echo')).stdout).toBe('east');
    expect(sandboxApiUrl({ apiKey: 'test-key', apiUrl: GLOBAL }, sandbox.instanceId)).toBe(EAST);
    expect(where((call) => call.path.endsWith('/exec'))).toEqual([
      `east POST /sandboxes/${sandbox.instanceId}/exec`,
      `east POST /sandboxes/${sandbox.instanceId}/exec`,
    ]);
  });

  it('repeats a read the regional API shed after its Retry-After on the regional host, and stays there', async () => {
    const sandbox = await provider().instances.create();
    await regionalOpen();
    failing.status = 503;
    failing.code = 'overloaded';
    failing.times = 1;
    expect((await sandbox.getInfo()).status).toBe('running');
    expect(where((call) => call.path === `/sandboxes/${sandbox.instanceId}`)).toEqual([
      `east GET /sandboxes/${sandbox.instanceId}`,
      `east GET /sandboxes/${sandbox.instanceId}`,
    ]);
    expect(sandboxApiUrl({ apiKey: 'test-key', apiUrl: GLOBAL }, sandbox.instanceId)).toBe(EAST);
  });

  it('keeps the route when the regional API stays busy, and reports its answer', async () => {
    const sandbox = await provider().instances.create();
    await regionalOpen();
    failing.status = 503;
    failing.code = 'capacity';
    await expect(sandbox.getInfo()).rejects.toMatchObject({ status: 503, code: 'capacity' });
    expect(where((call) => call.path === `/sandboxes/${sandbox.instanceId}`).every((line) => line.startsWith('east'))).toBe(true);
    expect(sandboxApiUrl({ apiKey: 'test-key', apiUrl: GLOBAL }, sandbox.instanceId)).toBe(EAST);
  });

  it('sends a safe request to the global host once after the regional connection kept failing it, and keeps the route', async () => {
    const sandbox = await provider().instances.create();
    await regionalOpen();
    failing.status = 500;
    failing.method = 'GET';
    failing.reset = true;
    expect((await sandbox.getInfo()).status).toBe('running');
    expect(where((call) => call.path === `/sandboxes/${sandbox.instanceId}`).at(-1)).toBe(`global GET /sandboxes/${sandbox.instanceId}`);
    expect(sandboxApiUrl({ apiKey: 'test-key', apiUrl: GLOBAL }, sandbox.instanceId)).toBe(EAST);
  });

  it('keeps every call on a custom API URL', async () => {
    const sandbox = await styne({ apiKey: 'test-key', apiUrl: EAST }).instances.create();
    expect((await sandbox.runCommand('echo')).stdout).toBe('east');
    expect(dialed).toEqual([EAST]);
  });
});
