import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotInfo, SnapshotPaginator } from 'e2b';

const native = vi.hoisted(() => ({
  listSnapshots: vi.fn(),
  deleteSnapshot: vi.fn(),
}));

// Mock only the installed native SDK surface, not defineProvider or its managers.
// E2B 2.30.1 has no Sandbox.listTemplates/deleteTemplate methods.
vi.mock('e2b', () => ({
  Sandbox: native,
  Volume: {},
}));

import { e2b } from '../index';
import { compute } from 'computesdk';

function pages(...items: SnapshotInfo[][]) {
  let index = 0;
  const paginator: Pick<SnapshotPaginator, 'hasNext' | 'nextItems'> = {
    get hasNext() { return index < items.length; },
    nextItems: vi.fn(async () => {
      if (!paginator.hasNext) throw new Error('No more items to fetch');
      return items[index++];
    }),
  };
  native.listSnapshots.mockReturnValue(paginator);
  return paginator;
}

const first: SnapshotInfo = { snapshotId: 'snapshot-a:v1', names: ['team/first:v1'] };
const second: SnapshotInfo = { snapshotId: 'snapshot-b:v2', names: [] };
const third: SnapshotInfo = { snapshotId: 'snapshot-c:latest', names: ['team/third:latest'] };
const normalize = (snapshot: SnapshotInfo) => ({ ...snapshot, id: snapshot.snapshotId, provider: 'e2b' });

