/**
 * Unit tests against a fake fetch: the failure paths a live endpoint cannot be
 * made to produce on demand.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sandboxCli } from '../index';

const SANDBOX = {
  id: 'sbx-1',
  state: 'running',
  image: 'base',
  cpus: 1,
  memory_mb: 512,
  created_at: '2026-10-12T00:00:00Z',
};

type Route = (init: RequestInit) => Response | Promise<Response>;

const b64 = (bytes: number[] | string) =>
  Buffer.from(typeof bytes === 'string' ? Buffer.from(bytes) : Uint8Array.from(bytes)).toString('base64');

/** An NDJSON body; with `hang`, it stays open until the request is aborted, like a real fetch. */
function ndjson(lines: object[], signal?: AbortSignal | null, hang = false): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(new TextEncoder().encode(JSON.stringify(l) + '\n'));
      if (!hang) return c.close();
      signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
    },
  });
  return new Response(body, { status: 200 });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Installs a fake fetch over `routes` (keyed "METHOD /path") and records every call. */
function fakeApi(routes: Record<string, Route>) {
  const calls: Array<{ key: string; body?: string }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
    calls.push({ key, body: typeof init.body === 'string' ? init.body : undefined });
    const route = routes[key];
    if (!route) return json(404, { error: { code: 'not_found', message: key } });
    return route(init);
  });
  return calls;
}

const baseRoutes: Record<string, Route> = {
  'POST /v1/sandboxes': () => json(201, SANDBOX),
  'POST /v1/sandboxes/sbx-1/processes': () => json(201, { pid: 7 }),
};

const kills = (calls: Array<{ key: string; body?: string }>) =>
  calls.filter((c) => c.key === 'POST /v1/sandboxes/sbx-1/processes/7/signal' && c.body?.includes('KILL'));

const create = (endpoint = 'http://127.0.0.1:7444') => sandboxCli({ endpoint, token: 't' }).sandbox.create();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamCommand', () => {
  it('returns at its deadline even when the kill request fails', async () => {
    const calls = fakeApi({
      ...baseRoutes,
      'GET /v1/sandboxes/sbx-1/processes/7/output': (init) =>
        ndjson([{ stream: 'stdout', data: b64('starting\n') }], init.signal, true),
      'POST /v1/sandboxes/sbx-1/processes/7/signal': () => json(500, { error: { code: 'internal', message: 'boom' } }),
    });
    const sandbox = await create();

    const started = Date.now();
    const result = await sandbox.runCommand('sleep 3600', { timeout: 100, onStdout: () => {} });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('starting\n');
    expect(kills(calls)).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 15000);

  it('kills the process when the output request fails', async () => {
    const calls = fakeApi({
      ...baseRoutes,
      'GET /v1/sandboxes/sbx-1/processes/7/output': () => json(500, { error: { code: 'internal', message: 'boom' } }),
      'POST /v1/sandboxes/sbx-1/processes/7/signal': () => json(200, {}),
    });
    const sandbox = await create();

    await expect(sandbox.runCommand('sleep 3600', { onStdout: () => {} })).rejects.toThrow(/boom/);
    expect(kills(calls)).toHaveLength(1);
  });

  it('kills the process when an output callback throws', async () => {
    const calls = fakeApi({
      ...baseRoutes,
      'GET /v1/sandboxes/sbx-1/processes/7/output': (init) =>
        ndjson([{ stream: 'stdout', data: b64('hi\n') }], init.signal, true),
      'POST /v1/sandboxes/sbx-1/processes/7/signal': () => json(200, {}),
    });
    const sandbox = await create();

    await expect(
      sandbox.runCommand('sleep 3600', {
        onStdout: () => {
          throw new Error('callback failed');
        },
      })
    ).rejects.toThrow('callback failed');
    expect(kills(calls)).toHaveLength(1);
  });

  it('does not kill a process that has already exited', async () => {
    const calls = fakeApi({
      ...baseRoutes,
      'GET /v1/sandboxes/sbx-1/processes/7/output': (init) =>
        ndjson([{ stream: 'stdout', data: b64('done\n') }, { exit_code: 3 }], init.signal),
      'POST /v1/sandboxes/sbx-1/processes/7/signal': () => json(200, {}),
    });
    const sandbox = await create();

    const result = await sandbox.runCommand('exit 3', { onStdout: () => {} });
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe('done\n');
    expect(kills(calls)).toHaveLength(0);
  });

  it('keeps a character whose bytes are split across output events', async () => {
    // "€" is E2 82 AC; the guest reads its pipe in byte chunks, so an event
    // boundary can fall inside a character.
    fakeApi({
      ...baseRoutes,
      'GET /v1/sandboxes/sbx-1/processes/7/output': (init) =>
        ndjson(
          [
            { stream: 'stdout', data: b64([0xe2]) },
            { stream: 'stdout', data: b64([0x82, 0xac, 0x0a]) },
            { stream: 'stderr', data: b64([0xe2, 0x82]) },
            { stream: 'stderr', data: b64([0xac]) },
            { exit_code: 0 },
          ],
          init.signal
        ),
    });
    const sandbox = await create();

    const out: string[] = [];
    const err: string[] = [];
    const result = await sandbox.runCommand('printf', {
      onStdout: (t) => out.push(t),
      onStderr: (t) => err.push(t),
    });

    expect(result.stdout).toBe('€\n');
    expect(result.stderr).toBe('€');
    expect(out.join('')).toBe('€\n');
    expect(err.join('')).toBe('€');
  });
});

describe('getInfo', () => {
  it('does not report a pending sandbox as running', async () => {
    fakeApi({
      ...baseRoutes,
      'GET /v1/sandboxes/sbx-1': () => json(200, { ...SANDBOX, state: 'pending' }),
    });
    const sandbox = await create();

    const info = await sandbox.getInfo();
    expect(info.status).not.toBe('running');
    expect(info.metadata?.state).toBe('pending');
  });
});

describe('endpoint', () => {
  it.each(['http://sandbox.example.com', 'http://10.0.0.5:7444', 'http://127.example.com'])(
    'refuses plain http to a non-loopback host: %s',
    async (endpoint) => {
      const calls = fakeApi(baseRoutes);
      await expect(create(endpoint)).rejects.toThrow(/https/);
      expect(calls).toHaveLength(0);
    }
  );

  it.each(['http://127.0.0.1:7444', 'http://localhost:7444', 'http://[::1]:7444', 'https://sandbox.example.com'])(
    'accepts %s',
    async (endpoint) => {
      fakeApi(baseRoutes);
      await expect(create(endpoint)).resolves.toBeDefined();
    }
  );
});
