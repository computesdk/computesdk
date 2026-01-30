
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vercel } from '../index';
import { Sandbox as VercelSandbox, Snapshot as VercelSnapshot } from '@vercel/sandbox';

// Mock @vercel/sandbox
vi.mock('@vercel/sandbox', () => {
  const mockSnapshotInstance = {
    delete: vi.fn().mockResolvedValue(undefined),
  };

  const mockSandboxInstance = {
    sandboxId: 'mock-sandbox-id',
    snapshot: vi.fn().mockResolvedValue(mockSnapshotInstance),
    stop: vi.fn().mockResolvedValue(undefined),
  };

  return {
    Sandbox: {
      create: vi.fn().mockResolvedValue(mockSandboxInstance),
      get: vi.fn().mockResolvedValue(mockSandboxInstance),
    },
    Snapshot: {
      get: vi.fn().mockResolvedValue(mockSnapshotInstance),
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
      sandboxId: 'sandbox-123',
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

  it('should throw when listing snapshots', async () => {
    if (!provider.snapshot) {
      throw new Error('Snapshot manager not initialized');
    }

    await expect(provider.snapshot.list()).rejects.toThrow('Vercel provider does not support listing snapshots');
  });
});