describe('E2B snapshot list/delete native contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('E2B_API_KEY', '');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('lists every native page and exposes cleanup IDs without inventing timestamps', async () => {
    const paginator = pages([first], [second]);
    const provider = e2b({ apiKey: 'e2b_aabb' });

    expect(await provider.snapshot!.list()).toEqual([normalize(first), normalize(second)]);
    expect(native.listSnapshots).toHaveBeenCalledOnce();
    expect(native.listSnapshots).toHaveBeenCalledWith({ apiKey: 'e2b_aabb' });
    expect(paginator.nextItems).toHaveBeenCalledTimes(2);
  });

  it('keeps paging after an empty page when the native token says there is more', async () => {
    const paginator = pages([], [second]);
    expect(await e2b({}).snapshot!.list()).toEqual([normalize(second)]);
    expect(paginator.nextItems).toHaveBeenCalledTimes(2);
  });

  it('returns an empty list only after a successful empty native response', async () => {
    const paginator = pages([]);
    expect(await e2b({}).snapshot!.list()).toEqual([]);
    expect(paginator.nextItems).toHaveBeenCalledOnce();
  });

  it.each([
    [{ instanceId: 'instance-new' }, 'instance-new'],
    [{ sandboxId: 'instance-legacy' }, 'instance-legacy'],
    [{ instanceId: 'instance-new', sandboxId: 'instance-legacy' }, 'instance-new'],
  ])('uses the real shared factory to normalize the source filter %j', async (options, sandboxId) => {
    pages([]);
    await e2b({ apiKey: 'e2b_aabb' }).snapshot!.list(options);
    expect(native.listSnapshots).toHaveBeenCalledWith({ apiKey: 'e2b_aabb', sandboxId });
  });

  it('treats the unified limit as a total, not just a native page size', async () => {
    const paginator = pages([first], [second, third], [third]);
    expect(await e2b({}).snapshot!.list({ limit: 2 })).toEqual([normalize(first), normalize(second)]);
    expect(paginator.nextItems).toHaveBeenCalledTimes(2);
  });

  it('returns zero requested items without native I/O', async () => {
    expect(await e2b({}).snapshot!.list({ limit: 0 })).toEqual([]);
    expect(native.listSnapshots).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, NaN, Infinity])('rejects invalid limits (%s) before native I/O', async limit => {
    await expect(e2b({}).snapshot!.list({ limit })).rejects.toThrow('Snapshot limit must be a non-negative integer.');
    expect(native.listSnapshots).not.toHaveBeenCalled();
  });

  it('propagates synchronous native listing failures instead of reporting an empty list', async () => {
    const failure = new Error('Unauthorized');
    native.listSnapshots.mockImplementation(() => { throw failure; });
    await expect(e2b({}).snapshot!.list()).rejects.toBe(failure);
  });

  it('propagates later-page failures instead of returning partial cleanup inventory', async () => {
    const failure = new Error('Rate limit exceeded');
    const paginator = pages([first], [second]);
    vi.mocked(paginator.nextItems).mockResolvedValueOnce([first]).mockRejectedValueOnce(failure);
    await expect(e2b({}).snapshot!.list()).rejects.toBe(failure);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['object', { secret: 'private-provider-payload' }],
    ['string', 'private-provider-payload'],
    ['sparse array', Array<SnapshotInfo>(1)],
  ])('rejects a malformed native page (%s) without returning earlier inventory', async (_label, malformed) => {
    const paginator = pages([first], [second]);
    vi.mocked(paginator.nextItems)
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce(malformed as unknown as SnapshotInfo[]);
    await expect(e2b({}).snapshot!.list()).rejects.toMatchObject({
      message: 'Invalid E2B snapshot list response.',
    });
  });

  it.each([
    ['undefined item', undefined],
    ['null item', null],
    ['string item', 'private-provider-payload'],
    ['array item', []],
    ['missing ID', {}],
    ['undefined ID', { snapshotId: undefined }],
    ['null ID', { snapshotId: null }],
    ['empty ID', { snapshotId: '' }],
    ['blank ID', { snapshotId: ' \t\n' }],
    ['numeric ID', { snapshotId: 123 }],
    ['object ID', { snapshotId: { secret: 'private-provider-payload' } }],
    ['array ID', { snapshotId: ['private-provider-payload'] }],
  ])('rejects an invalid native cleanup item (%s) without returning partial inventory', async (_label, malformed) => {
    const paginator = pages([first], [second]);
    vi.mocked(paginator.nextItems)
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([second, malformed] as unknown as SnapshotInfo[]);
    await expect(e2b({}).snapshot!.list()).rejects.toMatchObject({
      message: 'Invalid E2B snapshot list response.',
    });
  });

  it('validates an entire fetched page before applying the total inventory limit', async () => {
    pages([first], [second, { snapshotId: '' } as SnapshotInfo]);
    await expect(e2b({}).snapshot!.list({ limit: 2 })).rejects.toMatchObject({
      message: 'Invalid E2B snapshot list response.',
    });
  });

  it.each([true, false])('deletes via the native API (native deleted=%s)', async deleted => {
    // Installed native docs explicitly define false as not found, so both are
    // successful completion of the unified void/idempotent delete operation.
    native.deleteSnapshot.mockResolvedValue(deleted);
    await expect(e2b({ apiKey: 'e2b_aabb' }).snapshot!.delete(first.snapshotId)).resolves.toBeUndefined();
    expect(native.deleteSnapshot).toHaveBeenCalledOnce();
    expect(native.deleteSnapshot).toHaveBeenCalledWith(first.snapshotId, { apiKey: 'e2b_aabb' });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 1],
    ['string', 'private-provider-payload'],
    ['object', { deleted: true, secret: 'private-provider-payload' }],
  ])('rejects a nonboolean native delete outcome (%s)', async (_label, outcome) => {
    native.deleteSnapshot.mockResolvedValue(outcome);
    await expect(e2b({}).snapshot!.delete(first.snapshotId))
      .rejects.toMatchObject({ message: 'Invalid E2B snapshot delete response.' });
    expect(native.deleteSnapshot).toHaveBeenCalledOnce();
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['blank', ' \t\n'],
    ['number', 123],
    ['object', { secret: 'private-caller-payload' }],
    ['array', ['private-caller-payload']],
  ])('rejects an invalid caller cleanup ID (%s) before invoking native delete', async (_label, id) => {
    native.deleteSnapshot.mockResolvedValue(true);
    await expect(e2b({}).snapshot!.delete(id as unknown as string))
      .rejects.toMatchObject({ message: 'E2B snapshot ID must be a non-empty string.' });
    expect(native.deleteSnapshot).not.toHaveBeenCalled();
  });

  it('preserves opaque nonblank snapshot IDs and names exactly through list and delete', async () => {
    const opaque: SnapshotInfo = {
      snapshotId: ' opaque/id:tag?value=%2F#ü ',
      names: ['team/snapshot:v1', ' alternate opaque name '],
    };
    pages([opaque]);
    native.deleteSnapshot.mockResolvedValue(true);
    const provider = e2b({ apiKey: 'e2b_aabb' });
    const listed = await provider.snapshot!.list();
    expect(listed).toEqual([normalize(opaque)]);
    await provider.snapshot!.delete(listed[0].id);
    expect(native.deleteSnapshot).toHaveBeenCalledWith(opaque.snapshotId, { apiKey: 'e2b_aabb' });
  });

  it('can clean up the IDs returned by listing through the real shared managers', async () => {
    pages([first], [second]);
    native.deleteSnapshot.mockResolvedValue(true);
    const provider = e2b({ apiKey: 'e2b_aabb' });
    for (const snapshot of await provider.snapshot!.list()) {
      await provider.snapshot!.delete(snapshot.id);
    }
    expect(native.deleteSnapshot.mock.calls).toEqual([
      [first.snapshotId, { apiKey: 'e2b_aabb' }],
      [second.snapshotId, { apiKey: 'e2b_aabb' }],
    ]);
  });

  it('roundtrips timestamp-free native snapshots through the real shared compute SDK', async () => {
    pages([first], [second]);
    native.deleteSnapshot.mockResolvedValue(true);
    compute.setConfig({ provider: e2b({ apiKey: 'e2b_aabb' }) });

    const listed = await compute.snapshot.list();
    expect(listed).toEqual([normalize(first), normalize(second)]);
    for (const snapshot of listed) expect(snapshot).not.toHaveProperty('createdAt');
    await compute.snapshot.delete(listed[0].id);

    expect(native.listSnapshots).toHaveBeenCalledWith({ apiKey: 'e2b_aabb' });
    expect(native.deleteSnapshot).toHaveBeenCalledOnce();
    expect(native.deleteSnapshot).toHaveBeenCalledWith(first.snapshotId, { apiKey: 'e2b_aabb' });
  });

  it.each(['Unauthorized', 'Rate limit exceeded', 'Network unavailable', 'Snapshot not ready'])(
    'propagates native deletion failures (%s) rather than silently claiming cleanup',
    async message => {
      const failure = new Error(message);
      native.deleteSnapshot.mockRejectedValue(failure);
      await expect(e2b({}).snapshot!.delete(first.snapshotId)).rejects.toBe(failure);
    },
  );

  it('retains per-provider credential ownership without changing config or the environment', async () => {
    vi.stubEnv('E2B_API_KEY', 'e2b_ccdd');
    pages([]);
    native.deleteSnapshot.mockResolvedValue(true);
    const config = Object.freeze({ apiKey: 'e2b_aabb' });
    const configured = e2b(config);
    const fallback = e2b({});

    await configured.snapshot!.list();
    await fallback.snapshot!.delete(first.snapshotId);
    await configured.snapshot!.delete(second.snapshotId);
    expect(native.listSnapshots).toHaveBeenCalledWith({ apiKey: 'e2b_aabb' });
    expect(native.deleteSnapshot.mock.calls).toEqual([
      [first.snapshotId, { apiKey: 'e2b_ccdd' }],
      [second.snapshotId, { apiKey: 'e2b_aabb' }],
    ]);
    expect(config).toEqual({ apiKey: 'e2b_aabb' });
    expect(process.env.E2B_API_KEY).toBe('e2b_ccdd');
  });

  it('passes environment auth through listing too', async () => {
    vi.stubEnv('E2B_API_KEY', 'e2b_ccdd');
    pages([]);
    await e2b({}).snapshot!.list();
    expect(native.listSnapshots).toHaveBeenCalledWith({ apiKey: 'e2b_ccdd' });
  });
});

