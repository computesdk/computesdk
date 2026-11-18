import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveAuth } = vi.hoisted(() => ({ resolveAuth: vi.fn() }));
vi.mock('@benchsdk/cli', () => ({ resolveAuth }));

const detail = {
  id: 'sb_default', status: 'running', provider: 'modal', region: null,
  label: null, size: 'small', createdAt: '2026-11-17T00:00:00Z',
  cost: {}, attach: null,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  vi.resetModules();
  resolveAuth.mockReset();
  resolveAuth.mockRejectedValue(new Error('No credentials found'));
  for (const key of ['COMPUTE_API_KEY', 'BENCHMARKS_PLATFORM_API_KEY', 'COMPUTE_PLATFORM_URL', 'BENCHMARKS_PLATFORM_URL', 'COMPUTE_ORG']) {
    vi.stubEnv(key, '');
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('built-in router', () => {
  it('creates and controls instances with only the singleton and an API key', async () => {
    vi.stubEnv('COMPUTE_API_KEY', 'csdk_test');
    const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (init?.method === 'DELETE') return json({ ok: true });
      if (url.pathname.endsWith('/commands')) return json({ stdout: 'hello\n', stderr: '', exitCode: 0, durationMs: 1 });
      if (url.pathname.endsWith('/files')) return json({ path: '/hello.txt', type: 'file', content: 'hello' });
      if (url.pathname.endsWith('/urls')) return json({ url: 'https://preview.example.test' });
      if ((!init?.method || init.method === 'GET') && url.pathname.endsWith('/sandboxes')) return json({ sandboxes: [detail], nextCursor: null });
      return json({ sandbox: detail });
    });
    vi.stubGlobal('fetch', fetcher);
    const { compute } = await import('../compute');
    expect(fetcher).not.toHaveBeenCalled();
    const sandbox = await compute.instances.create({ size: 'small' });
    expect(sandbox.instanceId).toBe('sb_default');
    expect(compute.sandbox).toBe(compute.instances);
    expect(String(fetcher.mock.calls[0][0])).toBe('https://platform.computesdk.com/api/v1/sandboxes');
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer csdk_test');
    expect(JSON.parse(fetcher.mock.calls[0][1]?.body as string)).toMatchObject({ size: 'small' });
    expect((await sandbox.runCommand('echo hello')).stdout).toBe('hello\n');
    expect(await sandbox.filesystem.readFile('/hello.txt')).toBe('hello');
    expect(await sandbox.getUrl({ port: 3000 })).toBe('https://preview.example.test');
    expect((await compute.instances.getById('sb_default'))?.instanceId).toBe('sb_default');
    expect(await compute.instances.list()).toHaveLength(1);
    await sandbox.destroy();
    await compute.instances.destroy('sb_default');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(2);
    expect(resolveAuth).not.toHaveBeenCalled();
  });

  it('uses and refreshes a saved CLI login without an additional application dependency', async () => {
    resolveAuth.mockResolvedValue({ token: 'saved-token' });
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => json({ sandbox: detail }));
    vi.stubGlobal('fetch', fetcher);
    const { compute } = await import('../compute');
    await compute.instances.create();
    expect(resolveAuth).toHaveBeenCalledWith({ baseUrl: 'https://platform.computesdk.com' });
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer saved-token');
  });

  it('reports missing credentials before networking and can recover after a key is set', async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => json({ sandbox: detail }));
    vi.stubGlobal('fetch', fetcher);
    const { compute } = await import('../compute');
    await expect(compute.instances.create()).rejects.toMatchObject({ code: 'no_credentials' });
    expect(fetcher).not.toHaveBeenCalled();
    vi.stubEnv('COMPUTE_API_KEY', 'late-key');
    await expect(compute.instances.create()).resolves.toMatchObject({ instanceId: 'sb_default' });
  });

  it('keeps router error identity and does not fall back to another create', async () => {
    vi.stubEnv('COMPUTE_API_KEY', 'csdk_test');
    const fetcher = vi.fn(async () => json({ error: 'No credit', code: 'insufficient_credits' }, 402));
    vi.stubGlobal('fetch', fetcher);
    const { compute } = await import('../compute');
    const { PlatformApiError } = await import('../router/client');
    await expect(compute.instances.create()).rejects.toBeInstanceOf(PlatformApiError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps explicit provider configuration entirely separate from the router', async () => {
    vi.stubEnv('COMPUTE_API_KEY', 'csdk_test');
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const { compute } = await import('../compute');
    const instance = { instanceId: 'direct_1' };
    const provider = { name: 'direct', instances: {
      create: vi.fn().mockResolvedValue(instance), getById: vi.fn(), destroy: vi.fn(),
    } };
    compute.setConfig({ provider });
    expect(await compute.instances.create()).toBe(instance);
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => compute.setConfig({})).toThrow('No provider instance configured');
    expect(() => compute({ providers: [] })).toThrow('No provider instance configured');
  });
});
