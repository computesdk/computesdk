import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsupportedOperationError } from '@computesdk/provider';

const native = vi.hoisted(() => ({
  connect: vi.fn(),
  create: vi.fn(),
  snapshot: vi.fn(),
  listSnapshots: vi.fn(),
  deleteSnapshot: vi.fn(),
  createTemplate: vi.fn(),
  waitUntilReady: vi.fn(),
  listTemplates: vi.fn(),
  deleteTemplate: vi.fn(),
}));

vi.mock('@superserve/sdk', () => ({
  AuthenticationError: class extends Error {},
  Sandbox: { connect: native.connect, create: native.create },
  Snapshot: { list: native.listSnapshots, deleteById: native.deleteSnapshot },
  Template: {
    create: native.createTemplate,
    list: native.listTemplates,
    deleteById: native.deleteTemplate,
  },
}));

import { superserve, type SuperserveTemplateCreateOptions } from '../index';

const config = { apiKey: 'test', baseUrl: 'https://superserve.example.invalid' };
const snapshotInfo = {
  id: 'snap-1',
  name: 'checkpoint',
  sandboxId: 'sb-source',
  status: 'ready',
  sizeBytes: 1024,
  createdAt: new Date(0),
};
const snapshot = {
  id: 'snap-1',
  provider: 'superserve',
  createdAt: new Date(0),
  metadata: { name: 'checkpoint', sandboxId: 'sb-source', status: 'ready', sizeBytes: 1024 },
};
const templateInfo = { id: 'tpl-1', name: 'node', status: 'ready', createdAt: new Date(0) };

describe('Superserve snapshot scope and native operations', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network call'); }));
    native.connect.mockResolvedValue({ id: 'sb-source', snapshot: native.snapshot });
    native.create.mockResolvedValue({ id: 'sb-restored' });
    native.snapshot.mockResolvedValue(snapshotInfo);
    native.listSnapshots.mockResolvedValue([snapshotInfo]);
    native.createTemplate.mockResolvedValue({ waitUntilReady: native.waitUntilReady });
    native.waitUntilReady.mockResolvedValue(templateInfo);
    native.listTemplates.mockResolvedValue([templateInfo]);
  });

  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('advertises supported operations and instance-scoped listing', () => {
    const provider = superserve(config);

    expect(provider.snapshot!.listScope).toBe('instance');
    expect(provider.snapshot!.operations).toEqual({ create: true, list: true, delete: true });
    expect(provider.snapshot!.capabilities).toEqual({ scope: 'rootfs', memory: true, destroysSource: false });
    expect(provider.template!.operations).toEqual({ create: true, list: true, delete: true });
  });

  it.each([undefined, {}, { limit: 3 }, { instanceId: '' }, { sandboxId: '' }])(
    'rejects an unscoped snapshot list (%j) before any native hook', async (options) => {
      const provider = superserve({});
      const result = provider.snapshot!.list(options);

      await expect(result).rejects.toBeInstanceOf(UnsupportedOperationError);
      await expect(result).rejects.toMatchObject({
        code: 'unsupported', provider: 'superserve', operation: 'snapshot.list without instanceId',
      });
      for (const hook of Object.values(native)) expect(hook).not.toHaveBeenCalled();
    },
  );

  it.each([{ instanceId: 'sb-source', limit: 3 }, { sandboxId: 'sb-source', limit: 3 }])(
    'lists snapshots with canonical or legacy scope (%j) and forwards the limit', async (options) => {
      const provider = superserve(config);

      await expect(provider.snapshot!.list(options)).resolves.toEqual([snapshot]);
      expect(native.listSnapshots.mock.calls).toEqual([['sb-source', { ...config, limit: 3 }]]);
      expect(native.connect).not.toHaveBeenCalled();
    },
  );

  it('prefers the canonical instanceId when a legacy sandboxId is also supplied', async () => {
    const provider = superserve(config);

    await provider.snapshot!.list({ instanceId: 'sb-source', sandboxId: 'sb-legacy' });

    expect(native.listSnapshots.mock.calls).toEqual([['sb-source', { ...config, limit: undefined }]]);
  });

  it('returns a native empty scoped result without inventing snapshots', async () => {
    native.listSnapshots.mockResolvedValue([]);

    await expect(superserve(config).snapshot!.list({ instanceId: 'sb-source' })).resolves.toEqual([]);
    expect(native.listSnapshots).toHaveBeenCalledTimes(1);
  });

  it('preserves native scoped-list failures instead of returning an empty result', async () => {
    const failure = new Error('native listing failed');
    native.listSnapshots.mockRejectedValue(failure);

    await expect(superserve(config).snapshot!.list({ instanceId: 'sb-source' })).rejects.toBe(failure);
  });

  it('creates snapshots using the connected source and retains snapshot metadata', async () => {
    await expect(superserve(config).snapshot!.create('sb-source', { name: 'checkpoint' })).resolves.toEqual(snapshot);

    expect(native.connect.mock.calls).toEqual([['sb-source', config]]);
    expect(native.snapshot.mock.calls).toEqual([[{ name: 'checkpoint' }]]);
  });

  it('deletes snapshots through the native SDK', async () => {
    await expect(superserve(config).snapshot!.delete('snap-1')).resolves.toBeUndefined();

    expect(native.deleteSnapshot.mock.calls).toEqual([['snap-1', config]]);
  });

  it('preserves native snapshot deletion failures', async () => {
    const failure = new Error('native deletion failed');
    native.deleteSnapshot.mockRejectedValue(failure);

    await expect(superserve(config).snapshot!.delete('snap-1')).rejects.toBe(failure);
  });

  it('restores a snapshot by forwarding fromSnapshot to native sandbox creation', async () => {
    const restored = await superserve(config).instances.create({ snapshotId: 'snap-1', name: 'restored' });

    expect(restored.instanceId).toBe('sb-restored');
    expect(native.create.mock.calls).toEqual([[{ ...config, name: 'restored', fromSnapshot: 'snap-1' }]]);
  });

  it('keeps native template creation, listing and deletion available', async () => {
    const provider = superserve(config);
    const options: SuperserveTemplateCreateOptions = { name: 'node', from: 'node:22' };

    await expect(provider.template!.create(options)).resolves.toMatchObject({ id: 'tpl-1', name: 'node' });
    expect(native.createTemplate).toHaveBeenCalledWith(expect.objectContaining({ ...config, name: 'node', from: 'node:22' }));
    expect(native.waitUntilReady).toHaveBeenCalledTimes(1);
    await expect(provider.template!.list()).resolves.toMatchObject([{ id: 'tpl-1', name: 'node' }]);
    expect(native.listTemplates.mock.calls).toEqual([[config]]);
    await expect(provider.template!.delete('tpl-1')).resolves.toBeUndefined();
    expect(native.deleteTemplate.mock.calls).toEqual([['tpl-1', config]]);
  });
});