describe('E2B existing template adapter honesty', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('E2B_API_KEY', '');
    Reflect.deleteProperty(native, 'listTemplates');
    Reflect.deleteProperty(native, 'deleteTemplate');
  });
  afterEach(() => {
    Reflect.deleteProperty(native, 'listTemplates');
    Reflect.deleteProperty(native, 'deleteTemplate');
    vi.unstubAllEnvs();
  });

  // Controlled legacy compatibility shims ONLY: these methods are absent from
  // the installed E2B 2.30.1 SDK, so this is not proof of native template support.
  function legacyShims() {
    const shims = { listTemplates: vi.fn(), deleteTemplate: vi.fn() };
    Object.assign(native, shims);
    return shims;
  }

  it('rejects template listing through the real manager when the native legacy hook is absent', async () => {
    await expect(e2b({}).template!.list()).rejects.toMatchObject({
      message: 'E2B template.list is not implemented by this adapter for the installed SDK.',
    });
    expect(native.listSnapshots).not.toHaveBeenCalled();
  });

  it('rejects template deletion through the real manager when the native legacy hook is absent', async () => {
    await expect(e2b({}).template!.delete('template-id')).rejects.toMatchObject({
      message: 'E2B template.delete is not implemented by this adapter for the installed SDK.',
    });
    expect(native.deleteSnapshot).not.toHaveBeenCalled();
  });

  it('preserves legacy-shim forwarding and per-provider auth without mutating config or environment', async () => {
    vi.stubEnv('E2B_API_KEY', 'e2b_ccdd');
    const shims = legacyShims();
    const templates = [{ id: 'opaque-template', privateField: 'preserved' }];
    shims.listTemplates.mockResolvedValue(templates);
    shims.deleteTemplate.mockResolvedValue(undefined);
    const config = Object.freeze({ apiKey: 'e2b_aabb' });
    const configured = e2b(config);
    const fallback = e2b({});
    expect(await configured.template!.list()).toBe(templates);
    await fallback.template!.delete(' opaque-template ');
    expect(await fallback.template!.list()).toBe(templates);
    await configured.template!.delete('another-template');
    expect(shims.listTemplates.mock.calls).toEqual([
      [{ apiKey: 'e2b_aabb' }],
      [{ apiKey: 'e2b_ccdd' }],
    ]);
    expect(shims.deleteTemplate.mock.calls).toEqual([
      [' opaque-template ', { apiKey: 'e2b_ccdd' }],
      ['another-template', { apiKey: 'e2b_aabb' }],
    ]);
    expect(config).toEqual({ apiKey: 'e2b_aabb' });
    expect(process.env.E2B_API_KEY).toBe('e2b_ccdd');
    expect(native.listSnapshots).not.toHaveBeenCalled();
    expect(native.deleteSnapshot).not.toHaveBeenCalled();
  });

  it('allows an empty list only after a successful array response from the legacy shim', async () => {
    const shims = legacyShims();
    shims.listTemplates.mockResolvedValue([]);
    expect(await e2b({}).template!.list()).toEqual([]);
    expect(shims.listTemplates).toHaveBeenCalledOnce();
  });

  it.each([
    ['list', 'synchronous'],
    ['list', 'asynchronous'],
    ['delete', 'synchronous'],
    ['delete', 'asynchronous'],
  ])('propagates legacy-shim %s failures (%s) instead of claiming success', async (operation, timing) => {
    const shims = legacyShims();
    const failure = new Error('legacy-shim-failure');
    const method = operation === 'list' ? shims.listTemplates : shims.deleteTemplate;
    if (timing === 'synchronous') method.mockImplementation(() => { throw failure; });
    else method.mockRejectedValue(failure);
    const provider = e2b({});
    const result = operation === 'list'
      ? provider.template!.list()
      : provider.template!.delete('template-id');
    await expect(result).rejects.toBe(failure);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['object', { secret: 'private-provider-payload' }],
    ['string', 'private-provider-payload'],
  ])('rejects a nonarray legacy-shim list response (%s) with a safe fixed error', async (_label, response) => {
    const shims = legacyShims();
    shims.listTemplates.mockResolvedValue(response);
    await expect(e2b({}).template!.list()).rejects.toMatchObject({
      message: 'Invalid E2B template list response.',
    });
  });
});
