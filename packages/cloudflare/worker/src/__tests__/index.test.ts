import { beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readDirectory: vi.fn(),
  stat: vi.fn(),
  lstat: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@cloudflare/sandbox', () => {
  class SandboxFileError extends Error {
    constructor(readonly code: string, message: string) {
      super(message);
    }
    static is(error: unknown): error is SandboxFileError {
      return error instanceof SandboxFileError;
    }
  }
  return {
    Files: vi.fn(() => files),
    SandboxFileError,
    SandboxProtocolError: { is: () => false },
  };
});

import { SandboxFileError } from '@cloudflare/sandbox';
import worker, { Sandbox, type BridgeEnv, type SnapshotRecord } from '../index';

const ID = '0123456789abcdef'.repeat(4);
const NEW_ID = 'fedcba9876543210'.repeat(4);
const encoder = new TextEncoder();

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function fakeProcess(stdout: string[], stderr: string[], exitCode = 0) {
  return {
    stdout: stream(stdout),
    stderr: stream(stderr),
    exitCode: Promise.resolve(exitCode),
    kill: vi.fn(),
    output: async () => ({
      stdout: encoder.encode(stdout.join('')).buffer,
      stderr: encoder.encode(stderr.join('')).buffer,
      exitCode,
    }),
  };
}

function fakeContainer(running = true) {
  const container = {
    running,
    images: { default: 'registry/default@sha256:1', builder: 'registry/builder@sha256:2' },
    start: vi.fn(() => {
      container.running = true;
    }),
    monitor: vi.fn(() => new Promise(() => {})),
    setInactivityTimeout: vi.fn(async () => {}),
    destroy: vi.fn(async () => {
      container.running = false;
    }),
    snapshotContainer: vi.fn(async (options: { name?: string }) => ({
      id: 'snap-1',
      size: 1024,
      name: options.name,
    })),
    exec: vi.fn(async (_argv: string[], _options?: object) => fakeProcess(['hello ', 'world'], ['warn'], 3) as any),
    getTcpPort: vi.fn((_port: number) => ({
      fetch: vi.fn(
        async (request: Request) =>
          new Response(`proxied ${request.method} ${new URL(request.url).pathname} ${await request.text()}`.trim())
      ),
    })),
  };
  return container;
}

function snapshotIndex() {
  const records = new Map<string, SnapshotRecord>();
  return {
    records,
    add: vi.fn(async (record: SnapshotRecord) => void records.set(record.id, record)),
    get: vi.fn(async (id: string) => records.get(id) ?? null),
    list: vi.fn(async () => [...records.values()]),
    remove: vi.fn(async (id: string) => records.delete(id)),
  };
}

let container: ReturnType<typeof fakeContainer>;
let index: ReturnType<typeof snapshotIndex>;
let env: BridgeEnv;
let sandboxes: Map<string, Sandbox>;

function sandboxFor(id: string): Sandbox {
  let sandbox = sandboxes.get(id);
  if (!sandbox) {
    sandbox = new Sandbox({ container, blockConcurrencyWhile: (fn: () => unknown) => fn() } as any, env);
    sandboxes.set(id, sandbox);
  }
  return sandbox;
}

beforeEach(() => {
  vi.clearAllMocks();
  container = fakeContainer();
  index = snapshotIndex();
  sandboxes = new Map();
  env = {
    SANDBOX_API_KEY: 'test-secret',
    SANDBOX_INACTIVITY_TIMEOUT_MS: '60000',
    SANDBOX: {
      newUniqueId: () => ({ toString: () => NEW_ID }),
      idFromString: (id: string) => {
        if (!/^[0-9a-f]{64}$/.test(id)) throw new TypeError('Invalid ID');
        return { toString: () => id };
      },
      get: (id: { toString(): string }) => sandboxFor(id.toString()),
    },
    SNAPSHOTS: { getByName: () => index },
  } as unknown as BridgeEnv;
});

