import { beforeEach, describe, expect, it, vi } from 'vitest';
import { neevcloud } from '../index';

// A stand-in for @neevcloud/sdk: one scripted sandbox handle and spies on the client.
const sdk = vi.hoisted(() => {
  class NotFoundError extends Error {}
  class BadRequestError extends Error {}
  class DeadlineExceededError extends Error {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sandbox: Record<string, any> = {
    id: 'sb-1',
    name: 'box',
    region: 'as-mum-1',
    templateId: 'tpl-1',
    phase: 'Ready',
    data: { created_at: '2026-10-01T00:00:00Z', max_lifetime_seconds: 600 as number | null },
    waitUntilReady: vi.fn(async () => sandbox),
    delete: vi.fn(async () => undefined),
    exec: vi.fn(),
    processes: { start: vi.fn(async () => ({ id: 'p-1' })) },
    files: {
      readText: vi.fn(),
      write: vi.fn(),
      mkdir: vi.fn(),
      list: vi.fn(),
      exists: vi.fn(),
      remove: vi.fn(),
    },
  };
  const client = {
    sandboxes: {
      create: vi.fn(async (_params: unknown) => sandbox),
      get: vi.fn(async () => sandbox),
      list: vi.fn(),
      delete: vi.fn(async () => undefined),
      createSnapshot: vi.fn(),
      waitForSnapshot: vi.fn(),
      listSnapshots: vi.fn(),
      deleteSnapshot: vi.fn(async () => undefined),
    },
    templates: { list: vi.fn() },
  };
  class Neev {
    sandboxes = client.sandboxes;
    templates = client.templates;
  }
  return { Neev, NotFoundError, BadRequestError, DeadlineExceededError, sandbox, client };
});
vi.mock('@neevcloud/sdk', () => ({
  Neev: sdk.Neev,
  NotFoundError: sdk.NotFoundError,
  BadRequestError: sdk.BadRequestError,
  DeadlineExceededError: sdk.DeadlineExceededError,
}));

const snapshotData = (id: string, sandboxId: string) => ({
  id,
  sandbox_id: sandboxId,
  name: `snap-${id}`,
  status: 'Ready',
  size_bytes: 42,
  created_at: '2026-10-02T00:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  sdk.sandbox.data.max_lifetime_seconds = 600;
});

describe('create options', () => {
  const createdWith = async (options: Record<string, unknown> = {}) => {
    await neevcloud({}).sandbox.create(options);
    return sdk.client.sandboxes.create.mock.calls[0][0];
  };

  it('success: boots the default template when no options are given', async () => {
    expect(await createdWith()).toEqual({ sandbox_template_id: undefined });
  });

  it('success: maps name, envs, cpu, memory and timeout', async () => {
    expect(await createdWith({
      templateId: 'tpl', name: 'box', envs: { A: '1' }, cpu: 2, memory: 2048, timeout: 90_500,
    })).toEqual({
      sandbox_template_id: 'tpl',
      name: 'box',
      env: [{ name: 'A', value: '1' }],
      resources: { cpu: 2, memory_gb: 2 },
      lifecycle: { max_lifetime_seconds: 91, on_idle: 'delete' },
    });
  });

  it('success: a snapshot restore replaces the image and template', async () => {
    expect(await createdWith({ snapshotId: 'snap', image: 'img', templateId: 'tpl' })).toEqual({ restore: 'snap' });
  });

  it('success: an image wins over a template', async () => {
    expect(await createdWith({ image: 'img', templateId: 'tpl' })).toEqual({ image: 'img' });
  });
});

describe('sandbox', () => {
  it('success: create waits for Ready', async () => {
    const created = await neevcloud({}).sandbox.create({ name: 'box' });
    expect(sdk.client.sandboxes.create).toHaveBeenCalledWith({ sandbox_template_id: undefined, name: 'box' });
    expect(sdk.sandbox.waitUntilReady).toHaveBeenCalled();
    expect(created.sandboxId).toBe('sb-1');
  });

  it('failure: a create aborted while waiting deletes the sandbox', async () => {
    const controller = new AbortController();
    sdk.sandbox.waitUntilReady.mockImplementationOnce(async () => { controller.abort(); return sdk.sandbox; });
    await expect(neevcloud({}).sandbox.create({ signal: controller.signal })).rejects.toThrow();
    expect(sdk.sandbox.delete).toHaveBeenCalled();
  });

  it('success: runCommand applies cwd with cd so paths outside the workspace work', async () => {
    sdk.sandbox.exec.mockResolvedValueOnce({ stdout: 'ok', stderr: '', exitCode: 0 });
    const sandbox = await neevcloud({}).sandbox.create();
    const result = await sandbox.runCommand('ls', { cwd: "/tmp/it's" });
    expect(sdk.sandbox.exec).toHaveBeenCalledWith(['sh', '-c', `cd -- '/tmp/it'\\''s' || exit\nls`], { env: undefined, timeoutMs: undefined });
    expect(result.stdout).toBe('ok');
  });

  it('success: onStdout streams through the exec stream', async () => {
    sdk.sandbox.exec.mockImplementationOnce(async function* () {
      yield { type: 'stdout', data: 'a\n' };
      yield { type: 'stderr', data: 'b\n' };
      yield { type: 'exit', exitCode: 3 };
    });
    const sandbox = await neevcloud({}).sandbox.create();
    const out: string[] = [];
    const result = await sandbox.runCommand('x', { onStdout: (d) => out.push(d), onStderr: (d) => out.push(`E:${d}`) });
    expect(sdk.sandbox.exec).toHaveBeenCalledWith(['sh', '-c', 'x'], { stream: true, env: undefined, timeoutMs: undefined });
    expect(out).toEqual(['a\n', 'E:b\n']);
    expect(result).toMatchObject({ stdout: 'a\n', stderr: 'b\n', exitCode: 3 });
  });

  it('failure: a streamed command past its timeout keeps its output and exits 124', async () => {
    sdk.sandbox.exec.mockImplementationOnce(async function* () {
      yield { type: 'stdout', data: 'starting\n' };
      throw new sdk.DeadlineExceededError('exec timed out');
    });
    const sandbox = await neevcloud({}).sandbox.create();
    const result = await sandbox.runCommand('sleep 60', { timeout: 5000, onStdout: () => {} });
    expect(result).toMatchObject({ stdout: 'starting\n', stderr: 'command timed out after 5000ms', exitCode: 124 });
  });

  it('failure: a buffered command past its timeout exits 124', async () => {
    sdk.sandbox.exec.mockRejectedValueOnce(new sdk.DeadlineExceededError('exec timed out'));
    const sandbox = await neevcloud({}).sandbox.create();
    expect(await sandbox.runCommand('sleep 60', { timeout: 5000 })).toMatchObject({ exitCode: 124 });
  });

  it('failure: a timeout with no caller timeout says so without a duration', async () => {
    sdk.sandbox.exec.mockRejectedValueOnce(new sdk.DeadlineExceededError('exec timed out'));
    const sandbox = await neevcloud({}).sandbox.create();
    expect(await sandbox.runCommand('sleep 600')).toMatchObject({ stderr: 'command timed out', exitCode: 124 });
  });

  it('success: getInfo reports the lifetime and metadata', async () => {
    const sandbox = await neevcloud({}).sandbox.create();
    expect(await sandbox.getInfo()).toMatchObject({
      status: 'running',
      timeout: 600_000,
      metadata: { name: 'box', region: 'as-mum-1', templateId: 'tpl-1' },
    });
  });
});

describe('filesystem', () => {
  it('success: an absolute workspace path goes to the native API unchanged', async () => {
    sdk.sandbox.files.readText.mockResolvedValueOnce('hi');
    const sandbox = await neevcloud({}).sandbox.create();
    expect(await sandbox.filesystem.readFile('/workspace/a.txt')).toBe('hi');
    expect(sdk.sandbox.files.readText).toHaveBeenCalledWith('/workspace/a.txt');
  });

  it('success: a path outside the workspace falls back to the shell', async () => {
    sdk.sandbox.files.write.mockRejectedValueOnce(new sdk.BadRequestError('escapes workspace root'));
    sdk.sandbox.exec.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 });
    const sandbox = await neevcloud({}).sandbox.create();
    await sandbox.filesystem.writeFile('/tmp/x.txt', 'hi');
    const command = sdk.sandbox.exec.mock.calls[0][0][2] as string;
    expect(command).toContain(`base64 -d > '/tmp/x.txt'`);
    expect(command).toContain(Buffer.from('hi').toString('base64'));
  });

  it('success: readdir outside the workspace decodes any filename', async () => {
    sdk.sandbox.files.list.mockRejectedValueOnce(new sdk.BadRequestError('escapes workspace root'));
    const b64 = (name: string) => Buffer.from(name).toString('base64');
    sdk.sandbox.exec.mockResolvedValueOnce({
      stdout: `d\t4096 1700000000\t${b64('dir')}\nf\t3 1700000001\t${b64('new\nline\ttab')}\n`,
      stderr: '',
      exitCode: 0,
    });
    const sandbox = await neevcloud({}).sandbox.create();
    expect(await sandbox.filesystem.readdir('/tmp')).toEqual([
      { name: 'dir', type: 'directory', size: 4096, modified: new Date(1_700_000_000_000) },
      { name: 'new\nline\ttab', type: 'file', size: 3, modified: new Date(1_700_000_001_000) },
    ]);
  });

  it('success: remove deletes a directory with its contents', async () => {
    const sandbox = await neevcloud({}).sandbox.create();
    await sandbox.filesystem.remove('/workspace/dir');
    expect(sdk.sandbox.files.remove).toHaveBeenCalledWith('/workspace/dir', { recursive: true });
  });

  it('failure: a relative path refused by the API is not retried through the shell', async () => {
    sdk.sandbox.files.exists.mockRejectedValueOnce(new sdk.BadRequestError('bad path'));
    const sandbox = await neevcloud({}).sandbox.create();
    await expect(sandbox.filesystem.exists('../x')).rejects.toThrow('bad path');
    expect(sdk.sandbox.exec).not.toHaveBeenCalled();
  });

  it('failure: a shell fallback that exits non-zero throws its stderr', async () => {
    sdk.sandbox.files.readText.mockRejectedValueOnce(new sdk.BadRequestError('escapes workspace root'));
    sdk.sandbox.exec.mockResolvedValueOnce({ stdout: '', stderr: 'cat: no such file\n', exitCode: 1 });
    const sandbox = await neevcloud({}).sandbox.create();
    await expect(sandbox.filesystem.readFile('/tmp/missing')).rejects.toThrow('cat: no such file');
  });
});

