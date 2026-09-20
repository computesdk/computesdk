import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExitError, NotFoundError, Novita } from 'novita-sandbox';
import { novita } from '../index';

const api = vi.hoisted(() => ({
  create: vi.fn(), connect: vi.fn(), list: vi.fn(), kill: vi.fn(),
  createSnapshot: vi.fn(), listSnapshots: vi.fn(), deleteSnapshot: vi.fn(),
}));

const templateApi = vi.hoisted(() => ({
  new: vi.fn(), build: vi.fn(), list: vi.fn(), delete: vi.fn(),
}));

vi.mock('novita-sandbox', async () => {
  const actual = await vi.importActual<typeof import('novita-sandbox')>('novita-sandbox');
  return { ...actual, Novita: vi.fn(() => ({ sandbox: api, template: templateApi })) };
});

function nativeSandbox(id = 'sbx-1') {
  return {
    sandboxId: id,
    commands: { run: vi.fn().mockResolvedValue({ stdout: 'hello\n', stderr: '', exitCode: 0 }) },
    getHost: vi.fn((port: number) => `${port}-${id}.example.test`),
    getInfo: vi.fn().mockResolvedValue({
      sandboxId: id, templateId: 'base', state: 'running', metadata: { team: 'test' },
      startedAt: new Date('2026-01-01T00:00:00Z'), endAt: new Date('2026-01-01T00:10:00Z'),
    }),
    files: {
      read: vi.fn().mockResolvedValue('content'), write: vi.fn(), makeDir: vi.fn(),
      list: vi.fn(), exists: vi.fn().mockResolvedValue(true), remove: vi.fn(),
    },
  };
}

function pages<T>(...items: T[][]) {
  let index = 0;
  return {
    get hasNext() { return index < items.length; },
    nextItems: vi.fn(async () => items[index++]),
  };
}

