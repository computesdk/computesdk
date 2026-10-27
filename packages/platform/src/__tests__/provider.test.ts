import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { platform } from '../index.js';
import { PlatformApiError, PlatformClientError } from '../client.js';
import type { SandboxDetail } from '../types.js';

const ENV = [
  'COMPUTE_API_KEY',
  'COMPUTE_PLATFORM_URL',
  'BENCHMARKS_PLATFORM_API_KEY',
  'BENCHMARKS_PLATFORM_URL',
  'COMPUTE_ORG',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
  signal?: AbortSignal | null;
}

type Handler = (call: Call) => Response | Promise<Response>;

function mockFetch(handler: Handler) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: unknown, init?: { method?: string; headers?: unknown; body?: unknown; signal?: AbortSignal | null }) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h && typeof h === 'object') {
      for (const [k, v] of Object.entries(h as Record<string, unknown>)) headers[k.toLowerCase()] = String(v);
    }
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      signal: init?.signal,
    };
    calls.push(call);
    return handler(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function detail(over: Partial<SandboxDetail> = {}): SandboxDetail {
  return {
    id: 'sb_1',
    label: null,
    provider: 'e2b',
    providerSandboxId: 'psb_1',
    status: 'running',
    placementAttempts: [],
    commandCount: 0,
    secrets: [],
    requestedImage: null,
    image: null,
    createdAt: '2026-10-27T00:00:00.000Z',
    lastCommandAt: null,
    destroyedAt: null,
    destroyError: null,
    timeoutMs: null,
    placement: null,
    cost: { rate: null, runtimeSeconds: 0, costUsd: null, settled: false },
    attach: null,
    ...over,
  };
}

function config(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return { apiKey: 'test-key', fetch: fetchImpl, ...extra };
}

describe('create', () => {
  it('mints an sdk-create: idempotency key and returns the running sandbox', async () => {
    const { fetchImpl, calls } = mockFetch(() => json({ sandbox: detail() }, 201));
    const provider = platform(config(fetchImpl));
    const sbx = await provider.sandbox.create({ timeout: 60_000 });
    expect(sbx.sandboxId).toBe('sb_1');
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://platform.computesdk.com/api/v1/sandboxes');
    expect(call.body?.idempotencyKey).toMatch(/^sdk-create:/);
    expect(call.body?.timeoutMs).toBe(60_000);
    expect(call.headers.authorization).toBe('Bearer test-key');
    expect(call.headers['user-agent']).toMatch(/^@computesdk\/platform\//);
    expect(call.headers.accept).toBe('application/json');
  });

  it('passes a caller-provided idempotencyKey through unchanged', async () => {
    const { fetchImpl, calls } = mockFetch(() => json({ sandbox: detail() }, 200));
    const provider = platform(config(fetchImpl));
    await provider.sandbox.create({ idempotencyKey: 'my-key-123' } as never);
    expect(calls[0].body?.idempotencyKey).toBe('my-key-123');
  });

  it('maps platform create options onto the create body', async () => {
    const { fetchImpl, calls } = mockFetch(() => json({ sandbox: detail() }, 201));
    const provider = platform(config(fetchImpl));
    await provider.sandbox.create({
      size: 'large',
      maxPrice: { usd: 0.5, per: 'hour' },
      orderType: 'limit',
      providerOrder: ['e2b', 'daytona'],
      secrets: ['GH_TOKEN'],
      disk: { diskId: 'my-org/disk-1', path: '/data', readonly: true },
      label: 'my box',
      envs: { FOO: 'bar' },
    } as never);
    const body = calls[0].body ?? {};
    expect(body.size).toBe('large');
    expect(body.maxPrice).toEqual({ usd: 0.5, per: 'hour' });
    expect(body.orderType).toBe('limit');
    expect(body.providerOrder).toEqual(['e2b', 'daytona']);
    expect(body.secrets).toEqual(['GH_TOKEN']);
    expect(body.disk).toEqual({ diskId: 'my-org/disk-1', path: '/data', readonly: true });
    expect(body.label).toBe('my box');
    // envs are runtime-side only — never in the create body.
    expect(body.envs).toBeUndefined();
    expect(body.env).toBeUndefined();
  });

  it('maps resource aliases into body.resources', async () => {
    const { fetchImpl, calls } = mockFetch(() => json({ sandbox: detail() }, 201));
    const provider = platform(config(fetchImpl));
    await provider.sandbox.create({ cpus: 4, memoryMiB: 8192, diskMb: 20000 } as never);
    expect(calls[0].body?.resources).toEqual({ cpus: 4, memoryMb: 8192, ephemeralDiskMb: 20000 });
    expect(calls[0].body?.size).toBeUndefined();
  });

  it('applies config defaults and lets call options win', async () => {
    const { fetchImpl, calls } = mockFetch(() => json({ sandbox: detail() }, 201));
    const provider = platform(
      config(fetchImpl, {
        defaults: { size: 'small', orderType: 'market', providerOrder: ['e2b'] },
      }),
    );
    await provider.sandbox.create({ size: 'medium' } as never);
    expect(calls[0].body?.size).toBe('medium');
    expect(calls[0].body?.providerOrder).toEqual(['e2b']);
    await provider.sandbox.create({ cpus: 2 } as never);
    // Call-level resources suppress the default size.
    expect(calls[1].body?.size).toBeUndefined();
    expect(calls[1].body?.resources).toEqual({ cpus: 2 });
  });

  it('rejects size+resources, unknown size, and unknown resource options', async () => {
    const { fetchImpl, calls } = mockFetch(() => json({ sandbox: detail() }, 201));
    const provider = platform(config(fetchImpl));
    const expectInvalid = (opts: Record<string, unknown>) =>
      expect(provider.sandbox.create(opts as never)).rejects.toMatchObject({
        code: 'invalid_argument',
      });
    await expectInvalid({ size: 'small', cpus: 2 });
    await expectInvalid({ size: 'huge' });
    await expectInvalid({ gpuCount: 1 });
    expect(calls).toHaveLength(0);
  });

  it('polls while the replayed row is still creating', async () => {
    let getCalls = 0;
    const { fetchImpl, calls } = mockFetch((call) => {
      if (call.method === 'POST') return json({ sandbox: detail({ status: 'creating' }) }, 200);
      getCalls += 1;
      return json({ sandbox: detail({ status: getCalls < 2 ? 'creating' : 'running' }) });
    });
    const provider = platform(config(fetchImpl));
    const sbx = await provider.sandbox.create({});
    expect(sbx.sandboxId).toBe('sb_1');
    expect(getCalls).toBe(2);
    expect(calls.filter((c) => c.method === 'GET').every((c) => c.url.endsWith('/api/v1/sandboxes/sb_1'))).toBe(true);
  });

  it('replays the create when the row disappears mid-poll', async () => {
    let posts = 0;
    const { fetchImpl, calls } = mockFetch((call) => {
      if (call.method === 'POST') {
        posts += 1;
        return json({ sandbox: detail({ status: posts === 1 ? 'creating' : 'running' }) }, posts === 1 ? 200 : 201);
      }
      // The reservation row was cleaned up — the key is free again.
      return json({ error: 'Sandbox not found', code: 'not_found' }, 404);
    });
    const provider = platform(config(fetchImpl));
    const sbx = await provider.sandbox.create({});
    expect(sbx.sandboxId).toBe('sb_1');
    expect(posts).toBe(2);
    // Both attempts carried the same idempotency key.
    const keys = calls.filter((c) => c.method === 'POST').map((c) => c.body?.idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('replays on a network error under the same idempotency key', async () => {
    let attempts = 0;
    const { fetchImpl, calls } = mockFetch(() => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('fetch failed');
      return json({ sandbox: detail() }, 201);
    });
    const provider = platform(config(fetchImpl));
    const sbx = await provider.sandbox.create({});
    expect(sbx.sandboxId).toBe('sb_1');
    expect(attempts).toBe(2);
    expect(calls[0].body?.idempotencyKey).toBe(calls[1].body?.idempotencyKey);
  });

  it('does not replay a normal API error', async () => {
    const { fetchImpl, calls } = mockFetch(() =>
      json({ error: 'No capacity', code: 'no_market_capacity' }, 503),
    );
    const provider = platform(config(fetchImpl));
    await expect(provider.sandbox.create({})).rejects.toMatchObject({
      code: 'no_market_capacity',
    });
    expect(calls).toHaveLength(1);
  });

  it('gives up after the deadline with create_outcome_unknown and fallback: false', async () => {
    vi.useFakeTimers();
    try {
      const { fetchImpl } = mockFetch((call) =>
        call.method === 'POST'
          ? json({ sandbox: detail({ status: 'creating' }) }, 200)
          : json({ sandbox: detail({ status: 'creating' }) }),
      );
      const provider = platform(config(fetchImpl));
      const promise = provider.sandbox.create({ idempotencyKey: 'k-stuck' } as never);
      promise.catch(() => undefined); // avoid unhandled rejection during the advance
      await vi.advanceTimersByTimeAsync(370_000);
      const err = await promise.then(
        () => {
          throw new Error('expected create to fail');
        },
        (e: unknown) => e as PlatformClientError,
      );
      expect(err).toBeInstanceOf(PlatformClientError);
      expect(err.code).toBe('create_outcome_unknown');
      expect(err.fallback).toBe(false);
      expect(err.message).toContain('k-stuck');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('getById / list / destroy', () => {
  it('returns the sandbox and maps 404 to null', async () => {
    let notFound = false;
    const { fetchImpl } = mockFetch(() =>
      notFound ? json({ error: 'nope' }, 404) : json({ sandbox: detail() }),
    );
    const provider = platform(config(fetchImpl));
    const found = await provider.sandbox.getById('sb_1');
    expect(found?.sandboxId).toBe('sb_1');
    notFound = true;
    expect(await provider.sandbox.getById('sb_x')).toBeNull();
  });

  it('lists running sandboxes across pages via nextCursor', async () => {
    const { fetchImpl, calls } = mockFetch((call) => {
      const url = new URL(call.url);
      if (url.searchParams.get('cursor') === 'c2') {
        return json({ sandboxes: [detail({ id: 'sb_2' })], nextCursor: null });
      }
      return json({ sandboxes: [detail({ id: 'sb_1' })], nextCursor: 'c2' });
    });
    const provider = platform(config(fetchImpl));
    const list = await provider.sandbox.list();
    expect(list.map((s) => s.sandboxId)).toEqual(['sb_1', 'sb_2']);
    expect(new URL(calls[0].url).searchParams.get('status')).toBe('running');
    expect(new URL(calls[0].url).searchParams.get('limit')).toBe('100');
    expect(new URL(calls[1].url).searchParams.get('cursor')).toBe('c2');
  });

  it('sends X-Org-Slug from config org or COMPUTE_ORG', async () => {
    const { fetchImpl, calls } = mockFetch(() => json({ sandbox: detail() }));
    await platform(config(fetchImpl, { org: 'cfg-org' })).sandbox.getById('sb_1');
    expect(calls[0].headers['x-org-slug']).toBe('cfg-org');
    process.env.COMPUTE_ORG = 'env-org';
    await platform(config(fetchImpl)).sandbox.getById('sb_1');
    expect(calls[2].headers['x-org-slug']).toBe('env-org');
  });

  it('deletes the sandbox and treats 404 as already gone', async () => {
    let status = 200;
    const { fetchImpl, calls } = mockFetch(() => json({ sandbox: detail() }, status));
    const provider = platform(config(fetchImpl));
    await provider.sandbox.destroy('sb_1');
    expect(calls[0].method).toBe('DELETE');
    status = 404;
    await expect(provider.sandbox.destroy('sb_1')).resolves.toBeUndefined();
  });
});

describe('runCommand', () => {
  async function makeSandbox(handler: Handler, createOptions: Record<string, unknown> = {}) {
    const mock = mockFetch((call) => {
      if (call.method === 'POST' && call.url.endsWith('/api/v1/sandboxes')) {
        return json({ sandbox: detail() }, 201);
      }
      return handler(call);
    });
    const sbx = await platform(config(mock.fetchImpl)).sandbox.create(createOptions as never);
    return { sbx, calls: mock.calls };
  }

  it('posts the command and maps the wire result', async () => {
    const { sbx, calls } = await makeSandbox(() =>
      json({ commandId: 'cmd_1', exitCode: 0, durationMs: 12, stdout: 'hi\n', stderr: '' }),
    );
    const result = await sbx.runCommand('echo hi');
    expect(result).toEqual({ stdout: 'hi\n', stderr: '', exitCode: 0, durationMs: 12 });
    const call = calls[calls.length - 1];
    expect(call.method).toBe('POST');
    expect(call.url).toBe('https://platform.computesdk.com/api/v1/sandboxes/sb_1/commands');
    expect(call.body).toEqual({ command: 'echo hi' });
  });

  it('sends cwd and merges create envs under command env', async () => {
    const { sbx, calls } = await makeSandbox(
      () => json({ commandId: 'c', exitCode: 0, durationMs: 1, stdout: '', stderr: '' }),
      { envs: { A: '1', B: 'keep' } },
    );
    await sbx.runCommand('pwd', { cwd: '/app', env: { A: '2' } });
    const body = calls[calls.length - 1].body ?? {};
    expect(body.cwd).toBe('/app');
    expect(body.env).toEqual({ A: '2', B: 'keep' });
  });

  it('passes timeoutMs through under the 290s cap and rejects above it', async () => {
    const { sbx, calls } = await makeSandbox(() =>
      json({ commandId: 'c', exitCode: 0, durationMs: 1, stdout: '', stderr: '' }),
    );
    await sbx.runCommand('sleep 1', { timeout: 10_000 });
    expect(calls[calls.length - 1].body?.timeoutMs).toBe(10_000);
    await expect(sbx.runCommand('sleep 999', { timeout: 291_000 })).rejects.toMatchObject({
      code: 'invalid_argument',
    });
  });

  it('rejects commands over 64 KB', async () => {
    const { sbx } = await makeSandbox(() => json({}));
    const huge = 'x'.repeat(64 * 1024 + 1);
    await expect(sbx.runCommand(huge)).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('posts background commands to /processes and returns a zero result', async () => {
    const { sbx, calls } = await makeSandbox(() => json({ process: { id: 'p1' } }, 201));
    const result = await sbx.runCommand('long-running', { background: true });
    expect(result).toEqual({ stdout: '', stderr: '', exitCode: 0, durationMs: 0 });
    const call = calls[calls.length - 1];
    expect(call.url).toBe('https://platform.computesdk.com/api/v1/sandboxes/sb_1/processes');
    expect(call.body?.command).toBe('long-running');
  });
});

describe('streamCommand', () => {
  function sseBody(events: Array<{ event: string; data: unknown }>): Response {
    const text = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
    return new Response(text, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  async function makeStreamingSandbox(handler: Handler) {
    const mock = mockFetch((call) => {
      if (call.method === 'POST' && call.url.endsWith('/api/v1/sandboxes')) {
        return json({ sandbox: detail() }, 201);
      }
      return handler(call);
    });
    return { sbx: await platform(config(mock.fetchImpl)).sandbox.create({}), calls: mock.calls };
  }

  it('accumulates stdout/stderr, fires callbacks, and resolves on exit', async () => {
    const { sbx, calls } = await makeStreamingSandbox(() =>
      sseBody([
        { event: 'stdout', data: { chunk: 'hello ' } },
        { event: 'stderr', data: { chunk: 'warn' } },
        { event: 'stdout', data: { chunk: 'world' } },
        { event: 'exit', data: { commandId: 'c1', exitCode: 3, durationMs: 42 } },
      ]),
    );
    const out: string[] = [];
    const err: string[] = [];
    const result = await sbx.runCommand('x', { onStdout: (c) => out.push(c), onStderr: (c) => err.push(c) });
    expect(result).toEqual({ stdout: 'hello world', stderr: 'warn', exitCode: 3, durationMs: 42 });
    expect(out).toEqual(['hello ', 'world']);
    expect(err).toEqual(['warn']);
    expect(calls[calls.length - 1].headers.accept).toBe('text/event-stream');
  });

  it('maps a null exit code to 128', async () => {
    const { sbx } = await makeStreamingSandbox(() =>
      sseBody([{ event: 'exit', data: { commandId: 'c', exitCode: null, durationMs: 5 } }]),
    );
    const result = await sbx.runCommand('x', { onStdout: () => undefined });
    expect(result.exitCode).toBe(128);
  });

  it('rejects on an error event and on a stream that ends without exit', async () => {
    const { sbx } = await makeStreamingSandbox(() =>
      sseBody([{ event: 'error', data: { status: 500, error: 'boom' } }]),
    );
    await expect(sbx.runCommand('x', { onStdout: () => undefined })).rejects.toBeInstanceOf(PlatformApiError);

    const second = await makeStreamingSandbox(() =>
      sseBody([{ event: 'stdout', data: { chunk: 'partial' } }]),
    );
    await expect(
      second.sbx.runCommand('x', { onStdout: () => undefined }),
    ).rejects.toMatchObject({ code: 'stream_ended' });
  });
});

describe('getInfo / getUrl', () => {
  async function sandboxWithDetail(handler: Handler) {
    const mock = mockFetch((call) => {
      if (call.method === 'POST' && call.url.endsWith('/api/v1/sandboxes')) {
        return json({ sandbox: detail() }, 201);
      }
      return handler(call);
    });
    return { sbx: await platform(config(mock.fetchImpl)).sandbox.create({}), calls: mock.calls };
  }

  it('refreshes and maps status, timeout and metadata', async () => {
    const { sbx } = await sandboxWithDetail(() =>
      json({
        sandbox: detail({
          status: 'running',
          timeoutMs: 90_000,
          label: 'box',
          placement: { source: 'market', rate: { usd: 0.1, per: 'hour' } },
        }),
      }),
    );
    const info = await sbx.getInfo();
    expect(info.provider).toBe('platform');
    expect(info.status).toBe('running');
    expect(info.timeout).toBe(90_000);
    expect(info.metadata?.platformStatus).toBe('running');
    expect(info.metadata?.label).toBe('box');
    expect(info.createdAt).toBeInstanceOf(Date);
  });

  it('reports destroyed as stopped, or error when destroyError is set', async () => {
    const { sbx } = await sandboxWithDetail(() =>
      json({ sandbox: detail({ status: 'destroyed', destroyError: 'boom' }) }),
    );
    expect((await sbx.getInfo()).status).toBe('error');
    const { sbx: sbx2 } = await sandboxWithDetail(() =>
      json({ sandbox: detail({ status: 'destroyed' }) }),
    );
    expect((await sbx2.getInfo()).status).toBe('stopped');
  });

  it('returns the preview URL and explains 501', async () => {
    const { sbx, calls } = await sandboxWithDetail(() =>
      json({ url: 'https://3000-sb_1.preview.example.com' }),
    );
    expect(await sbx.getUrl({ port: 3000 })).toBe('https://3000-sb_1.preview.example.com');
    const url = new URL(calls[calls.length - 1].url);
    expect(url.pathname).toBe('/api/v1/sandboxes/sb_1/urls');
    expect(url.searchParams.get('port')).toBe('3000');

    const { sbx: noUrl } = await sandboxWithDetail(() =>
      json({ error: 'no urls', code: 'not_supported' }, 501),
    );
    await expect(noUrl.getUrl({ port: 3000 })).rejects.toThrow('no public URLs');
  });
});

describe('filesystem', () => {
  async function sandbox(handler: Handler) {
    const mock = mockFetch((call) => {
      if (call.method === 'POST' && call.url.endsWith('/api/v1/sandboxes')) {
        return json({ sandbox: detail() }, 201);
      }
      return handler(call);
    });
    return { sbx: await platform(config(mock.fetchImpl)).sandbox.create({}), calls: mock.calls };
  }

  it('reads a file, refuses a directory, and maps 404 to ENOENT', async () => {
    const { sbx } = await sandbox(() =>
      json({ path: '/a.txt', type: 'file', content: 'contents' }),
    );
    expect(await sbx.filesystem.readFile('/a.txt')).toBe('contents');

    const { sbx: dir } = await sandbox(() =>
      json({ path: '/d', type: 'directory', entries: [] }),
    );
    await expect(dir.filesystem.readFile('/d')).rejects.toThrow('directory');

    const { sbx: missing } = await sandbox(() => json({ error: 'nope' }, 404));
    const err = await missing.filesystem.readFile('/nope').then(
      () => {
        throw new Error('expected readFile to fail');
      },
      (e: unknown) => e as NodeJS.ErrnoException,
    );
    expect(err.code).toBe('ENOENT');
  });

  it('writes a file and enforces the 4 MB client limit', async () => {
    const { sbx, calls } = await sandbox(() => json({ path: '/a', type: 'file', content: 'x' }));
    await sbx.filesystem.writeFile('/a.txt', 'data');
    expect(calls[calls.length - 1].method).toBe('POST');
    expect(calls[calls.length - 1].body).toEqual({ path: '/a.txt', content: 'data' });
    const big = 'x'.repeat(4 * 1024 * 1024 + 1);
    await expect(sbx.filesystem.writeFile('/big', big)).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('mkdirs, lists a directory, checks existence, and removes', async () => {
    const { sbx, calls } = await sandbox(() =>
      json({
        path: '/d',
        type: 'directory',
        entries: [{ name: 'f.txt', type: 'file', size: 4, modified: '2026-10-27T01:00:00Z' }],
      }),
    );
    await sbx.filesystem.mkdir('/d');
    expect(calls[calls.length - 1].body).toEqual({ path: '/d', mkdir: true });
    const entries = await sbx.filesystem.readdir('/d');
    expect(entries[0].name).toBe('f.txt');
    expect(entries[0].modified).toBeInstanceOf(Date);
    expect(await sbx.filesystem.exists('/d')).toBe(true);
    await sbx.filesystem.remove('/d');
    const last = calls[calls.length - 1];
    expect(last.method).toBe('DELETE');
    expect(last.url).toContain('path=%2Fd');
  });

  it('returns false for exists on a missing path', async () => {
    const { sbx } = await sandbox(() => json({ error: 'nope' }, 404));
    expect(await sbx.filesystem.exists('/gone')).toBe(false);
  });
});

describe('retry policy', () => {
  it('retries sandbox_booting 503s by code, not other 503s', async () => {
    let attempts = 0;
    const { fetchImpl, calls } = mockFetch(() => {
      attempts += 1;
      return attempts === 1
        ? json({ error: 'still booting', code: 'sandbox_booting' }, 503)
        : json({ sandbox: detail() });
    });
    const found = await platform(config(fetchImpl)).sandbox.getById('sb_1');
    expect(found?.sandboxId).toBe('sb_1');
    // 2 sandbox GETs; the third call is the generated instance's egress
    // pointer read after getById (a filesystem GET it swallows).
    expect(calls.filter((c) => c.url.endsWith('/api/v1/sandboxes/sb_1'))).toHaveLength(2);

    const { fetchImpl: noRetry, calls: noRetryCalls } = mockFetch(() =>
      json({ error: 'busy', code: 'no_market_capacity' }, 503),
    );
    await expect(platform(config(noRetry)).sandbox.getById('sb_1')).rejects.toMatchObject({
      code: 'no_market_capacity',
    });
    expect(noRetryCalls).toHaveLength(1);
  });

  it('honors Retry-After on 429 GETs', async () => {
    let attempts = 0;
    const { fetchImpl, calls } = mockFetch(() => {
      attempts += 1;
      return attempts === 1
        ? json({ error: 'slow down' }, 429, { 'retry-after': '0' })
        : json({ sandbox: detail() });
    });
    const found = await platform(config(fetchImpl)).sandbox.getById('sb_1');
    expect(found?.sandboxId).toBe('sb_1');
    expect(calls.filter((c) => c.url.endsWith('/api/v1/sandboxes/sb_1'))).toHaveLength(2);
  });

  it('retries network errors on GET but not on POST /commands', async () => {
    let getAttempts = 0;
    const { fetchImpl: getFetch, calls: getCalls } = mockFetch(() => {
      getAttempts += 1;
      if (getAttempts < 3) throw new TypeError('fetch failed');
      return json({ sandbox: detail() });
    });
    const found = await platform(config(getFetch)).sandbox.getById('sb_1');
    expect(found?.sandboxId).toBe('sb_1');
    expect(getCalls.filter((c) => c.url.endsWith('/api/v1/sandboxes/sb_1'))).toHaveLength(3);

    const mock = mockFetch((call) => {
      if (call.url.endsWith('/api/v1/sandboxes')) return json({ sandbox: detail() }, 201);
      throw new TypeError('fetch failed');
    });
    const sbx = await platform(config(mock.fetchImpl)).sandbox.create({});
    await expect(sbx.runCommand('x')).rejects.toThrow('fetch failed');
    expect(mock.calls.filter((c) => c.url.endsWith('/commands'))).toHaveLength(1);
  });
});

describe('signal propagation', () => {
  it('forwards AbortSignal to fetch', async () => {
    const { fetchImpl, calls } = mockFetch(() => json({ sandbox: detail() }));
    const provider = platform(config(fetchImpl));
    const controller = new AbortController();
    await provider.sandbox.create({ signal: controller.signal } as never);
    expect(calls[0].signal).toBeInstanceOf(AbortSignal);
  });
});
