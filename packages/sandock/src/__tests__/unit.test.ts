import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clientOptions: Array<Record<string, unknown>> = [];
const sdk = {
  sandbox: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    delete: vi.fn(),
    shell: vi.fn(),
    getSignedPreviewUrl: vi.fn(),
  },
  fs: {
    read: vi.fn(),
    write: vi.fn(),
  },
};

vi.mock('sandock', () => ({
  createSandockClient: (options: Record<string, unknown>) => {
    clientOptions.push(options);
    return sdk;
  },
}));

import { sandock } from '../index';

/** A Sandock shell result. */
function shellResult(opts: { stdout?: string; stderr?: string; exitCode?: number; timedOut?: boolean }, _cmd?: string) {
  return {
    success: true,
    data: {
      stdout: opts.stdout ?? '',
      stderr: opts.stderr ?? '',
      exitCode: opts.timedOut ? 137 : (opts.exitCode ?? 0),
      timedOut: opts.timedOut ?? false,
      durationMs: 5,
    },
  };
}

async function createSandbox(config: Parameters<typeof sandock>[0] = { apiKey: 'key' }) {
  sdk.sandbox.create.mockResolvedValueOnce({ success: true, data: { id: 'sdb_1' } });
  return sandock(config).instances.create();
}

describe('sandock provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientOptions.length = 0;
    sdk.sandbox.list.mockResolvedValue({ success: true, data: { items: [{ id: 'sdb_1', status: 'RUNNING' }] } });
    sdk.sandbox.getById.mockImplementation(async (id: string) => (id === 'sdb_1' ? { id, status: 'RUNNING' } : null));
    sdk.sandbox.delete.mockResolvedValue({ success: true, data: { id: 'sdb_1', deleted: true } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('config', () => {
    it('explains how to provide a missing API key', async () => {
      vi.stubEnv('SANDOCK_API_KEY', '');
      await expect(sandock({}).instances.create()).rejects.toThrow(/Missing Sandock API key[\s\S]*SANDOCK_API_KEY/);
      expect(sdk.sandbox.create).not.toHaveBeenCalled();
    });

    it('reads the key, base URL and space from the environment', async () => {
      vi.stubEnv('SANDOCK_API_KEY', 'env-key');
      vi.stubEnv('SANDOCK_BASE_URL', 'https://sandock.example/');
      vi.stubEnv('SANDOCK_SPACE_ID', 'space_1');
      await createSandbox({});
      expect(clientOptions[0]).toEqual({
        baseUrl: 'https://sandock.example',
        headers: { Authorization: 'Bearer env-key' },
      });
      expect(sdk.sandbox.create).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'space_1' }));
    });

    it('prefers explicit config over the environment', async () => {
      vi.stubEnv('SANDOCK_API_KEY', 'env-key');
      await createSandbox({ apiKey: 'cfg-key', baseUrl: 'https://custom.example' });
      expect(clientOptions[0]).toEqual({
        baseUrl: 'https://custom.example',
        headers: { Authorization: 'Bearer cfg-key' },
      });
    });
  });

  describe('create', () => {
    it('uses the default image and returns a running instance', async () => {
      const sandbox = await createSandbox();
      expect(sdk.sandbox.create).toHaveBeenCalledWith({ image: 'sandockai/sandock-code:latest' });
      expect(sandbox.instanceId).toBe('sdb_1');
      expect(sandbox.provider).toBe('sandock');
    });

    it('maps ComputeSDK create options onto Sandock', async () => {
      sdk.sandbox.create.mockResolvedValueOnce({ success: true, data: { id: 'sdb_2' } });
      await sandock({ apiKey: 'key', autoDeleteInterval: 0 }).instances.create({
        templateId: 'python:3.12-slim',
        name: 'my box',
        envs: { FOO: 'bar' },
        timeout: 90_500,
        cpu: 2,
        memory: 1024,
      });
      expect(sdk.sandbox.create).toHaveBeenCalledWith({
        image: 'python:3.12-slim',
        title: 'my box',
        env: { FOO: 'bar' },
        cpu: 2,
        memory: 1024,
        activeDeadlineSeconds: 91,
        autoDeleteInterval: 0,
      });
    });

    it('prefers image over templateId and caps the lifetime at 24 hours', async () => {
      sdk.sandbox.create.mockResolvedValueOnce({ success: true, data: { id: 'sdb_3' } });
      await sandock({ apiKey: 'key', image: 'cfg:image' }).instances.create({
        image: 'node:22',
        templateId: 'ignored',
        timeout: 10 * 86_400_000,
      });
      expect(sdk.sandbox.create).toHaveBeenCalledWith({ image: 'node:22', activeDeadlineSeconds: 86_400 });
    });

    it('rejects snapshots, which Sandock does not have', async () => {
      await expect(sandock({ apiKey: 'key' }).instances.create({ snapshotId: 'snap' })).rejects.toThrow(/snapshots/);
      expect(sdk.sandbox.create).not.toHaveBeenCalled();
    });

    it('deletes the sandbox when the caller aborted during create', async () => {
      const controller = new AbortController();
      sdk.sandbox.create.mockImplementationOnce(async () => {
        controller.abort();
        return { success: true, data: { id: 'sdb_4' } };
      });
      await expect(sandock({ apiKey: 'key' }).instances.create({ signal: controller.signal })).rejects.toThrow();
      expect(sdk.sandbox.delete).toHaveBeenCalledWith('sdb_4');
    });
  });

  describe('getById / list / destroy', () => {
    it('returns null for a sandbox Sandock does not know', async () => {
      expect(await sandock({ apiKey: 'key' }).instances.getById('missing')).toBeNull();
    });

    it('looks a sandbox up directly by id, without listing', async () => {
      const found = await sandock({ apiKey: 'key', spaceId: 'space_9' }).instances.getById('sdb_1');
      expect(found?.instanceId).toBe('sdb_1');
      expect(sdk.sandbox.getById).toHaveBeenCalledWith('sdb_1');
      expect(sdk.sandbox.list).not.toHaveBeenCalled();
    });

    it('lists every sandbox', async () => {
      sdk.sandbox.list.mockResolvedValueOnce({
        success: true,
        data: { items: [{ id: 'a', status: 'RUNNING' }, { id: 'b', status: 'STOPPED', createdAt: '2026-01-01T00:00:00.000Z' }] },
      });
      const all = await sandock({ apiKey: 'key' }).instances.list();
      expect(all.map((s) => s.instanceId)).toEqual(['a', 'b']);
      const info = await all[1].getInfo();
      expect(info.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('treats destroying an already-deleted sandbox as done', async () => {
      sdk.sandbox.delete.mockRejectedValueOnce(new Error('Failed to delete sandbox: {"code":500}'));
      await expect(sandock({ apiKey: 'key' }).instances.destroy('gone')).resolves.toBeUndefined();
    });

    it('reports a failed destroy of a sandbox that still exists', async () => {
      sdk.sandbox.delete.mockRejectedValueOnce(new Error('Failed to delete sandbox: boom'));
      await expect(sandock({ apiKey: 'key' }).instances.destroy('sdb_1')).rejects.toThrow(/boom/);
    });

    it('retries a dropped connection on reads', async () => {
      sdk.sandbox.getById.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: new Error('other side closed') }));
      expect(await sandock({ apiKey: 'key' }).instances.getById('sdb_1')).not.toBeNull();
      expect(sdk.sandbox.getById).toHaveBeenCalledTimes(2);
    });
  });

  describe('runCommand', () => {
    it('reports the exit code the command exited with', async () => {
      const sandbox = await createSandbox();
      sdk.sandbox.shell.mockImplementationOnce(async (_id: string, opts: { cmd: string }) =>
        shellResult({ stdout: 'out\n', stderr: 'err\n', exitCode: 3 }, opts.cmd)
      );
      const result = await sandbox.runCommand('echo out; echo err >&2; exit 3');
      expect(result).toMatchObject({ stdout: 'out\n', stderr: 'err\n', exitCode: 3 });
      expect(sdk.sandbox.shell.mock.calls[0][1].cmd).toBe('echo out; echo err >&2; exit 3');
    });

    it('passes cwd, env and timeout, with a 5 minute default timeout', async () => {
      const sandbox = await createSandbox();
      sdk.sandbox.shell.mockImplementation(async (_id: string, opts: { cmd: string }) => shellResult({}, opts.cmd));
      await sandbox.runCommand('pwd', { cwd: '/work', env: { A: '1' }, timeout: 1234 });
      expect(sdk.sandbox.shell.mock.calls[0][1]).toMatchObject({ workdir: '/work', env: { A: '1' }, timeoutMs: 1234 });
      await sandbox.runCommand('pwd');
      expect(sdk.sandbox.shell.mock.calls[1][1].timeoutMs).toBe(300_000);
      expect(sdk.sandbox.shell.mock.calls[1][1]).not.toHaveProperty('workdir');
      expect(sdk.sandbox.shell.mock.calls[1][1].cmd).toBe('pwd');
    });

    it('reports a command that outran its timeout with exit code 124', async () => {
      const sandbox = await createSandbox();
      sdk.sandbox.shell.mockImplementationOnce(async (_id: string, opts: { cmd: string }) =>
        shellResult({ stdout: 'starting\n', timedOut: true }, opts.cmd)
      );
      const result = await sandbox.runCommand('echo starting; sleep 60', { timeout: 1000 });
      expect(result.exitCode).toBe(124);
    });

    it('starts a background command detached, quoting it', async () => {
      const sandbox = await createSandbox();
      sdk.sandbox.shell.mockResolvedValueOnce(shellResult({}, ''));
      const result = await sandbox.runCommand('echo "$HOME" && sleep 5', { background: true });
      expect(sdk.sandbox.shell.mock.calls[0][1].cmd).toBe('nohup sh -c "echo \\"\\$HOME\\" && sleep 5" > /dev/null 2>&1 &');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('streaming', () => {
    it('streams stdout and stderr through Sandock callbacks', async () => {
      const sandbox = await createSandbox();
      sdk.sandbox.shell.mockImplementationOnce(
        async (_id: string, opts: { cmd: string }, callbacks: { onStdout: (c: string) => void; onStderr: (c: string) => void }) => {
          const result = shellResult({ stdout: 'out\n', stderr: 'err\n', exitCode: 3 }, opts.cmd);
          callbacks.onStdout('out\n');
          // Split the stderr into small chunks.
          for (let i = 0; i < result.data.stderr.length; i += 4) callbacks.onStderr(result.data.stderr.slice(i, i + 4));
          return result;
        }
      );
      const out: string[] = [];
      const err: string[] = [];
      const result = await sandbox.runCommand('cmd', { onStdout: (c) => out.push(c), onStderr: (c) => err.push(c) });
      expect(result).toMatchObject({ stdout: 'out\n', stderr: 'err\n', exitCode: 3 });
      expect(out.join('')).toBe('out\n');
      expect(err.join('')).toBe('err\n');
    });
  });

  describe('getInfo / getUrl', () => {
    it('maps Sandock status, and a deleted sandbox as stopped', async () => {
      const sandbox = await createSandbox({ apiKey: 'key', timeout: 600_000 });
      sdk.sandbox.create.mockClear();
      expect(await sandbox.getInfo()).toMatchObject({ id: 'sdb_1', provider: 'sandock', status: 'running', timeout: 600_000 });
      sdk.sandbox.getById.mockResolvedValueOnce({ id: 'sdb_1', status: 'STOPPED' });
      expect((await sandbox.getInfo()).status).toBe('stopped');
      sdk.sandbox.getById.mockResolvedValueOnce(null);
      expect(await sandbox.getInfo()).toMatchObject({ status: 'stopped', metadata: { sandockStatus: 'DELETED' } });
    });

    it('returns a signed preview URL, as ws(s) when asked', async () => {
      const sandbox = await createSandbox();
      sdk.sandbox.getSignedPreviewUrl.mockResolvedValue({ success: true, data: { url: 'https://3000-tok.sandock.example' } });
      expect(await sandbox.getUrl({ port: 3000 })).toBe('https://3000-tok.sandock.example');
      expect(await sandbox.getUrl({ port: 3000, protocol: 'wss' })).toBe('wss://3000-tok.sandock.example');
      expect(sdk.sandbox.getSignedPreviewUrl).toHaveBeenCalledWith('sdb_1', { port: 3000 });
    });
  });

  describe('filesystem', () => {
    it('reads and writes through the Sandock fs API', async () => {
      const sandbox = await createSandbox();
      sdk.fs.write.mockResolvedValueOnce({ success: true, data: true });
      sdk.fs.read.mockResolvedValueOnce({ success: true, data: { path: '/tmp/a', content: 'hello' } });
      await sandbox.filesystem.writeFile('/tmp/a', 'hello');
      expect(sdk.fs.write).toHaveBeenCalledWith('sdb_1', '/tmp/a', 'hello');
      expect(await sandbox.filesystem.readFile('/tmp/a')).toBe('hello');
    });

    it('passes on the error Sandock gives for a missing file', async () => {
      const sandbox = await createSandbox();
      sdk.fs.read.mockRejectedValueOnce(new Error('Failed to read file: No such file or directory'));
      await expect(sandbox.filesystem.readFile('/nope')).rejects.toThrow(/No such file/);
      expect(sdk.sandbox.shell).not.toHaveBeenCalled();
    });

    it('returns an empty file as empty', async () => {
      const sandbox = await createSandbox();
      sdk.fs.read.mockResolvedValueOnce({ success: true, data: { path: '/tmp/e', content: '' } });
      expect(await sandbox.filesystem.readFile('/tmp/e')).toBe('');
      expect(sdk.sandbox.shell).not.toHaveBeenCalled();
    });

    it('lists a directory with types, sizes and times', async () => {
      const sandbox = await createSandbox();
      sdk.sandbox.shell.mockImplementationOnce(async (_id: string, opts: { cmd: string }) =>
        shellResult(
          { stdout: 'f\x0012\x001700000000\x00file1.txt\x00d\x004096\x001700000001\x00sub dir\x00f\x000\x001700000002\x00a\nb\x00' },
          opts.cmd
        )
      );
      const entries = await sandbox.filesystem.readdir('/tmp/my dir');
      expect(sdk.sandbox.shell.mock.calls[0][1].cmd).toContain('cd "/tmp/my dir"');
      expect(entries).toEqual([
        { name: 'file1.txt', type: 'file', size: 12, modified: new Date(1_700_000_000_000) },
        { name: 'sub dir', type: 'directory', size: 4096, modified: new Date(1_700_000_001_000) },
        { name: 'a\nb', type: 'file', size: 0, modified: new Date(1_700_000_002_000) },
      ]);
    });

    it('checks, creates and removes paths through the shell', async () => {
      const sandbox = await createSandbox();
      sdk.sandbox.shell.mockImplementation(async (_id: string, opts: { cmd: string }) => shellResult({}, opts.cmd));
      expect(await sandbox.filesystem.exists('/tmp/x')).toBe(true);
      await sandbox.filesystem.mkdir('/tmp/x');
      await sandbox.filesystem.remove('/tmp/x');
      const cmds = sdk.sandbox.shell.mock.calls.map((c) => c[1].cmd as string);
      expect(cmds[0]).toContain('test -e "/tmp/x"');
      expect(cmds[1]).toContain('mkdir -p "/tmp/x"');
      expect(cmds[2]).toContain('rm -rf "/tmp/x"');
    });
  });
});
