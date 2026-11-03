import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { compute, type DirectProvider } from '../compute';

type ListedSnapshot = {
  id: string;
  provider: string;
  createdAt?: Date | string | null;
  metadata?: Record<string, any>;
};

function makeProvider(name: string, records: ListedSnapshot[] = []) {
  const list = vi.fn(async () => records);
  const remove = vi.fn(async (_snapshotId: string) => {});
  const create = vi.fn(async () => ({
    id: `${name}-created`,
    provider: name,
    createdAt: '2026-01-02T03:04:05.000Z',
  }));
  const provider: DirectProvider = {
    name,
    instances: {
      create: vi.fn(async () => { throw new Error('not used'); }),
      getById: vi.fn(async () => null),
      destroy: vi.fn(async () => {}),
    },
    snapshot: { create, list, delete: remove },
  };
  return { provider, list, remove, create };
}

describe('compute snapshot list metadata (core unit)', () => {
  it('normalizes valid Date and ISO timestamps without changing IDs or metadata', async () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    const metadata = { label: 'checkpoint', nested: { preserved: true } };
    const records = [
      { id: 'date-id', provider: 'native-label', createdAt: date, metadata },
      { id: 'iso-id', provider: 'native-label', createdAt: date.toISOString(), metadata },
    ];
    const owner = makeProvider('owner', records);
    const sdk = compute({ provider: owner.provider });

    const listed = await sdk.snapshot.list();

    expect(listed).toEqual(records.map(record => ({ ...record, createdAt: date })));
    for (const snapshot of listed) {
      expect(snapshot.createdAt).toBeInstanceOf(Date);
      expect(snapshot.createdAt?.getTime()).toBe(date.getTime());
      expect(snapshot.metadata).toBe(metadata);
    }
    expect(records[0].createdAt).toBe(date);
    expect(records[1].createdAt).toBe(date.toISOString());
    expect(owner.list).toHaveBeenCalledOnce();
    expect(owner.list).toHaveBeenCalledWith();
    expect(owner.create).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', {}],
    ['undefined', { createdAt: undefined }],
    ['null', { createdAt: null }],
  ] as const)('omits %s timestamps instead of fabricating a date', async (_label, timestamp) => {
    const record = { id: 'unknown-time', provider: 'owner', metadata: { kept: true }, ...timestamp };
    const owner = makeProvider('owner', [record]);
    const sdk = compute({ provider: owner.provider });

    const [listed] = await sdk.snapshot.list();

    expect(listed).toEqual({ id: record.id, provider: record.provider, metadata: record.metadata });
    expect(listed).not.toHaveProperty('createdAt');
    expect(record).toEqual({ id: 'unknown-time', provider: 'owner', metadata: { kept: true }, ...timestamp });
  });

  it.each([
    ['Date', new Date(NaN)],
    ['string', 'invalid-secret-token-in-timestamp'],
  ] as const)('rejects invalid %s timestamps with a sanitized error and no provider fallback', async (_label, createdAt) => {
    const invalid = makeProvider('invalid-owner', [{
      id: 'private-snapshot-id',
      provider: 'private-native-label',
      createdAt,
      metadata: { secret: 'private-metadata' },
    }]);
    const fallback = makeProvider('fallback', [{
      id: 'fallback-id', provider: 'fallback', createdAt: '2026-01-02T03:04:05.000Z',
    }]);
    const sdk = compute({ providers: [invalid.provider, fallback.provider], fallbackOnError: true });

    await expect(sdk.snapshot.list()).rejects.toThrow(
      /^Snapshot list returned an invalid createdAt timestamp\.$/,
    );
    expect(invalid.list).toHaveBeenCalledOnce();
    expect(fallback.list).not.toHaveBeenCalled();
    expect(invalid.create).not.toHaveBeenCalled();
    expect(fallback.create).not.toHaveBeenCalled();
  });

  it('propagates provider list failures unchanged rather than returning a partial inventory', async () => {
    const first = makeProvider('first', [{ id: 'first-id', provider: 'first' }]);
    const failing = makeProvider('failing');
    const failure = new Error('native list unavailable');
    failing.list.mockRejectedValueOnce(failure);
    const later = makeProvider('later');
    const sdk = compute({ providers: [first.provider, failing.provider, later.provider] });

    await expect(sdk.snapshot.list()).rejects.toBe(failure);
    expect(first.list).toHaveBeenCalledOnce();
    expect(failing.list).toHaveBeenCalledOnce();
    expect(later.list).not.toHaveBeenCalled();
  });

  it('keeps deletion affinity for records with unknown timestamps and native provider labels', async () => {
    const other = makeProvider('other');
    const owner = makeProvider('owner', [{ id: 'stable-id', provider: 'native-label' }]);
    const sdk = compute({ providers: [other.provider, owner.provider] });

    const [snapshot] = await sdk.snapshot.list();
    await sdk.snapshot.delete(snapshot.id);

    expect(snapshot.id).toBe('stable-id');
    expect(snapshot.provider).toBe('native-label');
    expect(owner.remove).toHaveBeenCalledOnce();
    expect(owner.remove).toHaveBeenCalledWith('stable-id');
    expect(other.remove).not.toHaveBeenCalled();
  });

  it('does not learn ownership for a record whose normalization failed', async () => {
    const first = makeProvider('first');
    const invalid = makeProvider('invalid', [{ id: 'bad-id', provider: 'invalid', createdAt: 'invalid' }]);
    const sdk = compute({ providers: [first.provider, invalid.provider] });

    await expect(sdk.snapshot.list()).rejects.toThrow(/invalid createdAt timestamp/);
    await sdk.snapshot.delete('bad-id');

    expect(first.remove).toHaveBeenCalledOnce();
    expect(first.remove).toHaveBeenCalledWith('bad-id');
    expect(invalid.remove).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing owner with an invalid record', async () => {
    const owner = makeProvider('owner', [{ id: 'shared-id', provider: 'owner' }]);
    const invalid = makeProvider('invalid', [{ id: 'shared-id', provider: 'invalid', createdAt: new Date(NaN) }]);
    const sdk = compute({ providers: [owner.provider, invalid.provider] });

    await expect(sdk.snapshot.list()).rejects.toThrow(/invalid createdAt timestamp/);
    await sdk.snapshot.delete('shared-id');

    expect(owner.remove).toHaveBeenCalledOnce();
    expect(owner.remove).toHaveBeenCalledWith('shared-id');
    expect(invalid.remove).not.toHaveBeenCalled();
  });

  it('exposes an optional list Date while keeping snapshot create timestamps required', async () => {
    const owner = makeProvider('owner');
    const sdk = compute({ provider: owner.provider });

    type Listed = Awaited<ReturnType<typeof sdk.snapshot.list>>[number];
    type Created = Awaited<ReturnType<typeof sdk.snapshot.create>>;
    expectTypeOf<Listed['createdAt']>().toEqualTypeOf<Date | undefined>();
    expectTypeOf<Created['createdAt']>().toEqualTypeOf<Date>();

    const created = await sdk.snapshot.create('instance-id', { name: 'checkpoint' });
    expect(created.createdAt).toEqual(new Date('2026-01-02T03:04:05.000Z'));
    expect(owner.create).toHaveBeenCalledOnce();
    expect(owner.create).toHaveBeenCalledWith('instance-id', { name: 'checkpoint' });
  });
});
