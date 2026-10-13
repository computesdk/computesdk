import { execSync } from 'node:child_process';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationError, NotFoundError, Sandbox } from '@lizard-build/sdk';
import { lizard } from './index';

vi.mock('@lizard-build/sdk', async (original) => {
  const actual = await original<typeof import('@lizard-build/sdk')>();
  return {
    ...actual,
    Sandbox: Object.assign(vi.fn(), {
      create: vi.fn(), connect: vi.fn(), list: vi.fn(),
      snapshots: vi.fn(), deleteSnapshot: vi.fn(),
    }),
  };
});

function nativeSandbox() {
  return {
    sandboxId: 'sb-test',
    process: {
      exec: vi.fn().mockResolvedValue({ stdout: 'out', stderr: 'err', exitCode: 7 }),
      kill: vi.fn(), list: vi.fn().mockResolvedValue([]),
    },
    fs: {
      read: vi.fn(), write: vi.fn(), makeDir: vi.fn(), list: vi.fn(),
      stat: vi.fn(), remove: vi.fn(),
    },
    getInfo: vi.fn().mockResolvedValue({
      sandboxId: 'sb-test', status: 'running', template: 'interpreter',
      startedAt: '2026-10-14T00:00:00Z', endAt: '2026-10-14T00:05:00Z',
      metadata: { purpose: 'test' },
    }),
    exposePort: vi.fn().mockResolvedValue({ url: 'https://example.test/?lizard_token=test-token' }),
    snapshot: vi.fn(), kill: vi.fn().mockResolvedValue(true),
  };
}

