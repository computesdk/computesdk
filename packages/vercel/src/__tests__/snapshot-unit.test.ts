import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vercel } from '../index';
import { Sandbox as VercelSandbox, Snapshot as VercelSnapshot } from '@vercel/sandbox';

const mocks = vi.hoisted(() => ({
  snapshotInstance: {
    delete: vi.fn().mockResolvedValue(undefined),
  },
  sandboxInstance: {
    name: 'mock-sandbox-name',
    status: 'running',
    snapshot: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  },
  listPaginator: {
    toArray: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@vercel/sandbox', () => ({
  Sandbox: {
    create: vi.fn().mockResolvedValue(mocks.sandboxInstance),
    get: vi.fn().mockResolvedValue(mocks.sandboxInstance),
    list: vi.fn().mockResolvedValue(mocks.listPaginator),
  },
  Snapshot: {
    get: vi.fn().mockResolvedValue(mocks.snapshotInstance),
    list: vi.fn().mockResolvedValue(mocks.listPaginator),
  },
  APIError: class extends Error {
    response: { status: number };
    constructor(response: { status: number }, message = 'API error') {
      super(message);
      this.response = response;
    }
  },
}));

describe('Vercel Snapshot Support', () => {
  const provider = vercel({ vcpus: 1 });

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
      resume: false,
    }));

    expect(mocks.sandboxInstance.snapshot).toHaveBeenCalled();
  });

  it('should delete a snapshot', async () => {
    if (!provider.snapshot) {
      throw new Error('Snapshot manager not initialized');
    }

    await provider.snapshot.delete('snapshot-123');

    expect(VercelSnapshot.get).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: 'snapshot-123',
    }));

    expect(mocks.snapshotInstance.delete).toHaveBeenCalled();
  });

  it('should create a sandbox from a snapshot', async () => {
    await provider.sandbox.create({ snapshotId: 'snap-123' });

    expect(VercelSandbox.create).toHaveBeenCalledWith(expect.objectContaining({
      source: {
        type: 'snapshot',
        snapshotId: 'snap-123',
      },
    }));
  });

  it('should create a sandbox from a snapshot using nested source format', async () => {
    await provider.sandbox.create({
      source: {
        type: 'snapshot',
        snapshotId: 'snap-456',
      },
    } as any);

    expect(VercelSandbox.create).toHaveBeenCalledWith(expect.objectContaining({
      source: {
        type: 'snapshot',
        snapshotId: 'snap-456',
      },
    }));
  });

  it('should list snapshots', async () => {
    if (!provider.snapshot) {
      throw new Error('Snapshot manager not initialized');
    }

    const list = await provider.snapshot.list();

    expect(VercelSnapshot.list).toHaveBeenCalled();
    expect(list).toEqual([]);
  });
});