function request(path: string, init: RequestInit = {}, auth = true): Request {
  const headers = new Headers(init.headers);
  if (auth) headers.set('Authorization', 'Bearer test-secret');
  return new Request(`https://bridge.example.com${path}`, { ...init, headers });
}

function json(body: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

function parseEvents(text: string) {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event:'))
    .map((block) => {
      const [eventLine, dataLine] = block.split('\n');
      return { event: eventLine.slice('event: '.length), data: dataLine.slice('data: '.length) };
    });
}

describe('authentication', () => {
  it('rejects requests without the bearer token', async () => {
    expect((await worker.fetch(request('/v1/sandbox', { method: 'POST' }, false), env)).status).toBe(401);
    expect((await worker.fetch(request('/v1/info', {}, false), env)).status).toBe(401);
  });

  it('rejects every request when no key is configured', async () => {
    env.SANDBOX_API_KEY = undefined;
    expect((await worker.fetch(request('/v1/info'), env)).status).toBe(401);
  });

  it('serves previews without the bearer token', async () => {
    const response = await worker.fetch(request(`/v1/sandbox/${ID}/ports/3000/app?x=1`, {}, false), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('proxied GET /app');
    const posted = await worker.fetch(
      request(`/v1/sandbox/${ID}/ports/3000`, { method: 'POST', body: 'payload' }, false),
      env
    );
    expect(await posted.text()).toBe('proxied POST / payload');
    expect(container.getTcpPort).toHaveBeenCalledWith(3000);
  });
});

describe('demo-compatible routes', () => {
  it('creates a sandbox with the default image', async () => {
    container.running = false;
    const response = await worker.fetch(request('/v1/sandbox', json({})), env);
    expect(await response.json()).toEqual({ id: NEW_ID });
    expect(container.start).toHaveBeenCalledWith({
      instance: 'standard-1',
      entrypoint: ['sh', '-c', 'sleep infinity'],
      enableInternet: true,
      image: 'registry/default@sha256:1',
    });
    expect(container.setInactivityTimeout).toHaveBeenCalledWith(60000);
  });

  it('accepts an empty create body, a named image and custom resources', async () => {
    container.running = false;
    expect((await worker.fetch(request('/v1/sandbox', { method: 'POST' }), env)).status).toBe(200);
    container.running = false;
    await worker.fetch(
      request('/v1/sandbox', json({ image: 'builder', vcpu: 1, memoryMib: 2048, diskMb: 8000 })),
      env
    );
    expect(container.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        image: 'registry/builder@sha256:2',
        instance: { vcpu: 1, memoryMib: 2048, diskMb: 8000 },
      })
    );
  });

  it('rejects invalid create bodies', async () => {
    for (const body of [{ vcpu: 1 }, { image: 3 }, { image: 'default', snapshotId: 'snap-1' }]) {
      expect((await worker.fetch(request('/v1/sandbox', json(body)), env)).status).toBe(400);
    }
    expect((await worker.fetch(request('/v1/sandbox', { method: 'POST', body: '[' }), env)).status).toBe(400);
    container.running = false;
    expect((await worker.fetch(request('/v1/sandbox', json({ image: 'missing' })), env)).status).toBe(400);
  });

  it('streams exec output in the demo event format', async () => {
    const response = await worker.fetch(
      request(`/v1/sandbox/${ID}/exec`, json({ argv: ['sh', '-c', 'echo'], cwd: '/tmp', timeout_ms: 1000 })),
      env
    );
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    const events = parseEvents(await response.text());
    const decode = (event: string) =>
      events
        .filter((item) => item.event === event)
        .map((item) => Buffer.from(item.data, 'base64').toString())
        .join('');
    expect(decode('stdout')).toBe('hello world');
    expect(decode('stderr')).toBe('warn');
    expect(events.at(-1)).toEqual({ event: 'exit', data: JSON.stringify({ exit_code: 3 }) });
    expect(container.exec).toHaveBeenCalledWith(['sh', '-c', 'echo'], { cwd: '/tmp', stdout: 'pipe', stderr: 'pipe' });
  });

  it('kills a command that exceeds its timeout and reports an error event', async () => {
    const kill = vi.fn();
    container.exec.mockResolvedValueOnce({
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
      exitCode: new Promise(() => {}),
      kill,
    });
    const response = await worker.fetch(
      request(`/v1/sandbox/${ID}/exec`, json({ argv: ['sleep', '10'], timeout_ms: 20 })),
      env
    );
    const events = parseEvents(await response.text());
    expect(events).toEqual([{ event: 'error', data: JSON.stringify({ error: 'Command timed out after 20 ms' }) }]);
    expect(kill).toHaveBeenCalled();
  });

  it('validates exec bodies and sandbox IDs', async () => {
    for (const body of [{}, { argv: [] }, { argv: [1] }, { argv: ['true'], timeout_ms: 0 }, { argv: ['true'], cwd: 1 }]) {
      expect((await worker.fetch(request(`/v1/sandbox/${ID}/exec`, json(body)), env)).status).toBe(400);
    }
    expect((await worker.fetch(request('/v1/sandbox/not-an-id/exec', json({ argv: ['true'] })), env)).status).toBe(404);
  });

  it('reports exec on a stopped container as a server error', async () => {
    container.exec.mockRejectedValueOnce(new Error('container is not running'));
    const response = await worker.fetch(request(`/v1/sandbox/${ID}/exec`, json({ argv: ['true'] })), env);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'container is not running' });
  });

  it('destroys a sandbox', async () => {
    const response = await worker.fetch(request(`/v1/sandbox/${ID}`, { method: 'DELETE' }), env);
    expect(response.status).toBe(204);
    expect(container.destroy).toHaveBeenCalled();
    expect((await worker.fetch(request(`/v1/sandbox/${ID}`), env)).status).toBe(405);
  });

  it('keeps the buffered exec RPC for Durable Object bindings', async () => {
    const result = await sandboxFor(ID).exec(['true'], undefined, 1000);
    expect(new TextDecoder().decode(result.stdout)).toBe('hello world');
    expect(result.exitCode).toBe(3);
  });
});

