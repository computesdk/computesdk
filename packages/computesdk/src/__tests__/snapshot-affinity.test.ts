import { describe, expect, it, vi } from 'vitest';
import { compute, type CreateInstanceOptions, type DirectProvider } from '../compute';
import type { Instance } from '../types/universal-instance';
import { getInstanceSizeProfile, type InstanceSizeClass } from '../sizes';

// Core routing doubles only: these tests do not exercise native provider APIs.
function makeProvider(name: string, snapshotId = `${name}-snapshot`) {
  const instance = { instanceId: `${name}-instance`, provider: 'native-instance-label' } as Instance;
  const record = { id: snapshotId, provider: 'native-snapshot-label' };
  const create = vi.fn(async (_options?: CreateInstanceOptions) => instance);
  const getById = vi.fn(async (_id: string): Promise<Instance | null> => instance);
  const listInstances = vi.fn(async () => [instance]);
  const createSnapshot = vi.fn(async (_id: string, _options?: { name?: string; metadata?: Record<string, any> }) => ({
    ...record,
    createdAt: '2026-01-02T03:04:05.000Z',
  }));
  const listSnapshots = vi.fn(async () => [record]);
  const remove = vi.fn(async (_id: string) => {});
  const provider: DirectProvider = {
    name,
    instances: { create, getById, list: listInstances, destroy: vi.fn(async () => {}) },
    snapshot: { create: createSnapshot, list: listSnapshots, delete: remove },
  };
  return { provider, instance, record, create, getById, listInstances, createSnapshot, listSnapshots, remove };
}

