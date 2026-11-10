
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vercel } from '../index';
import { Sandbox as VercelSandbox, Snapshot as VercelSnapshot } from '@vercel/sandbox';

// Mock @vercel/sandbox
vi.mock('@vercel/sandbox', () => {
  const mockSnapshotInstance = {
    delete: vi.fn().mockResolvedValue(undefined),
  };

  const mockSandboxInstance = {
    name: 'mock-sandbox-id',
    persistent: true,
    snapshot: vi.fn().mockResolvedValue(mockSnapshotInstance),
    stop: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    listSnapshots: vi.fn().mockResolvedValue([
      { id: 'snap-auto', status: 'created', creationMethod: 'automatic' },
      { id: 'snap-user', status: 'created', creationMethod: 'manual' },
    ]),
  };

  return {
    Sandbox: {
      create: vi.fn().mockResolvedValue(mockSandboxInstance),
      get: vi.fn().mockResolvedValue({ ...mockSandboxInstance, name: 'resumed' }),
    },
    Snapshot: {
      get: vi.fn().mockResolvedValue(mockSnapshotInstance),
      list: vi.fn().mockResolvedValue({
        snapshots: [
          { id: 'snap-1', sourceSessionId: 'sess-1', region: 'iad1', status: 'created', sizeBytes: 10, createdAt: 1, updatedAt: 1 },
          { id: 'snap-2', sourceSessionId: 'sess-2', region: 'iad1', status: 'deleted', sizeBytes: 0, createdAt: 2, updatedAt: 2 },
        ],
      }),
    }
  };
});

describe('Vercel Snapshot Support', () => {
  const config = {
    token: 'mock-token',
    teamId: 'mock-team',
    projectId: 'mock-project'
  };

  const provider = vercel(config);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a snapshot', async () => {
    if (!provider.snapshot) {
      throw new Error('Snapshot manager not initialized');
    }

    await provider.snapshot.create('sandbox-123');
    
    expect(VercelSandbox.get).toHaveBeenCalledWith(expect.objectContaining({
      name: 'sandbox-123',
      token: 'mock-token',
      teamId: 'mock-team',
      projectId: 'mock-project'
    }));
    
    // Check that .snapshot() was called on the sandbox instance
    // We can't easily access the mock instance returned by get() inside the mock definition unless we expose it
    // But verify calling sequence is enough for now or use the return value
    const mockSandbox = await (VercelSandbox.get as any).mock.results[0].value;
    expect(mockSandbox.snapshot).toHaveBeenCalled();
  });

  it('should delete a snapshot', async () => {
    if (!provider.snapshot) {
      throw new Error('Snapshot manager not initialized');
    }

    await provider.snapshot.delete('snapshot-123');

    expect(VercelSnapshot.get).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: 'snapshot-123',
      token: 'mock-token',
      teamId: 'mock-team',
      projectId: 'mock-project'
    }));

    const mockSnapshot = await (VercelSnapshot.get as any).mock.results[0].value;
    expect(mockSnapshot.delete).toHaveBeenCalled();
  });

  it('should create a sandbox from a snapshot', async () => {
    await provider.sandbox.create({ snapshotId: 'snap-123' });

    expect(VercelSandbox.create).toHaveBeenCalledWith(expect.objectContaining({
      source: {
        type: 'snapshot',
        snapshotId: 'snap-123'
      },
      token: 'mock-token',
      teamId: 'mock-team',
      projectId: 'mock-project'
    }));
  });

  it('should create a sandbox from a snapshot using nested source format', async () => {
    // This format matches the Vercel SDK's native format
    // The gateway may pass options in this format
    await provider.sandbox.create({ 
      source: { 
        type: 'snapshot', 
        snapshotId: 'snap-456' 
      } 
    } as any);

    expect(VercelSandbox.create).toHaveBeenCalledWith(expect.objectContaining({
      source: {
        type: 'snapshot',
        snapshotId: 'snap-456'
      },
      token: 'mock-token',
      teamId: 'mock-team',
      projectId: 'mock-project'
    }));
  });

  it('should list created snapshots', async () => {
    if (!provider.snapshot) {
      throw new Error('Snapshot manager not initialized');
    }

    const snapshots = await provider.snapshot.list();
    expect(VercelSnapshot.list).toHaveBeenCalledWith(expect.objectContaining({ token: 'mock-token', projectId: 'mock-project' }));
    expect(snapshots.map((s: any) => s.id)).toEqual(['snap-1']);
  });

  it('declares rootfs snapshots that stop the source', () => {
    expect(provider.snapshot?.capabilities).toEqual({ scope: 'rootfs', memory: false, destroysSource: true, source: 'stopped' });
  });

  it('pauses by stopping a persistent sandbox and resumes with a fresh handle', async () => {
    expect(provider.sandbox.pause).toEqual({ memory: false, createOptions: { persistent: true } });
    const sandbox = await provider.sandbox.create({ persistent: true } as any);
    const created = await (VercelSandbox.create as any).mock.results[0].value;
    await sandbox.pause!();
    expect(created.stop).toHaveBeenCalled();
    await sandbox.resume!();
    expect(VercelSandbox.get).toHaveBeenCalledWith(expect.objectContaining({
      name: 'mock-sandbox-id', resume: true, token: 'mock-token', projectId: 'mock-project',
    }));
    expect((sandbox.getInstance() as any).name).toBe('resumed');
  });

  it('refuses to pause a non-persistent sandbox', async () => {
    (VercelSandbox.create as any).mockResolvedValueOnce({ name: 'eph', persistent: false, stop: vi.fn() });
    const sandbox = await provider.sandbox.create();
    await expect(sandbox.pause!()).rejects.toThrow(/persistent/);
  });

  it('destroy deletes the sandbox and only its automatic snapshots', async () => {
    await provider.sandbox.destroy('sandbox-123');
    const fetched = await (VercelSandbox.get as any).mock.results[0].value;
    expect(fetched.stop).toHaveBeenCalled();
    expect(fetched.delete).toHaveBeenCalled();
    expect(VercelSnapshot.get).toHaveBeenCalledTimes(1);
    expect(VercelSnapshot.get).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: 'snap-auto' }));
  });
});
