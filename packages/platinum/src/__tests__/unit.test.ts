import { beforeEach, describe, expect, it, vi } from 'vitest';

// The SDK is replaced wholesale: these tests make no network calls.
const sdk = vi.hoisted(() => {
  class NotFoundError extends Error {}
  const row = (id: string, state = 'running') => ({
    id, state, name: null, hostId: 'host-1', placedPool: 'general', api_url: undefined,
    createdAt: '2026-11-18T00:00:00.000Z', templateId: 'tpl_1', templateName: 'csdk-node22',
    region: 'eu-west', cpu: 2, ramMb: 4096, diskGb: 10,
  });
  const exec = vi.fn(async (_cmd: string, _opts?: unknown) => ({ stdout: 'v22.11.0\n', stderr: '', exit_code: 0 } as Record<string, unknown>));
  const expose = vi.fn(async (port: number) => ({ url: `https://${port}-abc.sbx.platinum.dev/?t=tok`, port }));
  class Sandbox {
    constructor(readonly client: unknown, readonly id: string, readonly init?: unknown) {}
    exec = exec;
    expose = expose;
    exposedUrl = () => null;
    refresh = async () => row(this.id, this.id === 'sbx_failed' ? 'failed-start' : 'running');
  }
  const clients: Array<{ token: string; apiUrl?: string }> = [];
  const create = vi.fn(async (_spec: Record<string, unknown>, _opts?: unknown) => new Sandbox(null, 'sbx_1'));
  const get = vi.fn(async (id: string) => {
    if (id === 'sbx_missing') throw new NotFoundError('not found');
    return row(id, id === 'sbx_gone' ? 'deleted' : 'running');
  });
  const del = vi.fn(async (id: string) => {
    if (id === 'sbx_missing') throw new NotFoundError('not found');
    if (id === 'sbx_error') throw new Error('server error');
  });
  class Platinum {
    constructor(opts: { token: string; apiUrl?: string }) { clients.push(opts); }
    forOrigin() { return this; }
    sandboxes = {
      create, get, delete: del,
      iterate: async function* () { yield row('sbx_a'); yield row('sbx_b', 'deleted'); yield row('sbx_c', 'stopped'); },
    };
  }
  return { NotFoundError, Platinum, Sandbox, clients, create, get, del, exec, expose };
});

vi.mock('@platinum-dev/sdk', () => ({ NotFoundError: sdk.NotFoundError, Platinum: sdk.Platinum, Sandbox: sdk.Sandbox }));

import { platinum } from '../index';

const provider = () => platinum({ apiKey: 'pt_test' });

beforeEach(() => {
  vi.clearAllMocks();
  sdk.clients.length = 0;
  vi.stubEnv('PLATINUM_API_KEY', '');
  vi.stubEnv('PT_TOKEN', '');
});