describe('bridge routes', () => {
  it('describes the bridge', async () => {
    const response = await worker.fetch(request('/v1/info'), env);
    expect(await response.json()).toEqual({
      bridge: 'computesdk',
      version: 1,
      features: ['exec-stream', 'files', 'ports', 'snapshots'],
    });
  });

  it('creates, lists, restores and deletes snapshots', async () => {
    const created = await worker.fetch(request(`/v1/sandbox/${ID}/snapshot`, json({ name: 'before' })), env);
    const record = await created.json();
    expect(record).toMatchObject({ id: 'snap-1', size: 1024, name: 'before', sandboxId: ID });
    expect(container.snapshotContainer).toHaveBeenCalledWith({ name: 'before' });
    expect(container.destroy).not.toHaveBeenCalled();

    const listed = await (await worker.fetch(request('/v1/snapshots'), env)).json();
    expect(listed).toEqual({ snapshots: [record] });
    expect((await worker.fetch(request('/v1/snapshots/snap-1'), env)).status).toBe(200);

    container.running = false;
    const restored = await worker.fetch(request('/v1/sandbox', json({ snapshotId: 'snap-1' })), env);
    expect(await restored.json()).toEqual({ id: NEW_ID });
    expect(container.start).toHaveBeenLastCalledWith({
      instance: 'standard-1',
      entrypoint: ['sh', '-c', 'sleep infinity'],
      enableInternet: true,
      containerSnapshot: { id: 'snap-1' },
    });

    expect((await worker.fetch(request('/v1/snapshots/snap-1', { method: 'DELETE' }), env)).status).toBe(204);
    expect((await worker.fetch(request('/v1/snapshots/snap-1', { method: 'DELETE' }), env)).status).toBe(404);
    expect((await worker.fetch(request('/v1/sandbox', json({ snapshotId: 'snap-1' })), env)).status).toBe(404);
  });

  it('snapshots without a name', async () => {
    await worker.fetch(request(`/v1/sandbox/${ID}/snapshot`, { method: 'POST' }), env);
    expect(container.snapshotContainer).toHaveBeenCalledWith({});
  });

  it('reads and writes files', async () => {
    files.readFile.mockResolvedValueOnce(new Response('content'));
    const read = await worker.fetch(request(`/v1/sandbox/${ID}/files?path=/tmp/a.txt`), env);
    expect(await read.text()).toBe('content');
    expect(files.readFile).toHaveBeenCalledWith('/tmp/a.txt');

    const written = await worker.fetch(
      request(`/v1/sandbox/${ID}/files?path=/tmp/b.txt`, { method: 'PUT', body: 'data' }),
      env
    );
    expect(written.status).toBe(204);
    const [path, body] = files.writeFile.mock.calls[0];
    expect(path).toBe('/tmp/b.txt');
    expect(await new Response(body).text()).toBe('data');
  });

  it('maps file errors to statuses', async () => {
    files.readFile.mockRejectedValueOnce(new (SandboxFileError as any)('ENOENT', 'missing'));
    const response = await worker.fetch(request(`/v1/sandbox/${ID}/files?path=/missing`), env);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'missing', code: 'ENOENT' });
    expect((await worker.fetch(request(`/v1/sandbox/${ID}/files?path=relative`), env)).status).toBe(400);
  });

  it('lists, stats, creates and removes paths', async () => {
    const modifiedAt = new Date('2026-01-01T00:00:00Z');
    files.readDirectory.mockResolvedValueOnce([{ name: 'a.txt', type: 'file' }]);
    files.lstat.mockResolvedValueOnce({ type: 'file', size: 4n, modifiedAt });
    const listed = await worker.fetch(request(`/v1/sandbox/${ID}/files/list?path=/tmp`), env);
    expect(await listed.json()).toEqual({
      entries: [{ name: 'a.txt', type: 'file', size: 4, modifiedAt: modifiedAt.toISOString() }],
    });
    expect(files.lstat).toHaveBeenCalledWith('/tmp/a.txt');

    files.stat.mockResolvedValueOnce({ type: 'directory', size: 4096n, modifiedAt });
    expect((await worker.fetch(request(`/v1/sandbox/${ID}/files/stat?path=/tmp`), env)).status).toBe(200);
    files.stat.mockRejectedValueOnce(new (SandboxFileError as any)('ENOENT', 'missing'));
    expect((await worker.fetch(request(`/v1/sandbox/${ID}/files/stat?path=/nope`), env)).status).toBe(404);

    expect((await worker.fetch(request(`/v1/sandbox/${ID}/files/mkdir?path=/tmp/x/y`, { method: 'POST' }), env)).status).toBe(204);
    expect(files.mkdir).toHaveBeenCalledWith('/tmp/x/y', { recursive: true });
    expect((await worker.fetch(request(`/v1/sandbox/${ID}/files?path=/tmp/x`, { method: 'DELETE' }), env)).status).toBe(204);
    expect(files.remove).toHaveBeenCalledWith('/tmp/x', { recursive: true, force: true });
  });

  it('answers previews of stopped sandboxes and unknown routes', async () => {
    container.running = false;
    expect((await worker.fetch(request(`/v1/sandbox/${ID}/ports/3000`, {}, false), env)).status).toBe(503);
    expect((await worker.fetch(request(`/v1/sandbox/${ID}/ports/70000`, {}, false), env)).status).toBe(404);
    expect((await worker.fetch(request('/v1/unknown'), env)).status).toBe(404);
  });
});
