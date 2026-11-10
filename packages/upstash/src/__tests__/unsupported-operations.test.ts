import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsupportedOperationError } from '@computesdk/provider';
import { upstash } from '../index';

const native = vi.hoisted(() => ({
  Box: {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn(),
    fromSnapshot: vi.fn(),
    deleteSnapshots: vi.fn(),
  },
  EphemeralBox: {
    create: vi.fn(),
    fromSnapshot: vi.fn(),
  },
}));

vi.mock('@upstash/box', () => native);

const apiKey = 'mock-upstash-key';

describe('Upstash snapshot and template operations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('Network access is forbidden in keyless unit tests');
    }));
    vi.stubEnv('UPSTASH_BOX_API_KEY', '');
  });

  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('omits the unsupported template manager and advertises only real snapshot operations', () => {
    const provider = upstash({ apiKey });

    expect(provider.template).toBeUndefined();
    expect(provider.snapshot?.operations).toEqual({ create: true, list: false, delete: true });
    expect(provider.snapshot?.capabilities).toEqual({
      scope: 'rootfs',
      memory: false,
      destroysSource: false,
    });
  });

  it.each([
    undefined,
    { instanceId: 'source-box', limit: 3 },
    { sandboxId: 'legacy-box', limit: 2 },
  ])('rejects unsupported snapshot listing without contacting the native SDK (%j)', async (options) => {
    const provider = upstash({ apiKey });
    const listing = provider.snapshot!.list(options);

    await expect(listing).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(listing).rejects.toMatchObject({
      name: 'UnsupportedOperationError',
      code: 'unsupported',
      provider: 'upstash',
      operation: 'snapshot.list',
    });
    for (const method of [...Object.values(native.Box), ...Object.values(native.EphemeralBox)]) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('preserves native snapshot creation and returned metadata', async () => {
    const snapshot = vi.fn().mockResolvedValue({
      id: 'snapshot-1',
      created_at: 1700000000,
      name: 'checkpoint',
      box_id: 'source-box',
      size_bytes: 1024,
      status: 'ready',
    });
    native.Box.get.mockResolvedValue({ id: 'source-box', snapshot });
    const provider = upstash({ apiKey });

    await expect(provider.snapshot!.create('source-box', { name: 'checkpoint' })).resolves.toEqual({
      id: 'snapshot-1',
      provider: 'upstash',
      createdAt: new Date(1700000000 * 1000),
      metadata: { name: 'checkpoint', boxId: 'source-box', sizeBytes: 1024, status: 'ready' },
    });
    expect(native.Box.get).toHaveBeenCalledWith('source-box', { apiKey });
    expect(snapshot).toHaveBeenCalledWith({ name: 'checkpoint' });
  });

  it('preserves snapshot creation failures instead of returning fake success', async () => {
    const snapshot = vi.fn().mockRejectedValue(new Error('native snapshot failed'));
    native.Box.get.mockResolvedValue({ id: 'source-box', snapshot });

    await expect(upstash({ apiKey }).snapshot!.create('source-box')).rejects.toThrow(
      'Failed to create Upstash snapshot: native snapshot failed'
    );
    expect(snapshot).toHaveBeenCalledOnce();
  });

  it('preserves native snapshot deletion', async () => {
    native.Box.deleteSnapshots.mockResolvedValue({ failed: 0 });

    await expect(upstash({ apiKey }).snapshot!.delete('snapshot-1')).resolves.toBeUndefined();
    expect(native.Box.deleteSnapshots).toHaveBeenCalledWith({ apiKey, snapshotIds: ['snapshot-1'] });
  });

  it('rejects native snapshot deletion failures', async () => {
    const provider = upstash({ apiKey });
    native.Box.deleteSnapshots.mockResolvedValueOnce({ failed: 1 });
    await expect(provider.snapshot!.delete('snapshot-1')).rejects.toThrow(
      'Failed to delete Upstash snapshot snapshot-1'
    );

    const failure = new Error('native deletion failed');
    native.Box.deleteSnapshots.mockRejectedValueOnce(failure);
    await expect(provider.snapshot!.delete('snapshot-1')).rejects.toBe(failure);
  });

  it('preserves restoring a full box from a snapshot', async () => {
    const box = { id: 'restored-box' };
    native.Box.fromSnapshot.mockResolvedValue(box);
    const provider = upstash({ apiKey });

    const restored = await provider.instances.create({
      snapshotId: 'snapshot-1',
      ephemeral: false,
      timeout: 120000,
      envs: { MODE: 'test' },
    });

    expect(native.Box.fromSnapshot).toHaveBeenCalledWith('snapshot-1', {
      apiKey,
      runtime: 'node',
      timeout: 120000,
      env: { MODE: 'test' },
    });
    expect(restored.instanceId).toBe('restored-box');
    expect(restored.getInstance()).toBe(box);
    expect(native.Box.create).not.toHaveBeenCalled();
    expect(native.EphemeralBox.fromSnapshot).not.toHaveBeenCalled();
  });

  it('preserves restoring an ephemeral box from a snapshot', async () => {
    const box = { id: 'restored-ephemeral', expiresAt: 1700000000 };
    native.EphemeralBox.fromSnapshot.mockResolvedValue(box);
    const provider = upstash({ apiKey, runtime: 'python', timeout: 90000 });

    const restored = await provider.instances.create({
      snapshotId: 'snapshot-1',
      ephemeral: true,
      envs: { MODE: 'test' },
    });

    expect(native.EphemeralBox.fromSnapshot).toHaveBeenCalledWith('snapshot-1', {
      apiKey,
      runtime: 'python',
      timeout: 90000,
      ttl: undefined,
      size: undefined,
      env: { MODE: 'test' },
    });
    expect(restored.getInstance()).toBe(box);
    expect(native.Box.fromSnapshot).not.toHaveBeenCalled();
    expect(native.EphemeralBox.create).not.toHaveBeenCalled();
  });
});
