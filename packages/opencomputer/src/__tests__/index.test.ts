import { beforeEach, describe, expect, it, vi } from 'vitest';
import { opencomputer } from '../index';

const createMock = vi.fn();
const connectMock = vi.fn();
const createFromCheckpointMock = vi.fn();

vi.mock('@opencomputer/sdk', () => ({
  Sandbox: {
    create: createMock,
    connect: connectMock,
    createFromCheckpoint: createFromCheckpointMock,
  },
}));

function makeSandbox(overrides: Record<string, unknown> = {}) {
  return {
    sandboxId: 'sb_123',
    id: 'sb_123',
    status: 'running',
    previewAuthToken: '',
    webhooks: [],
    exec: {
      run: vi.fn().mockResolvedValue({ stdout: 'ok\n', stderr: '', exitCode: 0 }),
    },
    commands: {
      run: vi.fn().mockResolvedValue({ stdout: 'ok\n', stderr: '', exitCode: 0 }),
    },
    files: {
      read: vi.fn().mockResolvedValue('file-content'),
      write: vi.fn().mockResolvedValue(undefined),
      makeDir: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([
        { name: 'app.ts', isDir: false, path: '/workspace/app.ts', size: 10 },
        { name: 'src', isDir: true, path: '/workspace/src', size: 0 },
      ]),
      exists: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    getPreviewDomain: vi.fn().mockReturnValue('sb_123-p3000.preview.opencomputer.dev'),
    createPreviewURL: vi.fn().mockResolvedValue({ hostname: 'sb_123-p3000.preview.opencomputer.dev', port: 3000 }),
    listPreviewURLs: vi.fn().mockResolvedValue([]),
    kill: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockResolvedValue(true),
    createCheckpoint: vi.fn().mockResolvedValue({
      id: 'cp_123',
      sandboxId: 'sb_123',
      orgId: 'org_123',
      name: 'snapshot',
      status: 'processing',
      sizeBytes: 42,
      createdAt: '2026-01-01T00:00:00.000Z',
      sandboxConfig: { template: 'base' },
    }),
    listCheckpoints: vi.fn().mockResolvedValue([
      {
        id: 'cp_123',
        sandboxId: 'sb_123',
        name: 'snapshot',
        status: 'ready',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]),
    deleteCheckpoint: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('opencomputer provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates OpenComputer sandboxes with normalized options', async () => {
    const native = makeSandbox();
    createMock.mockResolvedValue(native);
    const provider = opencomputer({
      apiKey: 'osb_test',
      apiUrl: 'https://api.example.test',
      template: 'base',
      timeout: 60_000,
      memoryMB: 4096,
    });

    const sandbox = await provider.sandbox.create({
      templateId: 'node',
      timeout: 120_000,
      envs: { NODE_ENV: 'test' },
      metadata: { nested: { ok: true } },
      memory: 8192,
    });

    expect(sandbox.sandboxId).toBe('sb_123');
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'osb_test',
      apiUrl: 'https://api.example.test',
      template: 'node',
      timeout: 120,
      envs: { NODE_ENV: 'test' },
      metadata: { nested: '{"ok":true}' },
      memoryMB: 8192,
    }));
  });

  it('runs commands through the native exec API', async () => {
    const native = makeSandbox();
    createMock.mockResolvedValue(native);
    const sandbox = await opencomputer().sandbox.create();

    const result = await sandbox.runCommand('echo ok', { cwd: '/workspace', timeout: 5_000 });

    expect(native.exec.run).toHaveBeenCalledWith('echo ok', expect.objectContaining({
      cwd: '/workspace',
      timeout: 5,
      timeoutMs: 5000,
    }));
    expect(result).toMatchObject({ stdout: 'ok\n', stderr: '', exitCode: 0 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('maps filesystem and preview URL operations', async () => {
    const native = makeSandbox();
    createMock.mockResolvedValue(native);
    const sandbox = await opencomputer().sandbox.create();

    await sandbox.filesystem.writeFile('/workspace/app.ts', 'console.log(1)');
    expect(await sandbox.filesystem.readFile('/workspace/app.ts')).toBe('file-content');
    const entries = await sandbox.filesystem.readdir('/workspace');
    const url = await sandbox.getUrl({ port: 3000 });

    expect(native.files.write).toHaveBeenCalledWith('/workspace/app.ts', 'console.log(1)');
    expect(entries).toEqual([
      expect.objectContaining({ name: 'app.ts', type: 'file', size: 10 }),
      expect.objectContaining({ name: 'src', type: 'directory', size: 0 }),
    ]);
    expect(url).toBe('https://sb_123-p3000.preview.opencomputer.dev');
  });

  it('connects, destroys, and handles missing sandboxes', async () => {
    const native = makeSandbox();
    connectMock.mockResolvedValueOnce(native).mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce(native);
    const provider = opencomputer({ apiKey: 'osb_test' });

    expect(await provider.sandbox.getById('sb_123')).toBeTruthy();
    expect(await provider.sandbox.getById('missing')).toBeNull();
    await provider.sandbox.destroy('sb_123');

    expect(connectMock).toHaveBeenCalledWith('sb_123', { apiKey: 'osb_test', apiUrl: undefined });
    expect(native.kill).toHaveBeenCalled();
  });

  it('creates sandboxes from checkpoint ids and composite snapshot ids', async () => {
    createFromCheckpointMock.mockResolvedValue(makeSandbox({ sandboxId: 'sb_clone', id: 'sb_clone' }));
    const provider = opencomputer({ apiKey: 'osb_test', timeout: 60_000 });

    await provider.sandbox.create({ snapshotId: 'sb_123:cp_123', envs: { A: '1' } });

    expect(createFromCheckpointMock).toHaveBeenCalledWith('cp_123', {
      apiKey: 'osb_test',
      apiUrl: undefined,
      timeout: 60,
      envs: { A: '1' },
      secretStore: undefined,
    });
  });

  it('retries fork creation while the checkpoint edge index catches up', async () => {
    vi.useFakeTimers();
    try {
      createFromCheckpointMock
        .mockRejectedValueOnce(new Error('Failed to create sandbox from checkpoint: 404 {"error":"checkpoint not found"}'))
        .mockResolvedValueOnce(makeSandbox({ sandboxId: 'sb_clone', id: 'sb_clone' }));
      const provider = opencomputer({ apiKey: 'osb_test' });

      const pending = provider.sandbox.create({ snapshotId: 'sb_123:cp_123' });
      await vi.advanceTimersByTimeAsync(1_000);
      const sandbox = await pending;

      expect(sandbox.sandboxId).toBe('sb_clone');
      expect(createFromCheckpointMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes checkpoints through the snapshot manager', async () => {
    const native = makeSandbox();
    connectMock.mockResolvedValue(native);
    const provider = opencomputer({ apiKey: 'osb_test' });

    const created = await provider.snapshot!.create('sb_123', { name: 'snapshot', metadata: { kind: 'disk_only' } });
    const listed = await provider.snapshot!.list({ sandboxId: 'sb_123' });
    await provider.snapshot!.delete('sb_123:cp_123');

    expect(created.id).toBe('sb_123:cp_123');
    expect(created.provider).toBe('opencomputer');
    expect(native.createCheckpoint).toHaveBeenCalledWith('snapshot', {
      kind: 'disk_only',
      promoteToFull: true,
      retentionPolicy: undefined,
    });
    expect(native.listCheckpoints).toHaveBeenCalled();
    expect(listed[0].id).toBe('sb_123:cp_123');
    expect(native.deleteCheckpoint).toHaveBeenCalledWith('cp_123');
  });

  it('defaults snapshots to disk-only with full promotion', async () => {
    const native = makeSandbox();
    connectMock.mockResolvedValue(native);
    const provider = opencomputer({ apiKey: 'osb_test' });

    await provider.snapshot!.create('sb_123', { name: 'default-snapshot' });

    expect(native.createCheckpoint).toHaveBeenCalledWith('default-snapshot', {
      kind: 'disk_only',
      promoteToFull: true,
      retentionPolicy: undefined,
    });
    expect(native.listCheckpoints).toHaveBeenCalled();
  });
});
