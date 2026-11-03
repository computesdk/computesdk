import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  get: vi.fn(),
  config: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
  connect: vi.fn(),
  start: vi.fn(),
  readToString: vi.fn(),
  setDefaultBackend: vi.fn(),
}));

// Public microsandbox 0.6.18 boundary only, never native/internal constructors.
// Sandbox.get queries persisted existence; handle fields are readonly values.
vi.mock('microsandbox', () => ({
  Sandbox: { get: native.get },
  setDefaultBackend: native.setDefaultBackend,
  defaultBackendInfo: () => ({ source: 'programmatic' }),
  defaultBackendKind: () => 'local',
}));

import { microsandbox } from '../index';

const provider = () => microsandbox({ backend: 'local' });
const absent = () => Object.assign(new Error('opaque native absence'), { code: 'sandboxNotFound' });
const handle = (name = 'canonical-name', status = 'running') => ({
  get name() { return name; },
  get id() { return 'persisted-native-identity'; },
  get status() { return status; },
  get backendKind() { return 'local'; },
  get createdAt() { return new Date('2026-01-01T00:00:00Z'); },
  config: native.config,
  stopWithTimeout: native.stop,
  remove: native.remove,
  connect: native.connect,
  startDetached: native.start,
});

beforeEach(() => {
  vi.clearAllMocks();
  native.config.mockReset().mockReturnValue({ labels: { 'computesdk.metadata.owner': 'test' } });
  native.stop.mockReset().mockResolvedValue(undefined);
  native.remove.mockReset().mockResolvedValue(undefined);
  native.readToString.mockReset().mockRejectedValue(new Error('no egress pointer'));
  const connected = { fs: () => ({ readToString: native.readToString }) };
  native.connect.mockReset().mockResolvedValue(connected);
  native.start.mockReset().mockResolvedValue(connected);
  native.get.mockReset().mockResolvedValue(handle());
});

describe('Microsandbox native lifecycle contract', () => {
  it('queries persisted existence and uses the native name for public identity', async () => {
    const sandbox = await provider().instances.getById('lookup-name');
    expect(native.get).toHaveBeenCalledOnce();
    expect(native.get).toHaveBeenCalledWith('lookup-name');
    expect(sandbox?.instanceId).toBe('canonical-name');
    expect(sandbox?.getInstance()).toMatchObject({
      name: 'canonical-name', backendKind: 'local',
    });
    // The real factory reattaches egress via a filesystem read. Preserve its
    // existing connect side effect rather than testing only an adapter method.
    expect(native.connect).toHaveBeenCalledOnce();
    expect(native.start).not.toHaveBeenCalled();
  });

  it('preserves the real factory egress-recovery start side effect for a stopped lookup', async () => {
    native.get.mockResolvedValueOnce(handle('existing', 'stopped'));
    expect(await provider().instances.getById('existing')).not.toBeNull();
    expect(native.start).toHaveBeenCalledOnce();
    expect(native.connect).not.toHaveBeenCalled();
  });

  it('returns null for the SDK documented sandboxNotFound code', async () => {
    native.get.mockRejectedValueOnce(absent());
    await expect(provider().instances.getById('missing')).resolves.toBeNull();
  });

  it.each([
    new Error('sandbox not found'),
    new Error('HTTP 404'),
    Object.assign(new Error('opaque'), { name: 'SandboxNotFoundError' }),
    Object.assign(new Error('opaque'), { code: 'volumeNotFound' }),
    Object.assign(new Error('not found'), { code: 'cloudHttp' }),
    Object.assign(new Error('not found'), { code: 'database' }),
    new Error('ECONNRESET'),
  ])('preserves non-absence lookup errors %#', async error => {
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.getById('existing')).rejects.toBe(error);
  });

  it.each([undefined, null, {}, { ...handle(), name: '' }, { ...handle(), name: 7 }])(
    'rejects malformed successful lookups %# without inventing an instance',
    async result => {
      native.get.mockResolvedValueOnce(result);
      await expect(provider().instances.getById('existing')).rejects.toThrow();
    },
  );

  it('propagates native configuration recovery errors', async () => {
    const error = new Error('configuration cannot be decoded');
    native.config.mockImplementationOnce(() => { throw error; });
    await expect(provider().instances.getById('existing')).rejects.toBe(error);
  });

  it('awaits native void stop and remove for a running sandbox', async () => {
    await expect(provider().instances.destroy('existing')).resolves.toBeUndefined();
    expect(native.get).toHaveBeenCalledOnce();
    expect(native.get).toHaveBeenCalledWith('existing');
    expect(native.stop).toHaveBeenCalledOnce();
    expect(native.stop).toHaveBeenCalledWith(10_000);
    expect(native.remove).toHaveBeenCalledOnce();
    expect(native.remove).toHaveBeenCalledWith();
    expect(native.stop.mock.invocationCallOrder[0]).toBeLessThan(native.remove.mock.invocationCallOrder[0]);
    expect(native.connect).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
  });

  it.each(['stopped', 'crashed'])('removes a %s sandbox without restarting or stopping it', async status => {
    native.get.mockResolvedValueOnce(handle('existing', status));
    await expect(provider().instances.destroy('existing')).resolves.toBeUndefined();
    expect(native.stop).not.toHaveBeenCalled();
    expect(native.remove).toHaveBeenCalledOnce();
  });

  it('is idempotent when the initial native lookup proves absence', async () => {
    native.get.mockRejectedValueOnce(absent());
    await expect(provider().instances.destroy('missing')).resolves.toBeUndefined();
    expect(native.stop).not.toHaveBeenCalled();
    expect(native.remove).not.toHaveBeenCalled();
  });

  it.each([new Error('not found'), new Error('404'), new Error('ECONNRESET')])(
    'propagates destroy lookup errors %#', async error => {
      native.get.mockRejectedValueOnce(error);
      await expect(provider().instances.destroy('existing')).rejects.toBe(error);
      expect(native.remove).not.toHaveBeenCalled();
    },
  );

  it('does not suppress typed stop absence after a positive lookup', async () => {
    const error = absent();
    native.stop.mockRejectedValue(error);
    await expect(provider().instances.destroy('existing')).rejects.toBe(error);
    expect(native.remove).not.toHaveBeenCalled();
  });

  it('does not suppress typed removal absence after a positive lookup', async () => {
    const error = absent();
    native.remove.mockRejectedValue(error);
    await expect(provider().instances.destroy('existing')).rejects.toBe(error);
  });

  it('preserves exhausted native removal errors after existing retries', async () => {
    const error = new Error('not found in database configuration');
    native.remove.mockRejectedValue(error);
    await expect(provider().instances.destroy('existing')).rejects.toBe(error);
    expect(native.remove).toHaveBeenCalledTimes(3);
  });
});