describe('Novita provider', () => {
  let native: ReturnType<typeof nativeSandbox>;
  const provider = () => novita({ apiKey: 'test-key' });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('NOVITA_API_KEY', '');
    vi.mocked(Novita).mockImplementation(() => ({ sandbox: api, template: templateApi }) as unknown as Novita);
    native = nativeSandbox();
    api.create.mockResolvedValue(native);
    api.connect.mockResolvedValue(native);
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('requires credentials without making a remote request', async () => {
    await expect(novita({}).sandbox.create()).rejects.toThrow('NOVITA_API_KEY');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('accepts NOVITA_API_KEY without an E2B-style prefix and allows explicit override', async () => {
    vi.stubEnv('NOVITA_API_KEY', 'env-key');
    await novita({}).sandbox.create();
    expect(Novita).toHaveBeenLastCalledWith({ apiKey: 'env-key' });
    const sandbox = await provider().sandbox.create();
    expect(Novita).toHaveBeenLastCalledWith({ apiKey: 'test-key' });
    expect(api.create).toHaveBeenLastCalledWith('base', expect.objectContaining({ timeoutMs: 300_000 }));
    expect(sandbox.sandboxId).toBe('sbx-1');
    expect(sandbox.getInstance()).toBe(native);
  });

  it('maps template, environment, metadata and lifetime without forwarding framework fields', async () => {
    const sdk = novita({ apiKey: 'key', timeout: 600_000 });
    await sdk.sandbox.create({ templateId: 'python', envs: { HELLO: 'world' }, metadata: { team: 'test' } });
    expect(api.create).toHaveBeenLastCalledWith('python', expect.objectContaining({
      timeoutMs: 600_000, envs: { HELLO: 'world' }, metadata: { team: 'test' },
    }));
    await sdk.sandbox.create({ snapshotId: 'snap-1', timeout: 900_000, signal: new AbortController().signal });
    expect(api.create).toHaveBeenLastCalledWith('snap-1', expect.objectContaining({ timeoutMs: 900_000 }));
    expect(api.create.mock.lastCall?.[1]).not.toHaveProperty('signal');
    expect(api.create.mock.lastCall?.[1]).not.toHaveProperty('snapshotId');
    await expect(sdk.sandbox.create({ templateId: 'base', snapshotId: 'snap-1' })).rejects.toThrow('either');
  });

  it('only converts missing sandboxes to null, preserving authentication and network errors', async () => {
    api.connect.mockRejectedValueOnce(new NotFoundError('missing'));
    await expect(provider().sandbox.getById('missing')).resolves.toBeNull();
    api.connect.mockRejectedValueOnce(new Error('unauthorized'));
    await expect(provider().sandbox.getById('sbx-1')).rejects.toThrow('unauthorized');
  });

  it('fetches every page and returns connected, usable sandboxes', async () => {
    const paginator = pages([{ sandboxId: 'one' }], [{ sandboxId: 'expired' }, { sandboxId: 'two' }]);
    api.list.mockReturnValue(paginator);
    api.connect.mockImplementation(async (id: string) => {
      if (id === 'expired') throw new NotFoundError('expired');
      return nativeSandbox(id);
    });
    const sandboxes = await provider().sandbox.list();
    expect(paginator.nextItems).toHaveBeenCalledTimes(2);
    expect(api.list).toHaveBeenCalledWith({ query: { state: ['running'] } });
    expect(sandboxes.map(s => s.sandboxId)).toEqual(['one', 'two']);
    await expect(sandboxes[1].runCommand('echo hello')).resolves.toMatchObject({ stdout: 'hello\n' });
  });

  it('propagates list and connection failures instead of returning an empty list', async () => {
    api.list.mockReturnValue({ hasNext: true, nextItems: vi.fn().mockRejectedValue(new Error('network')) });
    await expect(provider().sandbox.list()).rejects.toThrow('network');
    api.list.mockReturnValue(pages([{ sandboxId: 'one' }]));
    api.connect.mockRejectedValue(new Error('unauthorized'));
    await expect(provider().sandbox.list()).rejects.toThrow('unauthorized');
  });

  it('kills by ID without connecting and preserves failures', async () => {
    api.kill.mockResolvedValue(false);
    await expect(provider().sandbox.destroy('gone')).resolves.toBeUndefined();
    expect(api.kill).toHaveBeenCalledWith('gone');
    expect(api.connect).not.toHaveBeenCalled();
    api.kill.mockRejectedValue(new Error('network'));
    await expect(provider().sandbox.destroy('one')).rejects.toThrow('network');
  });

  it('passes cwd and env as SDK options without shell interpolation', async () => {
    const sandbox = await provider().sandbox.create();
    const env = { VALUE: '"$(touch /tmp/unwanted)"' };
    await sandbox.runCommand('printf "%s" "$VALUE"', { cwd: '/tmp/a b', env, timeout: 0 });
    expect(native.commands.run).toHaveBeenCalledWith('printf "%s" "$VALUE"', expect.objectContaining({
      cwd: '/tmp/a b', envs: env, timeoutMs: 0,
    }));
  });

  it('preserves nonzero command output and distinguishes transport errors', async () => {
    const sandbox = await provider().sandbox.create();
    native.commands.run.mockRejectedValueOnce(new CommandExitError({ stdout: 'partial', stderr: 'failed', exitCode: 42 }));
    await expect(sandbox.runCommand('exit 42')).resolves.toMatchObject({ stdout: 'partial', stderr: 'failed', exitCode: 42 });
    native.commands.run.mockRejectedValueOnce(new Error('connection lost'));
    await expect(sandbox.runCommand('echo hi')).rejects.toThrow('connection lost');
  });

  it('streams through the native SDK before the command finishes', async () => {
    const sandbox = await provider().sandbox.create();
    const onStdout = vi.fn();
    const onStderr = vi.fn();
    let finish!: () => void;
    const completed = new Promise<void>(resolve => { finish = resolve; });
    native.commands.run.mockImplementation(async (_command, options) => {
      options.onStdout('first');
      options.onStderr('warning');
      await completed;
      return { stdout: 'first', stderr: 'warning', exitCode: 0 };
    });
    const running = sandbox.runCommand('work', { onStdout, onStderr });
    expect(onStdout).toHaveBeenCalledWith('first');
    expect(onStderr).toHaveBeenCalledWith('warning');
    finish();
    await running;
    expect(native.commands.run).toHaveBeenCalledTimes(1);
    expect(native.getHost).not.toHaveBeenCalled();
  });

  it('starts background commands natively and disconnects without killing the process', async () => {
    const sandbox = await provider().sandbox.create();
    const handle = { disconnect: vi.fn(), kill: vi.fn() };
    native.commands.run.mockResolvedValue(handle);
    await expect(sandbox.runCommand('serve', { background: true, cwd: '/app' })).resolves.toMatchObject({ exitCode: 0 });
    expect(native.commands.run).toHaveBeenCalledWith('serve', expect.objectContaining({ background: true, cwd: '/app' }));
    expect(handle.disconnect).toHaveBeenCalledOnce();
    expect(handle.kill).not.toHaveBeenCalled();
  });

  it('returns actual sandbox timestamps and maps paused status', async () => {
    const sandbox = await provider().sandbox.create();
    const info = await sandbox.getInfo();
    expect(info).toMatchObject({ id: 'sbx-1', provider: 'novita', status: 'running', timeout: 600_000,
      createdAt: new Date('2026-01-01T00:00:00Z'), metadata: { team: 'test', templateId: 'base' } });
    native.getInfo.mockResolvedValue({ ...await native.getInfo(), state: 'paused' });
    expect((await sandbox.getInfo()).status).toBe('stopped');
    await expect(sandbox.getUrl({ port: 8080 })).resolves.toBe('https://8080-sbx-1.example.test');
  });

  it('maps native file types and timestamps and supports a file lifecycle', async () => {
    const sandbox = await provider().sandbox.create();
    const modified = new Date('2026-01-01');
    native.files.list.mockResolvedValue([
      { name: 'dir', type: 'dir', size: 0, modifiedTime: modified },
      { name: 'file', type: 'file', size: 7 },
    ]);
    await sandbox.filesystem.mkdir('/tmp/test');
    await sandbox.filesystem.writeFile('/tmp/test/file', 'content');
    expect(await sandbox.filesystem.readFile('/tmp/test/file')).toBe('content');
    expect(await sandbox.filesystem.exists('/tmp/test/file')).toBe(true);
    expect(await sandbox.filesystem.readdir('/tmp')).toEqual([
      { name: 'dir', type: 'directory', size: 0, modified },
      { name: 'file', type: 'file', size: 7, modified: undefined },
    ]);
    await sandbox.filesystem.remove('/tmp/test/file');
    expect(native.files.write).toHaveBeenCalledWith('/tmp/test/file', 'content');
    expect(native.files.remove).toHaveBeenCalledWith('/tmp/test/file');
  });

  it('creates, lists and deletes snapshots using the snapshot API', async () => {
    const snapshots = provider().snapshot!;
    api.createSnapshot.mockResolvedValue({ snapshotId: 'snap-1' });
    expect(await snapshots.create('sbx-1')).toEqual({ id: 'snap-1', snapshotId: 'snap-1', provider: 'novita' });
    expect(api.createSnapshot).toHaveBeenCalledWith('sbx-1');
    api.listSnapshots.mockReturnValue(pages([{ snapshotId: 'snap-1' }], [{ snapshotId: 'snap-2' }]));
    expect((await snapshots.list({ sandboxId: 'sbx-1' })).map(s => s.id)).toEqual(['snap-1', 'snap-2']);
    expect(api.listSnapshots).toHaveBeenCalledWith({ sandboxId: 'sbx-1' });
    await snapshots.delete('snap-1');
    expect(api.deleteSnapshot).toHaveBeenCalledWith('snap-1');
  });

  it('honors snapshot result limits and rejects unsupported snapshot labels', async () => {
    const snapshots = provider().snapshot!;
    const paginator = pages([{ snapshotId: 'one' }, { snapshotId: 'two' }], [{ snapshotId: 'three' }]);
    api.listSnapshots.mockReturnValue(paginator);
    expect((await snapshots.list({ limit: 1 })).map(s => s.id)).toEqual(['one']);
    expect(paginator.nextItems).toHaveBeenCalledOnce();
    await expect(snapshots.create('sbx-1', { name: 'unsupported' })).rejects.toThrow('do not support');
    await expect(snapshots.list({ limit: -1 })).rejects.toThrow('non-negative');
  });

  it('builds a default template and uses its returned ID to create a sandbox', async () => {
    const definition = {};
    const fromBaseImage = vi.fn().mockReturnValue(definition);
    templateApi.new.mockReturnValue({ fromBaseImage });
    const build = { templateId: 'tpl-1', buildId: 'build-1', alias: 'base-copy', name: 'base-copy', tags: [] };
    let finish!: (value: typeof build) => void;
    templateApi.build.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const sdk = provider();
    const creating = sdk.template.create({ name: 'base-copy' });
    expect(fromBaseImage).toHaveBeenCalledOnce();
    expect(templateApi.build).toHaveBeenCalledWith(definition, 'base-copy', expect.any(Object));
    finish(build);
    const template = await creating;
    expect(template).toEqual({ ...build, id: 'tpl-1', provider: 'novita' });
    await sdk.sandbox.create({ templateId: template.id });
    expect(api.create).toHaveBeenCalledWith('tpl-1', expect.any(Object));
  });

  it('builds from an image with resources, cache settings, tags and log callbacks', async () => {
    const definition = {};
    const fromImage = vi.fn().mockReturnValue(definition);
    templateApi.new.mockReturnValue({ fromImage });
    templateApi.build.mockResolvedValue({ templateId: 'tpl-python', buildId: 'build-python' });
    const onBuildLogs = vi.fn();
    const build = { cpuCount: 2, memoryMB: 1024, skipCache: true, tags: ['test'], onBuildLogs };
    await provider().template.create({ name: 'python', image: 'python:3.12', build });
    expect(fromImage).toHaveBeenCalledWith('python:3.12');
    expect(templateApi.build).toHaveBeenCalledWith(definition, 'python', build);
    expect(Novita).toHaveBeenLastCalledWith({ apiKey: 'test-key' });
  });

  it('accepts native template definitions and preserves build failures', async () => {
    const definition = {};
    templateApi.build.mockRejectedValue(new Error('readiness check failed'));
    await expect(provider().template.create({ name: 'custom', template: definition })).rejects.toThrow('readiness check failed');
    expect(templateApi.new).not.toHaveBeenCalled();
    expect(templateApi.build).toHaveBeenCalledWith(definition, 'custom', expect.any(Object));
  });

  it('rejects ambiguous template sources and unsupported options before building', async () => {
    const templates = provider().template;
    await expect(templates.create({ name: ' ' })).rejects.toThrow('name is required');
    await expect(templates.create({ name: 'both', image: 'python:3.12', template: {} })).rejects.toThrow('either');
    await expect(templates.create({ name: 'test', metadata: { team: 'test' } })).rejects.toThrow('do not support');
    await expect(templates.create({ name: 'test', description: 'test' })).rejects.toThrow('do not support');
    expect(templateApi.build).not.toHaveBeenCalled();
  });

  it('lists templates through nextPage, preserving native fields across all pages', async () => {
    let page = 0;
    const createdAt = new Date('2026-01-01');
    const entries = [
      { templateId: 'tpl-1', buildId: 'build-1', aliases: ['one'], createdAt, cpuCount: 2 },
      { templateId: 'tpl-2', buildId: 'build-2', aliases: ['two'], createdAt, cpuCount: 4 },
    ];
    const paginator = {
      get hasNext() { return page < entries.length; },
      nextPage: vi.fn(async () => ({ templates: [entries[page++]] })),
    };
    templateApi.list.mockReturnValue(paginator);
    const templates = await provider().template.list();
    expect(templateApi.list).toHaveBeenCalledWith({ templateType: 'template_build', limit: 100 });
    expect(paginator.nextPage).toHaveBeenCalledTimes(2);
    expect(templates).toEqual(entries.map(entry => ({ ...entry, id: entry.templateId, provider: 'novita' })));
  });

  it('honors total template limits and validates them before querying', async () => {
    const templates = provider().template;
    await expect(templates.list({ limit: 0 })).resolves.toEqual([]);
    await expect(templates.list({ limit: -1 })).rejects.toThrow('non-negative');
    await expect(templates.list({ limit: 1.5 })).rejects.toThrow('integer');
    expect(templateApi.list).not.toHaveBeenCalled();
    const paginator = {
      hasNext: true,
      nextPage: vi.fn().mockResolvedValue({ templates: [{ templateId: 'one' }, { templateId: 'two' }] }),
    };
    templateApi.list.mockReturnValue(paginator);
    expect((await templates.list({ limit: 1 })).map(t => t.id)).toEqual(['one']);
    expect(paginator.nextPage).toHaveBeenCalledOnce();
  });

  it('propagates template list/delete failures and treats already deleted as success', async () => {
    const templates = provider().template;
    templateApi.list.mockReturnValue({ hasNext: true, nextPage: vi.fn().mockRejectedValue(new Error('network')) });
    await expect(templates.list()).rejects.toThrow('network');
    templateApi.delete.mockResolvedValue(false);
    await expect(templates.delete('gone')).resolves.toBeUndefined();
    expect(templateApi.delete).toHaveBeenCalledWith('gone');
    templateApi.delete.mockRejectedValue(new Error('unauthorized'));
    await expect(templates.delete('tpl-1')).rejects.toThrow('unauthorized');
  });
});
