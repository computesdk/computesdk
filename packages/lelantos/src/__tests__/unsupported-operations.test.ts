import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnsupportedOperationError } from '@computesdk/provider';

const native = vi.hoisted(() => ({
  create: vi.fn(),
  connect: vi.fn(),
  createSnapshot: vi.fn(),
  listTemplates: vi.fn(),
  deleteTemplate: vi.fn(),
  probe: vi.fn(),
}));

vi.mock('e2b', () => ({
  CommandExitError: class extends Error {},
  Sandbox: {
    create: native.create,
    connect: native.connect,
    get listTemplates() {
      native.probe('listTemplates');
      return native.listTemplates;
    },
    get deleteTemplate() {
      native.probe('deleteTemplate');
      return native.deleteTemplate;
    },
  },
}));

import { lelantos } from '../index';

const config = {
  apiKey: 'lel_deadbeef',
  domain: 'lelantos.test',
  apiUrl: 'https://api.lelantos.test',
};
const connection = { ...config, apiKey: 'e2b_deadbeef' };

describe('Lelantos snapshot and template operation support', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const key of [
      'LELANTOS_API_KEY', 'E2B_API_KEY', 'LELANTOS_DOMAIN',
      'E2B_DOMAIN', 'LELANTOS_API_URL', 'E2B_API_URL',
    ]) {
      vi.stubEnv(key, '');
    }
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('Network access is forbidden in mock tests');
    }));
    native.connect.mockResolvedValue({ createSnapshot: native.createSnapshot });
    native.create.mockResolvedValue({ sandboxId: 'restored-sandbox' });
    native.createSnapshot.mockResolvedValue('snapshot-1');
    native.listTemplates.mockResolvedValue([]);
    native.deleteTemplate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('advertises only supported snapshot creation and omits the unsupported template manager', () => {
    const provider = lelantos(config);
    expect(provider.snapshot?.operations).toEqual({ create: true, list: false, delete: false });
    expect(provider.template).toBeUndefined();
    expect(native.probe).not.toHaveBeenCalled();
  });

  it.each([
    { scope: 'unscoped', options: undefined },
    { scope: 'instanceId', options: { instanceId: 'source', limit: 3 } },
    { scope: 'legacy sandboxId', options: { sandboxId: 'source', limit: 3 } },
  ])('rejects $scope snapshot listing without probing the SDK', async ({ options }) => {
    const provider = lelantos(config);
    const result = provider.snapshot!.list(options);
    await expect(result).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(result).rejects.toMatchObject({
      code: 'unsupported', provider: 'lelantos', operation: 'snapshot.list',
    });
    for (const mock of Object.values(native)) expect(mock).not.toHaveBeenCalled();
  });

  it('rejects snapshot deletion instead of silently succeeding', async () => {
    const provider = lelantos(config);
    const result = provider.snapshot!.delete('snapshot-1');
    await expect(result).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(result).rejects.toMatchObject({
      code: 'unsupported', provider: 'lelantos', operation: 'snapshot.delete',
    });
    for (const mock of Object.values(native)) expect(mock).not.toHaveBeenCalled();
  });

  it.each([
    'snapshot-1',
    { snapshotId: 'snapshot-1' },
    { id: 'snapshot-1' },
    { templateId: 'snapshot-1' },
  ])('preserves snapshot creation for native result %j', async (result) => {
    native.createSnapshot.mockResolvedValue(result);
    const provider = lelantos(config);
    await expect(provider.snapshot!.create('source', { name: 'saved' })).resolves.toEqual({
      id: 'snapshot-1', provider: 'lelantos', createdAt: expect.any(Date), metadata: { name: 'saved' },
    });
    expect(native.connect).toHaveBeenCalledTimes(1);
    expect(native.connect).toHaveBeenCalledWith('source', connection);
    expect(native.createSnapshot).toHaveBeenCalledTimes(1);
    expect(native.createSnapshot).toHaveBeenCalledWith({ name: 'saved' });
    expect(native.probe).not.toHaveBeenCalled();
  });

  it('still rejects a snapshot result without an ID', async () => {
    native.createSnapshot.mockResolvedValue({});
    const provider = lelantos(config);
    await expect(provider.snapshot!.create('source')).rejects.toThrow('returned no snapshot ID');
  });

  it('still surfaces native snapshot creation errors', async () => {
    native.createSnapshot.mockRejectedValue(new Error('snapshot failed'));
    const provider = lelantos(config);
    await expect(provider.snapshot!.create('source')).rejects.toThrow(
      'Failed to create Lelantos snapshot: snapshot failed'
    );
  });

  it('restores a created snapshot through the existing sandbox create path', async () => {
    const provider = lelantos(config);
    const snapshot = await provider.snapshot!.create('source');
    const restored = await provider.sandbox.create({
      snapshotId: snapshot.id, timeout: 120000, envs: { RESTORED: 'yes' },
    });
    expect(restored.instanceId).toBe('restored-sandbox');
    expect(native.create).toHaveBeenCalledTimes(1);
    expect(native.create).toHaveBeenCalledWith('snapshot-1', {
      ...connection, timeoutMs: 120000, envs: { RESTORED: 'yes' }, metadata: undefined,
    });
    expect(native.probe).not.toHaveBeenCalled();
  });

  it('preserves creation from an existing template ID without a template manager', async () => {
    const provider = lelantos(config);
    const sandbox = await provider.sandbox.create({ templateId: 'existing-template' });
    expect(sandbox.instanceId).toBe('restored-sandbox');
    expect(native.create).toHaveBeenCalledTimes(1);
    expect(native.create).toHaveBeenCalledWith('existing-template', {
      ...connection, timeoutMs: 300000, envs: undefined, metadata: undefined,
    });
    expect(provider.template).toBeUndefined();
  });
});