describe('snapshot', () => {
  it('success: create waits for the snapshot to be Ready', async () => {
    sdk.client.sandboxes.createSnapshot.mockResolvedValueOnce({ ...snapshotData('s1', 'sb-1'), status: 'Pending' });
    sdk.client.sandboxes.waitForSnapshot.mockResolvedValueOnce(snapshotData('s1', 'sb-1'));
    const snap = await neevcloud({}).snapshot!.create('sb-1', { name: 'n' });
    expect(sdk.client.sandboxes.createSnapshot).toHaveBeenCalledWith('sb-1', { name: 'n' });
    expect(sdk.client.sandboxes.waitForSnapshot).toHaveBeenCalledWith('s1');
    expect(snap).toEqual({
      id: 's1',
      provider: 'neevcloud',
      createdAt: new Date('2026-10-02T00:00:00Z'),
      metadata: { name: 'snap-s1', sandboxId: 'sb-1', status: 'Ready', sizeBytes: 42 },
    });
  });

  it('success: list without a sandboxId visits every sandbox and honors limit', async () => {
    sdk.client.sandboxes.list.mockResolvedValueOnce({ items: [{ id: 'a' }, { id: 'b' }], total: 2 });
    sdk.client.sandboxes.listSnapshots
      .mockResolvedValueOnce({ items: [snapshotData('s1', 'a')], total: 1 })
      .mockResolvedValueOnce({ items: [snapshotData('s2', 'b'), snapshotData('s3', 'b')], total: 2 });
    const snaps = await neevcloud({}).snapshot!.list({ limit: 2 });
    expect(snaps.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('success: list with a sandboxId only reads that sandbox', async () => {
    sdk.client.sandboxes.listSnapshots.mockResolvedValueOnce({ items: [snapshotData('s1', 'a')], total: 1 });
    await neevcloud({}).snapshot!.list({ sandboxId: 'a' });
    expect(sdk.client.sandboxes.list).not.toHaveBeenCalled();
    expect(sdk.client.sandboxes.listSnapshots).toHaveBeenCalledWith('a', { page: 1, limit: 100 });
  });

  it('success: delete removes the snapshot', async () => {
    await neevcloud({}).snapshot!.delete('s1');
    expect(sdk.client.sandboxes.deleteSnapshot).toHaveBeenCalledWith('s1');
  });
});

describe('template', () => {
  it('success: list pages through the catalogue', async () => {
    sdk.client.templates.list
      .mockResolvedValueOnce({ items: [{ id: 't1' }], total: 2 })
      .mockResolvedValueOnce({ items: [{ id: 't2' }], total: 2 });
    expect((await neevcloud({}).template!.list()).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('success: list honors limit', async () => {
    sdk.client.templates.list.mockResolvedValueOnce({ items: [{ id: 't1' }, { id: 't2' }, { id: 't3' }], total: 3 });
    expect((await neevcloud({}).template!.list({ limit: 2 })).map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('failure: the managed catalogue cannot be created or deleted', async () => {
    await expect(neevcloud({}).template!.create({ name: 'x' })).rejects.toThrow('managed catalogue');
    await expect(neevcloud({}).template!.delete('t1')).rejects.toThrow('managed catalogue');
  });
});
