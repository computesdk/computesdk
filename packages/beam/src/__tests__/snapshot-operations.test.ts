import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { UnsupportedOperationError } from '@computesdk/provider';
import { beam } from '../index';

const native = vi.hoisted(() => ({
  connect: vi.fn(),
  snapshot: vi.fn(),
  restore: vi.fn(),
  request: vi.fn(),
  construct: vi.fn(),
  fromRegistry: vi.fn(),
  volume: vi.fn(),
}));

vi.mock('@beamcloud/beam-js', () => ({
  default: { request: native.request },
  Sandbox: Object.assign(native.construct, {
    connect: native.connect,
    createFromSnapshot: native.restore,
  }),
  Image: { fromRegistry: native.fromRegistry },
  Volume: native.volume,
  beamOpts: { token: '', workspaceId: '', gatewayUrl: '', timeout: 30000 },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('BEAM_TOKEN', '');
  vi.stubEnv('BEAM_WORKSPACE_ID', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  expect(native.request).not.toHaveBeenCalled();
  expect(native.construct).not.toHaveBeenCalled();
  expect(native.fromRegistry).not.toHaveBeenCalled();
  expect(native.volume).not.toHaveBeenCalled();
});

describe('Beam snapshot operations', () => {
  const config = { token: 'mock-token', workspaceId: 'mock-workspace' };

  test('advertises only native snapshot creation and preserves capabilities', () => {
    const provider = beam({});

    expect(provider.snapshot).toBeDefined();
    expect(provider.snapshot!.operations).toEqual({ create: true, list: false, delete: false });
    expect(provider.snapshot!.capabilities).toEqual({
      scope: 'rootfs', path: '/root', memory: true, destroysSource: false,
    });
    expect(provider.template).toBeUndefined();
  });

  test.each([
    undefined,
    { instanceId: 'source', limit: 2 },
    { sandboxId: 'source', limit: 2 },
  ])('rejects unsupported snapshot listing without native calls (%j)', async (options) => {
    const result = beam({}).snapshot!.list(options);

    await expect(result).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(result).rejects.toMatchObject({
      name: 'UnsupportedOperationError', code: 'unsupported', provider: 'beam', operation: 'snapshot.list',
    });
    expect(native.connect).not.toHaveBeenCalled();
    expect(native.snapshot).not.toHaveBeenCalled();
    expect(native.restore).not.toHaveBeenCalled();
  });

  test('rejects unsupported snapshot deletion without native calls', async () => {
    const result = beam({}).snapshot!.delete('checkpoint-1');

    await expect(result).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(result).rejects.toMatchObject({
      name: 'UnsupportedOperationError', code: 'unsupported', provider: 'beam', operation: 'snapshot.delete',
    });
    expect(native.connect).not.toHaveBeenCalled();
    expect(native.snapshot).not.toHaveBeenCalled();
    expect(native.restore).not.toHaveBeenCalled();
  });

  test('creates a native checkpoint with source identity and metadata', async () => {
    native.connect.mockResolvedValue({ snapshot: native.snapshot });
    native.snapshot.mockResolvedValue('checkpoint-1');

    const result = await beam(config).snapshot!.create('source', {
      name: 'saved-state', metadata: { purpose: 'regression', name: 'old-name' },
    });

    expect(native.connect.mock.calls).toEqual([['source']]);
    expect(native.snapshot.mock.calls).toEqual([[]]);
    expect(result).toEqual({
      id: 'checkpoint-1', provider: 'beam', instanceId: 'source', createdAt: expect.any(Date),
      metadata: { purpose: 'regression', name: 'saved-state' },
    });
    expect(native.restore).not.toHaveBeenCalled();
  });

  test('restores a checkpoint through the native snapshot API, not an image', async () => {
    const instance = { containerId: 'restored-1' };
    native.restore.mockResolvedValue(instance);

    const restored = await beam(config).sandbox.create({ snapshotId: 'checkpoint-1' });

    expect(native.restore.mock.calls).toEqual([['checkpoint-1']]);
    expect(restored.sandboxId).toBe('restored-1');
    expect(restored.getInstance()).toBe(instance);
    expect(native.connect).not.toHaveBeenCalled();
    expect(native.snapshot).not.toHaveBeenCalled();
  });

  test('preserves native snapshot creation failures', async () => {
    native.connect.mockResolvedValue({ snapshot: native.snapshot });
    native.snapshot.mockRejectedValue(new Error('checkpoint failed'));

    await expect(beam(config).snapshot!.create('source')).rejects.toThrow(
      'Failed to create Beam snapshot: checkpoint failed',
    );
  });

  test('preserves native connection failures during snapshot creation', async () => {
    native.connect.mockRejectedValue(new Error('source unavailable'));

    await expect(beam(config).snapshot!.create('source')).rejects.toThrow(
      'Failed to create Beam snapshot: source unavailable',
    );
    expect(native.snapshot).not.toHaveBeenCalled();
  });

  test('preserves native snapshot restoration failures', async () => {
    native.restore.mockRejectedValue(new Error('checkpoint unavailable'));

    await expect(beam(config).sandbox.create({ snapshotId: 'checkpoint-1' })).rejects.toThrow(
      'Failed to create Beam sandbox: checkpoint unavailable',
    );
    expect(native.connect).not.toHaveBeenCalled();
    expect(native.snapshot).not.toHaveBeenCalled();
  });
});