describe('Lizard provider', () => {
  let native: ReturnType<typeof nativeSandbox>;
  const config = { apiKey: 'test-key', projectId: 'test-project' };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('LIZARD_API_KEY', '');
    vi.stubEnv('LIZARD_PROJECT_ID', '');
    vi.stubEnv('LIZARD_API_URL', '');
    native = nativeSandbox();
    vi.mocked(Sandbox.create).mockResolvedValue(native as unknown as Sandbox);
    vi.mocked(Sandbox.connect).mockResolvedValue(native as unknown as Sandbox);
    vi.mocked(Sandbox).mockImplementation(() => native as unknown as Sandbox);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('requires explicit credentials and a project', async () => {
    await expect(lizard().instances.create()).rejects.toThrow('LIZARD_API_KEY');
    await expect(lizard({ apiKey: 'key' }).instances.create()).rejects.toThrow('LIZARD_PROJECT_ID');
    expect(Sandbox.create).not.toHaveBeenCalled();
  });

  it('maps creation settings and keeps zero lifetime', async () => {
    const instance = await lizard({ ...config, apiUrl: 'https://api.example.test', size: 'small' })
      .instances.create({ timeout: 0, templateId: 'base', envs: { TASK: 'one' }, metadata: { task: 'one' } });
    expect(instance.instanceId).toBe('sb-test');
    expect(instance.getInstance()).toBe(native);
    expect(Sandbox.create).toHaveBeenCalledWith('base', expect.objectContaining({
      apiKey: 'test-key', projectId: 'test-project', apiUrl: 'https://api.example.test',
      size: 'small', timeoutMs: 0, envs: { TASK: 'one' }, metadata: { task: 'one' },
    }));
  });

  it('reads documented environment variables', async () => {
    vi.stubEnv('LIZARD_API_KEY', 'env-key');
    vi.stubEnv('LIZARD_PROJECT_ID', 'env-project');
    await lizard().instances.create();
    expect(Sandbox.create).toHaveBeenCalledWith('interpreter', expect.objectContaining({
      apiKey: 'env-key', projectId: 'env-project', timeoutMs: 300000,
    }));
  });

  it('rejects invalid options before creating a sandbox', async () => {
    const provider = lizard(config);
    await expect(provider.instances.create({ timeout: -1 })).rejects.toThrow('timeout');
    await expect(provider.instances.create({ size: 'enormous' })).rejects.toThrow('size');
    await expect(provider.instances.create({ metadata: { task: 1 } })).rejects.toThrow('strings');
    expect(Sandbox.create).not.toHaveBeenCalled();
  });

  it('only treats a missing sandbox as null', async () => {
    vi.mocked(Sandbox.connect).mockRejectedValueOnce(new NotFoundError('missing'));
    expect(await lizard(config).instances.getById('missing')).toBeNull();
    vi.mocked(Sandbox.connect).mockRejectedValueOnce(new AuthenticationError('denied'));
    await expect(lizard(config).instances.getById('sb')).rejects.toThrow('denied');
  });

  it('scopes list to the project and destroys the requested ID', async () => {
    vi.mocked(Sandbox.list).mockResolvedValue([{ sandboxId: 'sb-test' }] as never);
    const provider = lizard(config);
    const instances = await provider.instances.list();
    expect(instances.map(item => item.instanceId)).toEqual(['sb-test']);
    expect(Sandbox.list).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'test-project' }));
    await provider.instances.destroy('sb-test');
    expect(Sandbox).toHaveBeenCalledWith(expect.objectContaining({ sandboxId: 'sb-test' }));
    expect(native.kill).toHaveBeenCalledOnce();
  });

  it('preserves output and failed exit codes, cwd, env and timeouts', async () => {
    const instance = await lizard(config).instances.create();
    const result = await instance.runCommand('exit 7', { cwd: '/tmp', env: { A: 'x' }, timeout: 4000 });
    expect(result).toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 7 });
    expect(native.process.exec).toHaveBeenCalledWith('exit 7', expect.objectContaining({
      workdir: '/tmp', envs: { A: 'x' }, timeoutMs: 4000,
    }));
    await expect(instance.runCommand('x', { timeout: 600001 })).rejects.toThrow('timeout');
  });

  it('streams through the native SDK callbacks', async () => {
    const onStdout = vi.fn();
    const onStderr = vi.fn();
    native.process.exec.mockImplementation(async (_command, options) => {
      options.onStdout('first'); options.onStderr('warning');
      return { stdout: 'first', stderr: 'warning', exitCode: 0 };
    });
    const instance = await lizard(config).instances.create();
    await instance.runCommand('echo first', { onStdout, onStderr });
    expect(onStdout).toHaveBeenCalledWith('first');
    expect(onStderr).toHaveBeenCalledWith('warning');
  });

  it('quotes detached commands without evaluating their contents in the outer shell', async () => {
    const command = 'printf \'%s\' \'$HOME `uname` "quoted" $(echo injected)\'';
    const instance = await lizard(config).instances.create();
    await instance.runCommand(command, { background: true });
    const wrapper = native.process.exec.mock.calls[0][0] as string;
    // Replace only the fixed detachment wrapper, then execute the same quoted argument.
    const foreground = wrapper.replace(/^nohup /, '').replace(' </dev/null >/dev/null 2>&1 &', '');
    expect(execSync(foreground, { encoding: 'utf8' })).toBe('$HOME `uname` "quoted" $(echo injected)');
  });

  it('turns SDK lines into exact streamed chunks, including blank lines and spaces', async () => {
    const chunks: string[] = [];
    native.process.exec.mockImplementation(async (_command, options) => {
      for (const line of ['first  ', '', 'second', '']) options.onStdout(line);
      return { stdout: 'first  \n\nsecond', stderr: '', exitCode: 0 };
    });
    const instance = await lizard(config).instances.create();
    const result = await instance.runCommand('x', { onStdout: c => chunks.push(c) });
    expect(chunks.join('')).toBe(result.stdout);
  });

  it('kills only the known process tree on a streaming deadline', async () => {
    native.process.exec.mockImplementation(async (_command, options) => {
      options.onPid(123);
      options.onStdout('partial');
      throw new DOMException('deadline', 'TimeoutError');
    });
    const instance = await lizard(config).instances.create();
    expect(await instance.runCommand('sleep 5', { timeout: 1000, onStdout: () => {} }))
      .toMatchObject({ stdout: 'partial', exitCode: 124 });
    expect(native.process.kill).toHaveBeenCalledWith(123, 'SIGKILL');
  });

  it('does not hide a timeout before a PID arrives', async () => {
    native.process.exec.mockRejectedValue(new DOMException('connection timed out', 'TimeoutError'));
    const instance = await lizard(config).instances.create();
    await expect(instance.runCommand('x', { onStdout: () => {} })).rejects.toThrow('connection timed out');
    expect(native.process.kill).not.toHaveBeenCalled();
  });

  it('checks a 400 signal response against the active process list', async () => {
    native.process.exec.mockImplementation(async (_command, options) => {
      options.onPid(123);
      throw new DOMException('deadline', 'TimeoutError');
    });
    const error = Object.assign(new Error('no such process'), { status: 400 });
    // Use the SDK error type so unrelated errors cannot enter this path.
    const { LizardError } = await import('@lizard-build/sdk');
    const missing = Object.assign(new LizardError(error.message), { status: 400 });
    native.process.kill.mockRejectedValue(missing);
    const instance = await lizard(config).instances.create();
    expect((await instance.runCommand('x', { onStdout: () => {} })).exitCode).toBe(124);
    native.process.list.mockResolvedValue([{ pid: 123 }]);
    await expect(instance.runCommand('x', { onStdout: () => {} })).rejects.toThrow('no such process');
  });

  it('keeps the access token in the HTTPS URL and rejects unsupported protocols', async () => {
    const instance = await lizard(config).instances.create();
    expect(await instance.getUrl({ port: 3000 })).toBe('https://example.test/?lizard_token=test-token');
    await expect(instance.getUrl({ port: 3000, protocol: 'wss' })).rejects.toThrow('HTTPS');
    await expect(instance.getUrl({ port: 70000 })).rejects.toThrow('Port');
  });

  it('uses real lifecycle timestamps and status', async () => {
    const instance = await lizard(config).instances.create();
    expect(await instance.getInfo()).toMatchObject({
      id: 'sb-test', provider: 'lizard', status: 'running', timeout: 300000,
      createdAt: new Date('2026-10-14T00:00:00Z'), metadata: { purpose: 'test' },
    });
  });

  it('maps files and never hides account or expired-sandbox errors', async () => {
    const instance = await lizard(config).instances.create();
    native.fs.list.mockResolvedValue([{ name: 'dir', type: 'dir', size: 0, modTime: 1000 }]);
    expect(await instance.filesystem.readdir('/tmp')).toEqual([
      { name: 'dir', type: 'directory', size: 0, modified: new Date(1000) },
    ]);
    native.fs.stat.mockRejectedValueOnce(new NotFoundError('missing file'));
    expect(await instance.filesystem.exists('/tmp/missing')).toBe(false);
    native.fs.stat.mockRejectedValueOnce(new AuthenticationError('denied'));
    await expect(instance.filesystem.exists('/tmp/x')).rejects.toThrow('denied');
    native.fs.stat.mockRejectedValueOnce(new NotFoundError('gone'));
    native.getInfo.mockRejectedValueOnce(new NotFoundError('sandbox expired'));
    await expect(instance.filesystem.exists('/tmp/x')).rejects.toThrow('sandbox expired');
  });
});
