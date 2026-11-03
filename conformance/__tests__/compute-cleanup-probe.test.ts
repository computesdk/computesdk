/**
 * Local harness self-tests, NOT native-provider or adapter evidence.
 * Fixtures implement only the public SDK surface used by the probe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  probeCleanup,
  type CleanupManager,
  type CleanupProbeOptions,
  type CleanupSandbox,
} from '../compute-cleanup-probe';

const ownedId = 'owned-local-fixture';
const createos = {
  profileId: '@computesdk/createos-sandbox',
  oracle: 'createos-destroyed-metadata',
} as const satisfies CleanupProbeOptions;
const blaxel = {
  profileId: '@computesdk/blaxel',
  oracle: 'blaxel-terminated-metadata',
} as const satisfies CleanupProbeOptions;

function fixture(info: unknown = { id: ownedId, metadata: { createosStatus: 'destroyed' } }) {
  const getInfo = vi.fn(async () => info);
  const create = vi.fn(() => { throw new Error('Unexpected allocation'); });
  const destroy = vi.fn(() => { throw new Error('Unexpected destruction'); });
  const getInstance = vi.fn(() => { throw new Error('Unexpected native access'); });
  const sandbox = Object.freeze({ sandboxId: ownedId, getInfo, destroy, getInstance }) satisfies CleanupSandbox;
  const getById = vi.fn(async (_id: string): Promise<CleanupSandbox | null> => sandbox);
  const manager = { getById, create, destroy } satisfies CleanupManager & {
    create: typeof create;
    destroy: typeof destroy;
  };
  const f = { manager, sandbox, getById, getInfo, create, destroy, getInstance };
  fixtures.push(f);
  return f;
}

const fixtures: Array<{
  create: () => unknown;
  destroy: () => unknown;
  getInstance: () => unknown;
}> = [];
const fetch = vi.fn(() => { throw new Error('Unexpected network access'); });

beforeEach(() => {
  fetch.mockClear();
  vi.stubGlobal('fetch', fetch);
});
afterEach(() => {
  try {
    for (const f of fixtures) {
      expect(f.create).not.toHaveBeenCalled();
      expect(f.destroy).not.toHaveBeenCalled();
      expect(f.getInstance).not.toHaveBeenCalled();
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fixtures.length = 0;
    vi.unstubAllGlobals();
  }
});

describe('cleanup probe (local harness self-test)', () => {
  it('recognizes retained destroyed metadata only under the exact reviewed oracle', async () => {
    const f = fixture();
    expect(await probeCleanup(f.manager, ownedId, createos)).toEqual({
      kind: 'native-terminal', oracle: 'createos-destroyed-metadata', status: 'destroyed',
    });
    expect(f.getById).toHaveBeenCalledTimes(1);
    expect(f.getById).toHaveBeenCalledWith(ownedId);
    expect(f.getInfo).toHaveBeenCalledOnce();
  });

  it.each([undefined, createos])('accepts exact null without an info read (%j)', async options => {
    const f = fixture();
    f.getById.mockResolvedValue(null);
    expect(await probeCleanup(f.manager, ownedId, options)).toEqual({ kind: 'sdk-absent' });
    expect(f.getById).toHaveBeenCalledTimes(1);
    expect(f.getById).toHaveBeenCalledWith(ownedId);
    expect(f.getInfo).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {},
    { profileId: createos.profileId },
    { oracle: createos.oracle },
    { profileId: createos.profileId, oracle: 'sdk-absence' as const },
    { profileId: '@computesdk/other', oracle: createos.oracle },
    { profileId: '@computesdk/createos-sandbox/alias', oracle: createos.oracle },
    { profileId: createos.profileId, oracle: 'unreviewed-oracle' } as unknown as CleanupProbeOptions,
  ])('does not use native metadata outside the exact opt-in pair (%j)', async options => {
    const f = fixture();
    expect(await probeCleanup(f.manager, ownedId, options)).toEqual({ kind: 'present' });
    expect(f.getById).toHaveBeenCalledTimes(1);
    expect(f.getInfo).not.toHaveBeenCalled();
  });

  it.each([
    'stopped', 'paused', 'error', 'failed', 'destroying', 'running', 'created',
    'DESTROYED', 'Destroyed', 'destroyed ', '',
  ])('does not accept nonterminal or nonexact metadata status %j', async status => {
    const f = fixture({ id: ownedId, status: 'stopped', metadata: { createosStatus: status } });
    expect(await probeCleanup(f.manager, ownedId, createos)).toEqual({ kind: 'present' });
    expect(f.getById).toHaveBeenCalledTimes(1);
    expect(f.getInfo).toHaveBeenCalledTimes(1);
  });

  it.each(['running', 'stopped', 'error', 'destroying', 'destroyed'])(
    'never infers native termination from normalized SDK status %j alone',
    async status => {
      const f = fixture({ id: ownedId, status });
      expect(await probeCleanup(f.manager, ownedId, createos)).toEqual({ kind: 'present' });
      expect(f.getInfo).toHaveBeenCalledTimes(1);
    },
  );

  it('accepts exact native terminal metadata even though the SDK maps it to stopped', async () => {
    const f = fixture({ id: ownedId, status: 'stopped', metadata: { createosStatus: 'destroyed' } });
    expect(await probeCleanup(f.manager, ownedId, createos)).toEqual({
      kind: 'native-terminal', oracle: createos.oracle, status: 'destroyed',
    });
  });

  it.each([{ id: ownedId }, { id: ownedId, metadata: {} }])(
    'keeps valid info without native status present (%j)',
    async info => {
      const f = fixture(info);
      expect(await probeCleanup(f.manager, ownedId, createos)).toEqual({ kind: 'present' });
    },
  );

  it.each([
    undefined, false, 0, '', [], {},
    { sandboxId: 'unowned-sensitive-id' },
    { sandboxId: 1 },
  ])('rejects malformed or unowned lookups, not invented absence (%j)', async found => {
    const f = fixture();
    f.getById.mockResolvedValue(found as unknown as CleanupSandbox);
    for (const options of [undefined, createos]) {
      await expect(probeCleanup(f.manager, ownedId, options))
        .rejects.toThrow('Cleanup lookup did not return the owned SDK ID');
    }
    expect(f.getById).toHaveBeenCalledTimes(2);
    expect(f.getInfo).not.toHaveBeenCalled();
  });

  it('does not call info when a wrong lookup ID carries otherwise valid terminal metadata', async () => {
    const f = fixture();
    f.getById.mockResolvedValue({ sandboxId: 'unowned-sensitive-id', getInfo: f.getInfo });
    await expect(probeCleanup(f.manager, ownedId, createos))
      .rejects.toThrow('Cleanup lookup did not return the owned SDK ID');
    expect(f.getById).toHaveBeenCalledTimes(1);
    expect(f.getInfo).not.toHaveBeenCalled();
  });

  it('rejects a missing public info method without invoking a native escape hatch', async () => {
    const f = fixture();
    f.getById.mockResolvedValue({ sandboxId: ownedId } as CleanupSandbox);
    await expect(probeCleanup(f.manager, ownedId, createos))
      .rejects.toThrow('Cleanup lookup did not return a public SDK info method');
    expect(f.getById).toHaveBeenCalledTimes(1);
  });

  it.each([
    null, undefined, false, 'sensitive-native-body', 7, [], {},
    { id: 'unowned-sensitive-id', metadata: { createosStatus: 'destroyed' } },
    { id: 7, metadata: { createosStatus: 'destroyed' } },
    { id: ownedId, metadata: null },
    { id: ownedId, metadata: [] },
    { id: ownedId, metadata: 'sensitive-native-body' },
    { id: ownedId, metadata: { createosStatus: null } },
    { id: ownedId, metadata: { createosStatus: true } },
    { id: ownedId, metadata: { createosStatus: {} } },
  ])('rejects malformed or unowned info with a fixed safe diagnostic (%j)', async info => {
    // Passing undefined explicitly must not select fixture's default argument.
    const f = fixture();
    f.getInfo.mockResolvedValue(info);
    const error = await probeCleanup(f.manager, ownedId, createos).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Cleanup info did not return valid owned SDK metadata');
    expect(error.cause).toBeUndefined();
    expect(f.getById).toHaveBeenCalledTimes(1);
    expect(f.getInfo).toHaveBeenCalledTimes(1);
  });

  it.each(['lookup rejection', 'lookup throw', 'info rejection', 'info throw'])(
    'propagates %s unchanged for caller deadline sanitation, without retry',
    async operation => {
      const f = fixture();
      const error = new Error('local sensitive error sentinel');
      if (operation === 'lookup rejection') f.getById.mockRejectedValue(error);
      if (operation === 'lookup throw') f.getById.mockImplementation(() => { throw error; });
      if (operation === 'info rejection') f.getInfo.mockRejectedValue(error);
      if (operation === 'info throw') f.getInfo.mockImplementation(() => { throw error; });
      await expect(probeCleanup(f.manager, ownedId, createos)).rejects.toBe(error);
      expect(f.getById).toHaveBeenCalledTimes(1);
      expect(f.getInfo).toHaveBeenCalledTimes(operation.startsWith('info') ? 1 : 0);
    },
  );

  it('reads fresh public info per probe and does not cache a preceding status', async () => {
    const f = fixture();
    f.getInfo.mockResolvedValueOnce({ id: ownedId, metadata: { createosStatus: 'destroying' } });
    expect(await probeCleanup(f.manager, ownedId, createos)).toEqual({ kind: 'present' });
    expect(await probeCleanup(f.manager, ownedId, createos)).toEqual({
      kind: 'native-terminal', oracle: createos.oracle, status: 'destroyed',
    });
    expect(f.getById).toHaveBeenCalledTimes(2);
    expect(f.getInfo).toHaveBeenCalledTimes(2);
  });

  it.each(['destroyed', 'paused'])('does not mutate or expose SDK objects/native payloads (%s)', async status => {
    const payload = Object.freeze({ secret: 'local-sensitive-payload' });
    const metadata = Object.freeze({ createosStatus: status, payload });
    const info = Object.freeze({ id: ownedId, status: 'stopped', metadata });
    const f = fixture(info);
    const before = JSON.stringify(info);
    const observation = await probeCleanup(f.manager, ownedId, createos);
    expect(observation).toEqual(status === 'destroyed'
      ? { kind: 'native-terminal', oracle: createos.oracle, status: 'destroyed' }
      : { kind: 'present' });
    expect(JSON.stringify(info)).toBe(before);
    expect(f.sandbox.sandboxId).toBe(ownedId);
    expect(JSON.stringify(observation)).not.toContain(ownedId);
    expect(JSON.stringify(observation)).not.toContain(payload.secret);
    expect(f.getById).toHaveBeenCalledTimes(1);
    expect(f.getInfo).toHaveBeenCalledTimes(1);
  });

  it.each(['', null, undefined, 7])('rejects an invalid owned ID before any SDK read (%j)', async id => {
    const f = fixture();
    await expect(probeCleanup(f.manager, id as string, createos))
      .rejects.toThrow('Cleanup probe requires an owned SDK ID');
    expect(f.getById).not.toHaveBeenCalled();
    expect(f.getInfo).not.toHaveBeenCalled();
  });
});

describe('Blaxel terminal probe (local harness self-test, not native evidence)', () => {
  it('accepts only the exact owned native TERMINATED metadata under the reviewed pair', async () => {
    const f = fixture({ id: ownedId, status: 'stopped', metadata: { blaxelStatus: 'TERMINATED' } });
    expect(await probeCleanup(f.manager, ownedId, blaxel)).toEqual({
      kind: 'native-terminal', oracle: blaxel.oracle, status: 'TERMINATED',
    });
    expect(f.getById).toHaveBeenCalledOnce();
    expect(f.getById).toHaveBeenCalledWith(ownedId);
    expect(f.getInfo).toHaveBeenCalledOnce();
  });
  it.each([
    undefined, {}, { profileId: blaxel.profileId },
    { profileId: '@computesdk/other', oracle: blaxel.oracle },
    { profileId: createos.profileId, oracle: blaxel.oracle },
    { profileId: blaxel.profileId, oracle: createos.oracle },
    { profileId: blaxel.profileId, oracle: 'sdk-absence' as const },
  ])('does not apply Blaxel terminal evidence outside its exact pair (%j)', async options => {
    const f = fixture({ id: ownedId, metadata: { blaxelStatus: 'TERMINATED' } });
    expect(await probeCleanup(f.manager, ownedId, options)).toEqual({ kind: 'present' });
    expect(f.getInfo).not.toHaveBeenCalled();
  });
  it.each([
    undefined, '', 'stopped', 'destroyed', 'terminated', 'Terminated',
    'TERMINATED ', 'TERMINATING', 'DELETING', 'STANDBY', 'ARCHIVED', 'FAILED',
  ])('does not infer native termination from other status %j', async blaxelStatus => {
    const f = fixture({ id: ownedId, status: 'stopped', metadata: { blaxelStatus } });
    expect(await probeCleanup(f.manager, ownedId, blaxel)).toEqual({ kind: 'present' });
    expect(f.getInfo).toHaveBeenCalledOnce();
  });
  it('does not treat normalized stopped, standby or another provider field as Blaxel termination', async () => {
    const f = fixture({ id: ownedId, status: 'stopped',
      metadata: { createosStatus: 'destroyed', state: 'STANDBY' } });
    expect(await probeCleanup(f.manager, ownedId, blaxel)).toEqual({ kind: 'present' });
  });
  it.each([
    { id: 'not-owned', metadata: { blaxelStatus: 'TERMINATED' } },
    { id: ownedId, metadata: { blaxelStatus: null } },
    { id: ownedId, metadata: { blaxelStatus: false } },
    { id: ownedId, metadata: { blaxelStatus: 1 } },
    { id: ownedId, metadata: { blaxelStatus: ['TERMINATED'] } },
    { id: ownedId, metadata: { blaxelStatus: {} } },
  ])('rejects invalid or unowned Blaxel info, rather than manufacturing terminal evidence (%j)', async info => {
    const f = fixture(info);
    await expect(probeCleanup(f.manager, ownedId, blaxel))
      .rejects.toThrow('Cleanup info did not return valid owned SDK metadata');
  });
  it('uses the info of each fresh public lookup, never a cached terminal observation', async () => {
    const f = fixture({ id: ownedId, metadata: { blaxelStatus: 'TERMINATED' } });
    expect(await probeCleanup(f.manager, ownedId, blaxel)).toMatchObject({ kind: 'native-terminal' });
    const currentInfo = vi.fn(async () => ({ id: ownedId, metadata: { blaxelStatus: 'DEPLOYED' } }));
    f.getById.mockResolvedValue({ sandboxId: ownedId, getInfo: currentInfo });
    expect(await probeCleanup(f.manager, ownedId, blaxel)).toEqual({ kind: 'present' });
    expect(f.getById).toHaveBeenCalledTimes(2);
    expect(f.getInfo).toHaveBeenCalledOnce();
    expect(currentInfo).toHaveBeenCalledOnce();
  });
  it('preserves public SDK errors instead of guessing terminal state or retrying', async () => {
    const f = fixture();
    const error = new Error('local sensitive sentinel');
    f.getInfo.mockRejectedValue(error);
    await expect(probeCleanup(f.manager, ownedId, blaxel)).rejects.toBe(error);
    expect(f.getById).toHaveBeenCalledOnce();
    expect(f.getInfo).toHaveBeenCalledOnce();
  });
  it('still accepts exact SDK null separately from native terminal metadata', async () => {
    const f = fixture();
    f.getById.mockResolvedValue(null);
    expect(await probeCleanup(f.manager, ownedId, blaxel)).toEqual({ kind: 'sdk-absent' });
    expect(f.getInfo).not.toHaveBeenCalled();
  });
});