describe('Platinum provider (mock-only)', () => {
  it('needs an API key from config or the environment', async () => {
    await expect(platinum({}).instances.create()).rejects.toThrow(/Missing Platinum API key/);
    vi.stubEnv('PT_TOKEN', 'pt_fallback');
    await platinum({}).instances.create();
    vi.stubEnv('PLATINUM_API_KEY', 'pt_env');
    await platinum({}).instances.create();
    await provider().instances.create();
    expect(sdk.clients.map(c => c.token)).toEqual(['pt_fallback', 'pt_env', 'pt_test']);
  });

  it('maps create options onto the sandbox spec and waits for running', async () => {
    const sandbox = await platinum({ apiKey: 'pt_test', timeout: 90_000 }).instances.create({
      templateId: 'csdk-node22', envs: { A: '1' }, name: 'bench-1', metadata: { run: 'x' },
      cpu: 2, ram_mb: 1024, region: 'eu-west', runtime: 'node', namespace: 'ignored',
    });
    expect(sandbox.sandboxId).toBe('sbx_1');
    expect(sdk.create).toHaveBeenCalledWith(
      { template: 'csdk-node22', env: { A: '1' }, name: 'bench-1', metadata: { run: 'x' }, cpu: 2, ram_mb: 1024, region: 'eu-west' },
      { waitForRunning: true, waitTimeoutMs: 90_000, signal: undefined },
    );
  });

  it('boots an image or the configured template, and never both silently', async () => {
    await platinum({ apiKey: 'pt_test', template: 'csdk-node22' }).instances.create();
    expect(sdk.create.mock.calls[0][0]).toEqual({ template: 'csdk-node22' });
    await platinum({ apiKey: 'pt_test', template: 'csdk-node22' }).instances.create({ image: 'node:22-slim' });
    expect(sdk.create.mock.calls[1][0]).toEqual({ image: { base_image: 'node:22-slim' } });
    await provider().instances.create({ image: 'node:22-slim', templateId: 'other' });
    expect(sdk.create.mock.calls[2][0]).toEqual({ image: { base_image: 'node:22-slim' }, template: 'other' });
  });

  it('refuses snapshot ids and unified volume mounts without creating', async () => {
    await expect(provider().instances.create({ snapshotId: 'snap_1' })).rejects.toThrow(/not a snapshot id/);
    await expect(provider().instances.create({ volumes: [{ volume: 'data', mountPath: '/data' }] })).rejects.toThrow(/volumes/);
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it('maps sm-xl to per-create cpu/ram_mb and leaves xs/2xl unknown', async () => {
    const sizes = provider().sizes;
    expect(sizes.list().filter(r => r.status === 'supported').map(r => r.requested.sizeClass)).toEqual(['sm', 'md', 'lg', 'xl']);
    expect(sizes.resolve('xs').status).toBe('unknown');
    expect(sizes.resolve('2xl').status).toBe('unknown');

    const sandbox = await provider().instances.create({ sizeClass: 'xl', templateId: 'csdk-node22' });
    expect(sdk.create.mock.calls[0][0]).toEqual({ template: 'csdk-node22', cpu: 8, ram_mb: 16384 });
    expect(sandbox.sizing).toMatchObject({ requested: { sizeClass: 'xl' }, resolved: { vcpus: 8, memoryMiB: 16384 } });
  });

  it.each([{ sizeClass: 'md', ram_mb: 2048 }, { sizeClass: 'md', cpu: 2 }, { sizeClass: '2xl' }])(
    'rejects %j without creating', async (options) => {
      await expect(provider().instances.create(options as never)).rejects.toMatchObject({ name: 'InstanceSizeError', fallback: false });
      expect(sdk.create).not.toHaveBeenCalled();
    },
  );

  it('runs commands through exec and returns stdout, stderr and the exit code', async () => {
    const sandbox = await provider().instances.create();
    const result = await sandbox.runCommand('node -v');
    expect(result).toMatchObject({ stdout: 'v22.11.0\n', stderr: '', exitCode: 0 });
    expect(typeof result.durationMs).toBe('number');
    expect(sdk.exec).toHaveBeenCalledWith('node -v', { timeoutMs: undefined });

    sdk.exec.mockResolvedValueOnce({ stdout: '', stderr: '', exit_code: 124, error: 'timed out' });
    expect(await sandbox.runCommand('sleep 100', { timeout: 1000 })).toMatchObject({ stderr: 'timed out', exitCode: 124 });
    expect(sdk.exec).toHaveBeenLastCalledWith('sleep 100', { timeoutMs: 1000 });
  });

  it('applies cwd, env and background in the shell command', async () => {
    const sandbox = await provider().instances.create();
    await sandbox.runCommand('echo $A && pwd', { cwd: '/srv/my app', env: { A: 'x"y' } });
    expect(sdk.exec.mock.calls[0][0]).toBe('cd "/srv/my app" && export A="x\\"y" && echo $A && pwd');
    await sandbox.runCommand('sleep 5', { background: true });
    expect(sdk.exec.mock.calls[1][0]).toBe('setsid nohup sh -c "sleep 5" >/dev/null 2>&1 </dev/null &');
    await expect(sandbox.runCommand('true', { env: { 'BAD-KEY': '1' } })).rejects.toThrow(/Invalid environment variable name/);
  });

  it('gets by id, treating missing and deleted sandboxes as absent', async () => {
    expect((await provider().instances.getById('sbx_42'))?.sandboxId).toBe('sbx_42');
    expect(await provider().instances.getById('sbx_missing')).toBeNull();
    expect(await provider().instances.getById('sbx_gone')).toBeNull();
  });

  it('lists live sandboxes only', async () => {
    const listed = await provider().instances.list();
    expect(listed.map(s => s.sandboxId)).toEqual(['sbx_a', 'sbx_c']);
  });

  it('destroys by id, ignoring an already deleted sandbox but not other errors', async () => {
    await provider().instances.destroy('sbx_1');
    await provider().instances.destroy('sbx_missing');
    expect(sdk.del).toHaveBeenCalledWith('sbx_1');
    await expect(provider().instances.destroy('sbx_error')).rejects.toThrow(/server error/);
  });

  it('reports info and preview URLs', async () => {
    const running = await provider().instances.getById('sbx_42');
    expect(await running!.getInfo()).toMatchObject({ id: 'sbx_42', provider: 'platinum', status: 'running', timeout: 0, metadata: { cpu: 2, ramMb: 4096 } });
    const failed = await provider().instances.getById('sbx_failed');
    expect((await failed!.getInfo()).status).toBe('error');
    expect(await running!.getUrl({ port: 3000 })).toBe('https://3000-abc.sbx.platinum.dev/?t=tok');
    expect(await running!.getUrl({ port: 3000, protocol: 'wss' })).toBe('wss://3000-abc.sbx.platinum.dev/?t=tok');
  });
});