describe('compute snapshot affinity (core unit)', () => {
  it('checks standard sizing on the known snapshot owner without rerouting or fallback', async () => {
    const first = makeProvider('first');
    const owner = makeProvider('owner');
    const sizedFirst: DirectProvider = {
      ...first.provider,
      sizes: {
        contract: 'computesdk.instance-sizes.v1',
        list: () => [],
        resolve: (sizeClass: InstanceSizeClass) => ({
          status: 'supported', requested: getInstanceSizeProfile(sizeClass), provenance: 'adapter-declared',
          resolved: { vcpus: 1, memoryMiB: 2048 }, nativeOptions: {},
        }),
      },
    };
    const sdk = compute({ providers: [sizedFirst, owner.provider], fallbackOnError: true });
    await sdk.snapshot.list();

    await expect(sdk.instances.create({ snapshotId: owner.record.id, sizeClass: 'sm' }))
      .rejects.toMatchObject({ code: 'unknown', fallback: false });
    expect(first.create).not.toHaveBeenCalled();
    expect(owner.create).not.toHaveBeenCalled();
  });

  it.each(['priority', 'round-robin'] as const)(
    'restores a listed snapshot only on its actual provider under %s routing',
    async providerStrategy => {
      const first = makeProvider('first');
      const owner = makeProvider('owner');
      const sdk = compute({ providers: [first.provider, owner.provider], providerStrategy, fallbackOnError: true });
      await sdk.snapshot.list();

      const restored = await sdk.instances.create({ snapshotId: owner.record.id, metadata: { kept: true } });

      expect(restored).toBe(owner.instance);
      expect(owner.create).toHaveBeenCalledWith({ snapshotId: owner.record.id, metadata: { kept: true } });
      expect(first.create).not.toHaveBeenCalled();
    },
  );

  it('learns restore affinity from snapshot.create, ignoring returned provider labels', async () => {
    const first = makeProvider('first');
    const owner = makeProvider('owner');
    const sdk = compute({ providers: [first.provider, owner.provider] });
    const snapshot = await sdk.snapshot.create('unknown-instance', { provider: 'owner', name: 'checkpoint' });

    await sdk.instances.create({ snapshotId: snapshot.id, provider: 'owner' });

    expect(owner.createSnapshot).toHaveBeenCalledWith('unknown-instance', { name: 'checkpoint' });
    expect(owner.create).toHaveBeenCalledWith({ snapshotId: snapshot.id });
    expect(first.create).not.toHaveBeenCalled();
  });

  it('does not advance round-robin new-instance selection for a known snapshot restore', async () => {
    const first = makeProvider('first');
    const owner = makeProvider('owner');
    const sdk = compute({ providers: [first.provider, owner.provider], providerStrategy: 'round-robin' });
    await sdk.snapshot.list();
    await sdk.instances.create({ snapshotId: owner.record.id });
    expect(await sdk.instances.create()).toBe(first.instance);
    expect(await sdk.instances.create()).toBe(owner.instance);
  });

  it('rejects an incompatible restore override before any provider create', async () => {
    const first = makeProvider('first');
    const owner = makeProvider('owner');
    const sdk = compute({ providers: [first.provider, owner.provider] });
    await sdk.snapshot.list();

    await expect(sdk.instances.create({ snapshotId: owner.record.id, provider: 'first' }))
      .rejects.toThrow(/snapshot.*provider|provider.*snapshot/i);
    expect(first.create).not.toHaveBeenCalled();
    expect(owner.create).not.toHaveBeenCalled();
  });

  it.each(['priority', 'round-robin'] as const)(
    'never falls back after a known snapshot owner restore failure under %s routing',
    async providerStrategy => {
      const first = makeProvider('first');
      const owner = makeProvider('owner');
      const failure = new Error('owner account denied');
      owner.create.mockRejectedValue(failure);
      const sdk = compute({ providers: [first.provider, owner.provider], providerStrategy, fallbackOnError: true });
      await sdk.snapshot.list();

      await expect(sdk.instances.create({ snapshotId: owner.record.id })).rejects.toBe(failure);
      await expect(sdk.instances.create({ snapshotId: owner.record.id })).rejects.toBe(failure);
      expect(owner.create).toHaveBeenCalledTimes(2);
      expect(first.create).not.toHaveBeenCalled();
    },
  );

  it('keeps known delete affinity after failure and releases it only after success', async () => {
    const first = makeProvider('first');
    const owner = makeProvider('owner');
    owner.remove.mockRejectedValueOnce(new Error('owner delete denied'));
    const sdk = compute({ providers: [first.provider, owner.provider], fallbackOnError: true });
    await sdk.snapshot.list();

    await expect(sdk.snapshot.delete(owner.record.id)).rejects.toThrow('owner delete denied');
    expect(first.remove).not.toHaveBeenCalled();
    await sdk.snapshot.delete(owner.record.id);
    expect(owner.remove).toHaveBeenCalledTimes(2);
    expect(first.remove).not.toHaveBeenCalled();
    // Successful deletion forgets ownership; an unknown ID retains legacy discovery.
    await sdk.snapshot.delete(owner.record.id);
    expect(first.remove).toHaveBeenCalledWith(owner.record.id);
  });

  it.each([
    ['structured failure', { code: 'SNAPSHOT_DENIED', fallback: false }],
    ['abort', { name: 'AbortError', code: 'ABORTED' }],
  ] as const)('preserves the original known-owner restore %s', async (_label, details) => {
    const first = makeProvider('first');
    const owner = makeProvider('owner');
    const failure = Object.assign(new Error('owner restore failure'), details);
    owner.create.mockRejectedValue(failure);
    const sdk = compute({ providers: [first.provider, owner.provider], fallbackOnError: true });
    await sdk.snapshot.list();

    await expect(sdk.instances.create({ snapshotId: owner.record.id })).rejects.toBe(failure);
    expect(owner.create).toHaveBeenCalledOnce();
    expect(first.create).not.toHaveBeenCalled();
  });

  it.each([
    ['structured failure', { code: 'SNAPSHOT_DENIED', fallback: false }],
    ['abort', { name: 'AbortError', code: 'ABORTED' }],
  ] as const)('preserves the original known-owner snapshot.create %s', async (_label, details) => {
    const first = makeProvider('first');
    const owner = makeProvider('owner');
    const failure = Object.assign(new Error('owner snapshot failure'), details);
    owner.createSnapshot.mockRejectedValue(failure);
    const sdk = compute({ providers: [first.provider, owner.provider], fallbackOnError: true });
    await sdk.instances.create({ provider: 'owner' });

    await expect(sdk.snapshot.create(owner.instance.instanceId)).rejects.toBe(failure);
    expect(owner.createSnapshot).toHaveBeenCalledOnce();
    expect(first.createSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ['structured failure', { code: 'SNAPSHOT_DENIED', fallback: false }],
    ['abort', { name: 'AbortError', code: 'ABORTED' }],
  ] as const)('preserves the original known-owner snapshot.delete %s and affinity', async (_label, details) => {
    const first = makeProvider('first');
    const owner = makeProvider('owner');
    const failure = Object.assign(new Error('owner delete failure'), details);
    owner.remove.mockRejectedValue(failure);
    const sdk = compute({ providers: [first.provider, owner.provider], fallbackOnError: true });
    await sdk.snapshot.list();

    await expect(sdk.snapshot.delete(owner.record.id)).rejects.toBe(failure);
    await expect(sdk.snapshot.delete(owner.record.id)).rejects.toBe(failure);
    expect(owner.remove).toHaveBeenCalledTimes(2);
    expect(first.remove).not.toHaveBeenCalled();
    // Failed deletion must also preserve routing for subsequent restores.
    expect(await sdk.instances.create({ snapshotId: owner.record.id })).toBe(owner.instance);
    expect(first.create).not.toHaveBeenCalled();
  });

  it.each(['create', 'getById', 'list'] as const)(
    'pins snapshot creation to an instance owner learned through instances.%s',
    async operation => {
      const owner = makeProvider('owner');
      const other = makeProvider('other');
      const sdk = compute({ providers: [owner.provider, other.provider] });
      if (operation === 'create') await sdk.instances.create();
      if (operation === 'getById') await sdk.instances.getById(owner.instance.instanceId);
      if (operation === 'list') await sdk.instances.list();
      owner.createSnapshot.mockRejectedValue(new Error('owner snapshot denied'));

      await expect(sdk.snapshot.create(owner.instance.instanceId)).rejects.toThrow('owner snapshot denied');
      expect(owner.createSnapshot).toHaveBeenCalledOnce();
      expect(other.createSnapshot).not.toHaveBeenCalled();
    },
  );

  it('rejects a different provider override for a known instance before snapshot I/O', async () => {
    const owner = makeProvider('owner');
    const other = makeProvider('other');
    const sdk = compute({ providers: [owner.provider, other.provider] });
    await sdk.instances.create();

    await expect(sdk.snapshot.create(owner.instance.instanceId, { provider: 'other' }))
      .rejects.toThrow(/instance.*provider|provider.*instance/i);
    expect(owner.createSnapshot).not.toHaveBeenCalled();
    expect(other.createSnapshot).not.toHaveBeenCalled();
  });

  it('allows a matching provider override for a known instance and strips routing metadata', async () => {
    const owner = makeProvider('owner');
    const other = makeProvider('other');
    const sdk = compute({ providers: [owner.provider, other.provider] });
    await sdk.instances.create();
    await sdk.snapshot.create(owner.instance.instanceId, { provider: 'owner', name: 'checkpoint' });
    expect(owner.createSnapshot).toHaveBeenCalledWith(owner.instance.instanceId, { name: 'checkpoint' });
    expect(other.createSnapshot).not.toHaveBeenCalled();
  });

  it('does not probe other providers when the known instance owner lacks snapshots', async () => {
    const owner = makeProvider('owner');
    const other = makeProvider('other');
    const providerWithoutSnapshots: DirectProvider = { name: 'owner', instances: owner.provider.instances };
    const sdk = compute({ providers: [providerWithoutSnapshots, other.provider] });
    await sdk.instances.create();

    await expect(sdk.snapshot.create(owner.instance.instanceId)).rejects.toThrow(/snapshots not supported/);
    expect(other.createSnapshot).not.toHaveBeenCalled();
  });

  it.each(['list', 'create', 'create-then-list'] as const)(
    'fails closed for snapshot ID collisions learned through %s',
    async operation => {
      const first = makeProvider('first', 'shared-id');
      const second = makeProvider('second', 'shared-id');
      const sdk = compute({ providers: [first.provider, second.provider] });
      if (operation === 'list') await sdk.snapshot.list();
      if (operation === 'create') {
        await sdk.snapshot.create('unknown-first', { provider: 'first' });
        await sdk.snapshot.create('unknown-second', { provider: 'second' });
      }
      if (operation === 'create-then-list') {
        await sdk.snapshot.create('unknown-first', { provider: 'first' });
        await sdk.snapshot.list();
      }

      await expect(sdk.instances.create({ snapshotId: 'shared-id' })).rejects.toThrow(/ambiguous/i);
      await expect(sdk.snapshot.delete('shared-id')).rejects.toThrow(/ambiguous/i);
      expect(first.create).not.toHaveBeenCalled();
      expect(second.create).not.toHaveBeenCalled();
      expect(first.remove).not.toHaveBeenCalled();
      expect(second.remove).not.toHaveBeenCalled();
    },
  );

  it('resolves ambiguous restore only with an explicit configured owning provider', async () => {
    const first = makeProvider('first', 'shared-id');
    const second = makeProvider('second', 'shared-id');
    const unrelated = makeProvider('unrelated');
    const sdk = compute({ providers: [first.provider, second.provider, unrelated.provider] });
    await sdk.snapshot.list();

    await expect(sdk.instances.create({ snapshotId: 'shared-id', provider: 'missing' }))
      .rejects.toThrow(/not configured/);
    await expect(sdk.instances.create({ snapshotId: 'shared-id', provider: 'unrelated' }))
      .rejects.toThrow(/snapshot.*provider|provider.*snapshot/i);
    expect(await sdk.instances.create({ snapshotId: 'shared-id', provider: 'first' })).toBe(first.instance);
    expect(first.create).toHaveBeenCalledWith({ snapshotId: 'shared-id' });
    expect(second.create).not.toHaveBeenCalled();
    expect(unrelated.create).not.toHaveBeenCalled();
    // Choosing an owner for restore must not erase the collision for raw-ID deletion.
    await expect(sdk.snapshot.delete('shared-id')).rejects.toThrow(/ambiguous/i);
    expect(first.remove).not.toHaveBeenCalled();
    expect(second.remove).not.toHaveBeenCalled();
  });

  it('does not fall back when an explicitly resolved ambiguous restore fails', async () => {
    const first = makeProvider('first', 'shared-id');
    const second = makeProvider('second', 'shared-id');
    const failure = new Error('first account denied');
    first.create.mockRejectedValue(failure);
    const sdk = compute({ providers: [first.provider, second.provider] });
    await sdk.snapshot.list();

    await expect(sdk.instances.create({ snapshotId: 'shared-id', provider: 'first' })).rejects.toBe(failure);
    expect(second.create).not.toHaveBeenCalled();
  });


  it('does not treat repeated observations from the same provider object as a collision', async () => {
    const other = makeProvider('other');
    const owner = makeProvider('owner');
    const sdk = compute({ providers: [other.provider, owner.provider, owner.provider] });
    await sdk.snapshot.create('unknown-instance', { provider: 'owner' });
    await sdk.snapshot.list();
    await sdk.snapshot.list();

    await sdk.instances.create({ snapshotId: owner.record.id });
    await sdk.snapshot.delete(owner.record.id);
    expect(owner.create).toHaveBeenCalledOnce();
    expect(owner.remove).toHaveBeenCalledOnce();
    expect(other.create).not.toHaveBeenCalled();
    expect(other.remove).not.toHaveBeenCalled();
  });

  it('clears snapshot affinity and ambiguity on explicit reconfiguration', async () => {
    const first = makeProvider('first', 'shared-id');
    const second = makeProvider('second', 'shared-id');
    const sdk = compute({ providers: [first.provider, second.provider] });
    await sdk.snapshot.list();
    sdk.setConfig({ provider: second.provider });

    await sdk.instances.create({ snapshotId: 'shared-id' });
    await sdk.snapshot.delete('shared-id');
    expect(second.create).toHaveBeenCalledOnce();
    expect(second.remove).toHaveBeenCalledOnce();
  });

  it('retains discovery fallback for unknown snapshot and instance IDs', async () => {
    const first = makeProvider('first');
    const second = makeProvider('second');
    first.create.mockRejectedValueOnce(new Error('unknown snapshot here'));
    first.createSnapshot.mockRejectedValueOnce(new Error('unknown instance here'));
    first.remove.mockRejectedValueOnce(new Error('unknown snapshot here'));
    const sdk = compute({ providers: [first.provider, second.provider] });

    expect(await sdk.instances.create({ snapshotId: 'unknown-snapshot' })).toBe(second.instance);
    expect(await sdk.snapshot.create('unknown-instance')).toMatchObject({ id: second.record.id });
    await sdk.snapshot.delete('another-unknown-snapshot');
    expect(first.create).toHaveBeenCalledWith({ snapshotId: 'unknown-snapshot' });
    expect(second.create).toHaveBeenCalledWith({ snapshotId: 'unknown-snapshot' });
    expect(first.createSnapshot).toHaveBeenCalledOnce();
    expect(second.createSnapshot).toHaveBeenCalledOnce();
    expect(first.remove).toHaveBeenCalledWith('another-unknown-snapshot');
    expect(second.remove).toHaveBeenCalledWith('another-unknown-snapshot');
  });

  it('retains legacy aggregated snapshot failures for unknown IDs', async () => {
    const first = makeProvider('first');
    const second = makeProvider('second');
    const failure = Object.assign(new Error('provider failure'), { code: 'NATIVE_FAILURE', fallback: false });
    for (const provider of [first, second]) {
      provider.createSnapshot.mockRejectedValue(failure);
      provider.remove.mockRejectedValue(failure);
    }
    const sdk = compute({ providers: [first.provider, second.provider] });

    for (const operation of [
      () => sdk.snapshot.create('unknown-instance'),
      () => sdk.snapshot.delete('unknown-snapshot'),
    ]) {
      const error = await operation().catch(error => error);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBe(failure);
      expect(error.message).toContain('across 2 provider(s)');
      expect(error.message).toContain('provider failure');
    }
    expect(first.createSnapshot).toHaveBeenCalledOnce();
    expect(second.createSnapshot).toHaveBeenCalledOnce();
    expect(first.remove).toHaveBeenCalledOnce();
    expect(second.remove).toHaveBeenCalledOnce();
  });

  it.each(['new-instance', 'unknown-snapshot'] as const)(
    'preserves ordinary fallback and source errors for %s creation',
    async kind => {
      const first = makeProvider('first');
      const second = makeProvider('second');
      const options = kind === 'unknown-snapshot' ? { snapshotId: 'unknown' } : {};
      const sdk = compute({ providers: [first.provider, second.provider] });
      first.create.mockRejectedValueOnce(new Error('first unavailable'));
      expect(await sdk.instances.create(options)).toBe(second.instance);
      second.create.mockClear();

      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      const unknownOutcome = Object.assign(new Error('outcome unknown'), { fallback: false });
      for (const failure of [abort, unknownOutcome]) {
        first.create.mockRejectedValueOnce(failure);
        await expect(sdk.instances.create(options)).rejects.toBe(failure);
      }
      expect(second.create).not.toHaveBeenCalled();
    },
  );
});
