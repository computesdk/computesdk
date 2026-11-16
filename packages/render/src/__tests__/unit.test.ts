import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ method: string; args: unknown[] }> = [];
const files = new Map<string, string>();

const sandboxData = {
  id: 'sbx-test',
  status: 'running',
  plan: '1c-2g',
  region: 'oregon',
  timeoutSeconds: 300,
  idleTimeoutSeconds: 900,
  createdAt: '2026-01-01T00:00:00Z',
  sandboxGroupId: 'sbg-default',
  networkPolicy: { type: 'allow-all' },
};

vi.mock('@renderinc/sdk', () => {
  class ClientError extends Error {
    constructor(message: string, public statusCode: number) {
      super(message);
    }
  }
  const sandboxes = {
    create: async (input: unknown) => {
      calls.push({ method: 'create', args: [input] });
      return sandboxData;
    },
    get: async (id: string) => {
      if (id === 'sbx-missing') throw new ClientError('not found', 404);
      return { ...sandboxData, id };
    },
    terminate: async (id: string) => {
      calls.push({ method: 'terminate', args: [id] });
      if (id === 'sbx-missing') throw new ClientError('not found', 404);
    },
    list: async () => [],
    listGroups: async () => [
      { sandboxGroup: { id: 'sbg-other', isDefault: false } },
      { sandboxGroup: { id: 'sbg-default', isDefault: true } },
    ],
    exec: async (id: string, command: string) => {
      calls.push({ method: 'exec', args: [id, command] });
      return (async function* () {
        yield { type: 'output', stream: 'stdout', data: 'hello\n' };
        yield { type: 'output', stream: 'stderr', data: 'warn\n' };
        yield { type: 'exit', exit_code: command === 'echo hello' ? 3 : 0 };
      })();
    },
    upload: async (_id: string, path: string, data: string) => {
      files.set(path, data);
    },
    download: async (_id: string, path: string) => ({ data: Buffer.from(files.get(path) ?? ''), size: 0 }),
    snapshots: {
      create: async (input: unknown) => {
        calls.push({ method: 'snapshots.create', args: [input] });
        return {
          id: 'snp-1', sandboxGroupId: 'sbg-default', sourceSandboxId: 'sbx-test', kind: 'runtime',
          status: 'available', plan: '1c-2g', requestedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-02-01T00:00:00Z',
        };
      },
      list: async () => [],
      delete: async (input: unknown) => {
        calls.push({ method: 'snapshots.delete', args: [input] });
      },
    },
  };
  class Render {
    sandboxes = sandboxes;
    constructor(public options: unknown) {
      calls.push({ method: 'Render', args: [options] });
    }
  }
  return { Render, ClientError };
});

import { buildCommand, createInput, render } from '../index';

const config = { apiKey: 'rnd_test', workspaceId: 'tea-test' };

describe('render provider', () => {
  beforeEach(() => {
    calls.length = 0;
    files.clear();
  });

  it('requires an API key and workspace ID', async () => {
    const env = { key: process.env.RENDER_API_KEY, ws: process.env.RENDER_WORKSPACE_ID };
    delete process.env.RENDER_API_KEY;
    delete process.env.RENDER_WORKSPACE_ID;
    try {
      await expect(render({}).sandbox.create()).rejects.toThrow(/RENDER_API_KEY/);
      await expect(render({ apiKey: 'rnd_test' }).sandbox.create()).rejects.toThrow(/RENDER_WORKSPACE_ID/);
    } finally {
      if (env.key !== undefined) process.env.RENDER_API_KEY = env.key;
      if (env.ws !== undefined) process.env.RENDER_WORKSPACE_ID = env.ws;
    }
  });

  it('maps create options onto the Render create input', () => {
    expect(createInput({ plan: '2c-4g' }, { timeout: 1000, envs: { A: '1' }, templateId: 'my-image', name: 'n' })).toEqual({
      wait: true, plan: '2c-4g', timeoutSeconds: 60, env: { A: '1' }, image: 'my-image', name: 'n',
    });
    expect(createInput({}, { snapshotId: 'snp-1', templateId: 'ignored' })).toEqual({ wait: true, snapshotId: 'snp-1' });
  });

  it('collects streamed output and the exit code', async () => {
    const sandbox = await render(config).sandbox.create();
    const chunks: string[] = [];
    const result = await sandbox.runCommand('echo hello', { onStdout: (d) => chunks.push(d) });
    expect(result).toMatchObject({ stdout: 'hello\n', stderr: 'warn\n', exitCode: 3 });
    expect(chunks).toEqual(['hello\n']);
    expect(calls.find((c) => c.method === 'exec')?.args).toEqual(['sbx-test', 'echo hello']);
  });

  it('wraps cwd, env, timeout and background into the bash script', () => {
    expect(buildCommand('ls', { cwd: '/tmp/a b', env: { FOO: 'x"y' } })).toBe('export FOO="x\\"y"; cd "/tmp/a b" || exit 1; ls');
    expect(buildCommand('sleep 9', { timeout: 1500 })).toBe('timeout -k 5 2 bash -c "sleep 9"');
    expect(buildCommand('srv', { background: true })).toBe('nohup bash -c "srv" >/dev/null 2>&1 &');
    expect(() => buildCommand('ls', { env: { 'BAD-NAME': '1' } })).toThrow(/Invalid environment variable/);
  });

  it('treats a missing sandbox as gone', async () => {
    const provider = render(config);
    expect(await provider.sandbox.getById('sbx-missing')).toBeNull();
    await expect(provider.sandbox.destroy('sbx-missing')).resolves.toBeUndefined();
  });

  it('reads and writes files through upload and download', async () => {
    const sandbox = await render(config).sandbox.create();
    await sandbox.filesystem.writeFile('/tmp/dir/hello.txt', 'hi');
    expect(files.get('/tmp/dir/hello.txt')).toBe('hi');
    expect(calls.some((c) => c.method === 'exec' && String(c.args[1]).includes('mkdir -p'))).toBe(true);
    expect(await sandbox.filesystem.readFile('/tmp/dir/hello.txt')).toBe('hi');
  });

  it('creates snapshots and deletes them from the default group', async () => {
    const provider = render(config);
    const snapshot = await provider.snapshot!.create('sbx-test', { name: 'before' });
    expect(snapshot).toMatchObject({ id: 'snp-1', provider: 'render', metadata: { sandboxId: 'sbx-test' } });
    expect(calls.find((c) => c.method === 'snapshots.create')?.args[0]).toMatchObject({ sandboxId: 'sbx-test', name: 'before', wait: true });
    await provider.snapshot!.delete('snp-1');
    expect(calls.find((c) => c.method === 'snapshots.delete')?.args[0]).toMatchObject({ sandboxGroupId: 'sbg-default', snapshotId: 'snp-1' });
  });

  it('does not support public URLs', async () => {
    const sandbox = await render(config).sandbox.create();
    await expect(sandbox.getUrl({ port: 3000 })).rejects.toThrow(/public URLs/);
  });
});
