import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vercel } from '../index';

const fs = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn(),
  exists: vi.fn(),
  rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@vercel/sandbox', () => {
  const mockSandboxInstance = {
    name: 'mock-sandbox-id',
    fs,
    mkDir: vi.fn().mockRejectedValue(new Error('Status code 400 is not ok: error creating directory: No such file or directory')),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  return {
    Sandbox: {
      create: vi.fn().mockResolvedValue(mockSandboxInstance),
      get: vi.fn().mockResolvedValue(mockSandboxInstance),
    },
    Snapshot: { get: vi.fn() },
  };
});

describe('Vercel filesystem via sandbox.fs', () => {
  const provider = vercel({ token: 't', teamId: 'team', projectId: 'proj' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mkdir creates parent directories recursively instead of using the non-recursive mkDir API', async () => {
    const sandbox = await provider.sandbox.create();
    await sandbox.filesystem.mkdir('/tmp/bench/fs-123');
    expect(fs.mkdir).toHaveBeenCalledWith('/tmp/bench/fs-123', { recursive: true });
  });

  it('readdir maps dirents to FileEntry', async () => {
    fs.readdir.mockResolvedValue([
      { name: 'a.txt', isDirectory: () => false },
      { name: 'sub', isDirectory: () => true },
    ]);
    const sandbox = await provider.sandbox.create();
    expect(await sandbox.filesystem.readdir('/tmp/bench')).toEqual([
      { name: 'a.txt', type: 'file' },
      { name: 'sub', type: 'directory' },
    ]);
    expect(fs.readdir).toHaveBeenCalledWith('/tmp/bench', { withFileTypes: true });
  });

  it('exists delegates to fs.exists', async () => {
    fs.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const sandbox = await provider.sandbox.create();
    expect(await sandbox.filesystem.exists('/tmp/bench')).toBe(true);
    expect(await sandbox.filesystem.exists('/nope')).toBe(false);
  });

  it('remove is recursive and tolerates missing paths', async () => {
    const sandbox = await provider.sandbox.create();
    await sandbox.filesystem.remove('/tmp/bench');
    expect(fs.rm).toHaveBeenCalledWith('/tmp/bench', { recursive: true, force: true });
  });
});
