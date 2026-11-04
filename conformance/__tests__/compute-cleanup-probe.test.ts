/**
 * Local harness self-tests, NOT native-provider or adapter evidence.
 * Fixtures implement only the public SDK surface used by the probe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  probeCleanup,
  probePresence,
  withSdkProgress,
  type SdkProgress,
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
const modal = {
  profileId: '@computesdk/modal',
  oracle: 'modal-finished-exitcode',
} as const satisfies CleanupProbeOptions;
const upstash = {
  profileId: '@computesdk/upstash',
  oracle: 'upstash-deleted-metadata',
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

describe.each([
  { options: modal, nativeId: 'modalSandboxId', field: 'modalExitCode', terminal: 0 },
  { options: upstash, nativeId: 'upstashBoxId', field: 'upstashStatus', terminal: 'deleted' },
])('$options.oracle (local mocks only, NOT native evidence)', ({ options, nativeId, field, terminal }) => {
  const metadata = { [nativeId]: ownedId, [field]: terminal };
  const invalidMetadata = 'Cleanup info did not return valid owned SDK metadata';

  it('accepts exact terminal metadata only after one owned lookup and fresh public info read', async () => {
    const f = fixture({ id: ownedId, status: 'stopped', metadata });
    expect(await probeCleanup(f.manager, ownedId, options)).toEqual({
      kind: 'native-terminal', oracle: options.oracle, status: terminal,
    });
    expect(f.getById).toHaveBeenCalledOnce();
    expect(f.getById).toHaveBeenCalledWith(ownedId);
    expect(f.getInfo).toHaveBeenCalledOnce();
  });

  it('retains exact SDK-null absence without an info read', async () => {
    const f = fixture();
    f.getById.mockResolvedValue(null);
    expect(await probeCleanup(f.manager, ownedId, options)).toEqual({ kind: 'sdk-absent' });
    expect(f.getById).toHaveBeenCalledOnce();
    expect(f.getById).toHaveBeenCalledWith(ownedId);
    expect(f.getInfo).not.toHaveBeenCalled();
  });

  it.each([
    undefined, {}, { profileId: options.profileId }, { oracle: options.oracle },
    { profileId: '@computesdk/other', oracle: options.oracle },
    { profileId: `${options.profileId}/alias`, oracle: options.oracle },
    { profileId: options.profileId, oracle: 'sdk-absence' as const },
    { profileId: createos.profileId, oracle: options.oracle },
    { profileId: blaxel.profileId, oracle: options.oracle },
    { profileId: options.profileId, oracle: createos.oracle },
    { profileId: options.profileId, oracle: blaxel.oracle },
    { profileId: modal.profileId, oracle: upstash.oracle },
    { profileId: upstash.profileId, oracle: modal.oracle },
  ])('ignores terminal metadata outside the exact reviewed pair (%j)', async wrongOptions => {
    const f = fixture({ id: ownedId, metadata });
    expect(await probeCleanup(f.manager, ownedId, wrongOptions)).toEqual({ kind: 'present' });
    expect(f.getInfo).not.toHaveBeenCalled();
  });

  it.each([undefined, null, false, 0, '', [], {}, 'not-owned', `${ownedId} `])(
    'rejects missing, malformed, or unowned native metadata ID %j',
    async id => {
      const f = fixture({ id: ownedId, metadata: { ...metadata, [nativeId]: id } });
      const error = await probeCleanup(f.manager, ownedId, options).catch(error => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(invalidMetadata);
      expect(error.cause).toBeUndefined();
      expect(f.getById).toHaveBeenCalledOnce();
      expect(f.getInfo).toHaveBeenCalledOnce();
    },
  );

  it.each([
    null, undefined, false, 'private-body', 7, [], {},
    { id: 'not-owned', metadata }, { id: 7, metadata },
    { id: ownedId }, { id: ownedId, metadata: {} },
    { id: ownedId, metadata: null }, { id: ownedId, metadata: [] },
    { id: ownedId, metadata: 'private-body' },
  ])('rejects malformed or unowned fresh public info (%j)', async info => {
    const f = fixture();
    f.getInfo.mockResolvedValue(info);
    await expect(probeCleanup(f.manager, ownedId, options)).rejects.toThrow(invalidMetadata);
    expect(f.getById).toHaveBeenCalledOnce();
    expect(f.getInfo).toHaveBeenCalledOnce();
  });

  it('checks the public lookup ID before reading terminal metadata', async () => {
    const f = fixture({ id: ownedId, metadata });
    f.getById.mockResolvedValue({ sandboxId: 'not-owned', getInfo: f.getInfo });
    await expect(probeCleanup(f.manager, ownedId, options))
      .rejects.toThrow('Cleanup lookup did not return the owned SDK ID');
    expect(f.getInfo).not.toHaveBeenCalled();
  });

  it('requires a public SDK info method without native fallback', async () => {
    const f = fixture();
    f.getById.mockResolvedValue({ sandboxId: ownedId } as CleanupSandbox);
    await expect(probeCleanup(f.manager, ownedId, options))
      .rejects.toThrow('Cleanup lookup did not return a public SDK info method');
    expect(f.getById).toHaveBeenCalledOnce();
  });

  it('checks the fresh public info ID before accessing metadata', async () => {
    const readMetadata = vi.fn(() => { throw new Error('must not inspect unowned metadata'); });
    const f = fixture({ id: 'not-owned', get metadata() { return readMetadata(); } });
    await expect(probeCleanup(f.manager, ownedId, options)).rejects.toThrow(invalidMetadata);
    expect(readMetadata).not.toHaveBeenCalled();
  });

  it.each(['stopped', 'destroyed', 'TERMINATED', 'deleted', 'finished'])(
    'ignores normalized SDK status %j and other providers or generic fields',
    async status => {
      const f = fixture({ id: ownedId, status, metadata: {
        [nativeId]: ownedId, status: terminal, exitCode: 0,
        createosStatus: 'destroyed', blaxelStatus: 'TERMINATED',
        ...(options === modal ? { upstashStatus: 'deleted' } : { modalExitCode: 0 }),
      } });
      expect(await probeCleanup(f.manager, ownedId, options)).toEqual({ kind: 'present' });
    },
  );

  it('reads the current lookup info without caching a preceding terminal observation', async () => {
    const f = fixture({ id: ownedId, metadata });
    expect(await probeCleanup(f.manager, ownedId, options)).toMatchObject({ kind: 'native-terminal' });
    const currentInfo = vi.fn(async () => ({ id: ownedId, metadata: { [nativeId]: ownedId } }));
    f.getById.mockResolvedValue({ sandboxId: ownedId, getInfo: currentInfo });
    expect(await probeCleanup(f.manager, ownedId, options)).toEqual({ kind: 'present' });
    expect(f.getById).toHaveBeenCalledTimes(2);
    expect(f.getInfo).toHaveBeenCalledOnce();
    expect(currentInfo).toHaveBeenCalledOnce();
  });

  it.each(['lookup rejection', 'lookup throw', 'info rejection', 'info throw'])(
    'propagates %s by identity to the bounded sanitizing caller',
    async operation => {
      const f = fixture({ id: ownedId, metadata });
      const error = new Error('local sensitive error sentinel');
      if (operation === 'lookup rejection') f.getById.mockRejectedValue(error);
      if (operation === 'lookup throw') f.getById.mockImplementation(() => { throw error; });
      if (operation === 'info rejection') f.getInfo.mockRejectedValue(error);
      if (operation === 'info throw') f.getInfo.mockImplementation(() => { throw error; });
      await expect(probeCleanup(f.manager, ownedId, options)).rejects.toBe(error);
      expect(f.getById).toHaveBeenCalledOnce();
      expect(f.getInfo).toHaveBeenCalledTimes(operation.startsWith('info') ? 1 : 0);
    },
  );

  it('does not mutate or expose public SDK metadata or inspect private/native accessors', async () => {
    const payload = Object.freeze({ secret: 'local-sensitive-payload' });
    const info = Object.freeze({ id: ownedId, metadata: Object.freeze({ ...metadata, payload }) });
    const f = fixture(info);
    const native = vi.fn(() => { throw new Error('Unexpected private/native access'); });
    f.getById.mockResolvedValue(Object.freeze({
      sandboxId: ownedId, getInfo: f.getInfo,
      get native() { return native(); },
      get instance() { return native(); },
      get _sandbox() { return native(); },
    }));
    const before = JSON.stringify(info);
    const observation = await probeCleanup(f.manager, ownedId, options);
    expect(observation).toEqual({ kind: 'native-terminal', oracle: options.oracle, status: terminal });
    expect(JSON.stringify(info)).toBe(before);
    expect(JSON.stringify(observation)).not.toContain(ownedId);
    expect(JSON.stringify(observation)).not.toContain(payload.secret);
    expect(native).not.toHaveBeenCalled();
  });
});

describe('Modal exit-code scalar contract (local mocks only)', () => {
  it.each([0, 1, -1, 137, -127, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER])(
    'reports the actual safe integer Finished main-process exit code %j',
    async modalExitCode => {
      const f = fixture({ id: ownedId, metadata: { modalSandboxId: ownedId, modalExitCode } });
      expect(await probeCleanup(f.manager, ownedId, modal)).toEqual({
        kind: 'native-terminal', oracle: modal.oracle, status: modalExitCode,
      });
    },
  );
  it('keeps omitted/undefined running exit code present', async () => {
    for (const metadata of [{ modalSandboxId: ownedId }, { modalSandboxId: ownedId, modalExitCode: undefined }]) {
      const f = fixture({ id: ownedId, metadata });
      expect(await probeCleanup(f.manager, ownedId, modal)).toEqual({ kind: 'present' });
    }
  });
  it.each([
    null, '0', 'finished', 'stopped', 'deleted', true, false, 0.5, -0.5,
    NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1,
    [], {}, new Number(0), 0n,
  ])('rejects invalid exit-code metadata %s with a fixed safe diagnostic', async modalExitCode => {
    const f = fixture({ id: ownedId, metadata: { modalSandboxId: ownedId, modalExitCode } });
    const error = await probeCleanup(f.manager, ownedId, modal).catch(error => error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Cleanup info did not return valid owned SDK metadata');
    expect(error.cause).toBeUndefined();
  });
});

describe('Upstash exact deleted scalar contract (local mocks only)', () => {
  it.each([
    undefined, '', 'paused', 'error', 'running', 'creating', 'idle', 'unknown',
    'STopped', 'stopped', 'Deleted', 'DELETED', 'deleted ', ' deleted', 'deleted\n',
    'destroyed', 'TERMINATED',
  ])('keeps nonterminal/nonexact status %j present', async upstashStatus => {
    const f = fixture({ id: ownedId, status: 'stopped', metadata: { upstashBoxId: ownedId, upstashStatus } });
    expect(await probeCleanup(f.manager, ownedId, upstash)).toEqual({ kind: 'present' });
    expect(f.getById).toHaveBeenCalledOnce();
    expect(f.getInfo).toHaveBeenCalledOnce();
  });
  it.each([null, true, false, 0, 1, 0.5, NaN, Infinity, [], {}, new String('deleted'), 0n])(
    'rejects wrongly typed status %s with a fixed safe diagnostic',
    async upstashStatus => {
      const f = fixture({ id: ownedId, metadata: { upstashBoxId: ownedId, upstashStatus } });
      const error = await probeCleanup(f.manager, ownedId, upstash).catch(error => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Cleanup info did not return valid owned SDK metadata');
      expect(error.cause).toBeUndefined();
    },
  );
});

describe('fixed public SDK progress (local harness only)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it.each(['null', 'wrong', 'valid', 'lookup rejection', 'info rejection', 'invalid info', 'missing info'])(
    'labels %s without copying SDK data',
    async outcome => {
      const f = fixture();
      const events: SdkProgress[] = [];
      const sentinel = new Error('RAW-ERROR-URL-CREDENTIAL-SENTINEL');
      if (outcome === 'null') f.getById.mockResolvedValue(null);
      if (outcome === 'wrong') f.getById.mockResolvedValue({ sandboxId: 'RAW-WRONG-ID', getInfo: f.getInfo });
      if (outcome === 'lookup rejection') f.getById.mockRejectedValue(sentinel);
      if (outcome === 'info rejection') f.getInfo.mockRejectedValue(sentinel);
      if (outcome === 'invalid info') f.getInfo.mockResolvedValue({ id: 'RAW-WRONG-ID', body: sentinel });
      if (outcome === 'missing info') f.getById.mockResolvedValue({ sandboxId: ownedId } as CleanupSandbox);
      const result = await probeCleanup(f.manager, ownedId, { ...createos,
        observe: event => events.push(event),
      }).catch(error => error);
      const prefix: SdkProgress[] = ['lookup-started'];
      const expected: Record<string, SdkProgress[]> = {
        null: ['lookup-returned', 'lookup-null'],
        wrong: ['lookup-returned', 'lookup-wrong-identity'],
        valid: ['lookup-returned', 'lookup-valid', 'info-started', 'info-returned', 'info-valid'],
        'lookup rejection': ['lookup-rejected'],
        'info rejection': ['lookup-returned', 'lookup-valid', 'info-started', 'info-rejected'],
        'invalid info': ['lookup-returned', 'lookup-valid', 'info-started', 'info-returned', 'info-invalid'],
        'missing info': ['lookup-returned', 'lookup-valid', 'info-unavailable'],
      };
      expect(events).toEqual([...prefix, ...expected[outcome]]);
      if (outcome.endsWith('rejection')) expect(result).toBe(sentinel);
      expect(JSON.stringify(events)).not.toContain('RAW-');
      expect(f.getById).toHaveBeenCalledOnce();
    },
  );

  it.each(['lookup', 'info'])('observes synchronous %s throws without changing the error', async stage => {
    const f = fixture();
    const error = Object.freeze({ private: 'RAW-SENTINEL' });
    const events: SdkProgress[] = [];
    if (stage === 'lookup') f.getById.mockImplementation(() => { throw error; });
    else f.getInfo.mockImplementation(() => { throw error; });
    await expect(probeCleanup(f.manager, ownedId, { ...createos,
      observe: event => events.push(event),
    })).rejects.toBe(error);
    expect(events.at(-1)).toBe(`${stage}-rejected`);
  });

  it.each(['throw', 'reject', 'pending'])('ignores observers that %s for both values and errors', async mode => {
    const f = fixture();
    const observe = () => {
      if (mode === 'throw') throw new Error('RAW-OBSERVER');
      if (mode === 'reject') return Promise.reject(new Error('RAW-OBSERVER'));
      return new Promise(() => {});
    };
    expect(await probeCleanup(f.manager, ownedId, { ...createos, observe })).toMatchObject({ kind: 'native-terminal' });
    expect(await probePresence(f.manager, ownedId, observe)).toBe(f.sandbox);
    const error = new Error('RAW-SDK');
    f.getById.mockRejectedValue(error);
    await expect(probeCleanup(f.manager, ownedId, { ...createos, observe })).rejects.toBe(error);
    await expect(probePresence(f.manager, ownedId, observe)).rejects.toBe(error);
    // Flush ignored observer rejections; the runner detects unhandled ones.
    await Promise.resolve();
  });

  it.each(['lookup', 'info'])('fences late %s resolution after the caller deadline and next probe', async stage => {
    vi.useFakeTimers();
    const f = fixture();
    const events: SdkProgress[] = [];
    let finish!: (value: never) => void;
    const pending = new Promise<never>(resolve => { finish = resolve; });
    if (stage === 'lookup') f.getById.mockReturnValueOnce(pending);
    else f.getInfo.mockReturnValueOnce(pending);
    const result = withSdkProgress(observe => probeCleanup(f.manager, ownedId, { ...createos, observe }),
      8000, 'SAFE-DEADLINE', event => events.push(event)).catch(error => error);
    await vi.advanceTimersByTimeAsync(8000);
    expect((await result).message).toBe('SAFE-DEADLINE');
    expect(events.at(-1)).toBe(`${stage}-deadline`);
    expect(events).not.toContain(`${stage}-rejected`);
    await withSdkProgress(observe => probeCleanup(f.manager, ownedId, { ...createos, observe }),
      8000, 'SAFE-DEADLINE', event => events.push(event));
    const nextProbe = [...events];
    finish((stage === 'lookup' ? f.sandbox : { id: ownedId, metadata: { createosStatus: 'destroyed' } }) as never);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(nextProbe);
  });

  it('fences late rejection and does not relabel a presence deadline as an SDK rejection', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let reject!: (error: unknown) => void;
    f.getById.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const events: SdkProgress[] = [];
    const result = withSdkProgress(observe => probePresence(f.manager, ownedId, observe),
      8000, 'SAFE-DEADLINE', event => events.push(event)).catch(error => error);
    await vi.advanceTimersByTimeAsync(8000);
    expect((await result).message).toBe('SAFE-DEADLINE');
    expect(events).toEqual(['lookup-started', 'lookup-deadline']);
    reject(new Error('RAW-LATE-REJECTION'));
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual(['lookup-started', 'lookup-deadline']);
  });

  it.each([null, { sandboxId: 'RAW-WRONG-ID', getInfo: async () => ({}) }])(
    'preserves the presence lookup value %j for the existing caller identity check',
    async found => {
      const f = fixture();
      f.getById.mockResolvedValue(found);
      const events: SdkProgress[] = [];
      expect(await probePresence(f.manager, ownedId, event => events.push(event))).toBe(found);
      expect(events).toEqual(['lookup-started', 'lookup-returned']);
      expect(f.getInfo).not.toHaveBeenCalled();
    },
  );

  it('distinguishes a public SDK rejection from the sanitizing callback deadline', async () => {
    const f = fixture();
    const events: SdkProgress[] = [];
    f.getById.mockRejectedValue(new Error('RAW-SDK'));
    await expect(withSdkProgress(observe => probePresence(f.manager, ownedId, observe),
      8000, 'SAFE-FAILURE', event => events.push(event))).rejects.toThrow('SAFE-FAILURE');
    expect(events).toEqual(['lookup-started', 'lookup-rejected']);
  });

  it.each(['throw', 'reject', 'pending'])('a deadline observer that %s cannot hide the caller timeout', async mode => {
    vi.useFakeTimers();
    const f = fixture();
    f.getById.mockReturnValue(new Promise(() => {}));
    const result = withSdkProgress(observe => probePresence(f.manager, ownedId, observe),
      8000, 'SAFE-DEADLINE', () => {
        if (mode === 'throw') throw new Error('RAW-OBSERVER');
        if (mode === 'reject') return Promise.reject(new Error('RAW-OBSERVER'));
        return new Promise(() => {});
      }).catch(error => error);
    await vi.advanceTimersByTimeAsync(8000);
    expect((await result).message).toBe('SAFE-DEADLINE');
  });

  it('fences progress by elapsed time even before a delayed timer fires, without changing the SDK value', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let finish!: (value: CleanupSandbox) => void;
    f.getById.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const events: SdkProgress[] = [];
    const result = withSdkProgress(observe => probePresence(f.manager, ownedId, observe),
      8000, 'SAFE-DEADLINE', event => events.push(event));
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(Date.now() + 8001);
    finish(f.sandbox);
    expect(await result).toBe(f.sandbox);
    expect(events).toEqual(['lookup-started', 'lookup-deadline']);
  });

  it('does not guess an SDK endpoint when only the verification callback is pending', async () => {
    vi.useFakeTimers();
    const events: SdkProgress[] = [];
    const result = withSdkProgress(() => new Promise<never>(() => {}), 8000, 'SAFE-DEADLINE',
      event => events.push(event)).catch(error => error);
    await vi.advanceTimersByTimeAsync(8000);
    expect((await result).message).toBe('SAFE-DEADLINE');
    expect(events).toEqual(['callback-deadline']);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])(
    'does not call invalid-duration validation (%s) a timer expiry',
    async duration => {
      const operation = vi.fn(async () => 'unexpected');
      const events: SdkProgress[] = [];
      await expect(withSdkProgress(operation, duration, 'SAFE-DEADLINE',
        event => events.push(event))).rejects.toThrow('Lifecycle durations must be finite positive milliseconds');
      expect(operation).not.toHaveBeenCalled();
      expect(events).toEqual([]);
    },
  );
});
