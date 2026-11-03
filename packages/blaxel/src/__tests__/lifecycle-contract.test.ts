import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blaxel } from '../index';

// @blaxel/core 0.3.21 SandboxInstance.get calls getSandbox(throwOnError:true).
// GET /sandboxes/{sandboxName} documents 404 as _Error; _Error.code is numeric
// HTTP status, and @hey-api/client-fetch throws the parsed response body.
const vendor = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn(), initialize: vi.fn() }));
vi.mock('@blaxel/core', () => ({
  initialize: vendor.initialize, SandboxInstance: { get: vendor.get, delete: vendor.delete },
  Snapshot: {}, VolumeInstance: {},
}));
const id = 'opaque /?%# sandbox ID';
const config = { apiKey: 'dummy-blaxel', workspace: 'dummy-workspace' };
const provider = () => blaxel(config);
const native = () => ({ metadata: { name: id }, spec: {}, process: { exec: vi.fn() } });
const protocol = (operation: string, reason: string) => ({
  name: 'LifecycleProtocolError', code: 'SDK_LIFECYCLE_PROTOCOL_ERROR',
  provider: 'blaxel', operation, reason,
});
beforeEach(() => { vi.resetAllMocks(); });

describe('Blaxel native lifecycle contract (offline)', () => {
  it('looks up through the native metadata-query method and preserves opaque identity', async () => {
    const handle = native();
    vendor.get.mockResolvedValue(handle);
    const sandbox = await provider().sandbox.getById(id);
    expect(sandbox?.instanceId).toBe(id);
    expect(sandbox?.getInstance()).toBe(handle);
    expect(vendor.get).toHaveBeenCalledWith(id);
    expect(vendor.get).toHaveBeenCalledOnce();
    expect(handle.process.exec).not.toHaveBeenCalled();
    expect(vendor.delete).not.toHaveBeenCalled();
  });
  it('maps only the documented native GET 404 error body to absence', async () => {
    vendor.get.mockRejectedValue({ code: 404, error: 'native-not-found', message: 'details' });
    await expect(provider().sandbox.getById(id)).resolves.toBeNull();
    expect(vendor.get).toHaveBeenCalledOnce();
    expect(vendor.delete).not.toHaveBeenCalled();
  });
  it.each([
    { code: 401, error: 'unauthorized' }, { code: 403, error: 'forbidden' },
    { code: 429, error: 'rate limited' }, { code: 500, error: 'server unavailable' },
    new Error('network unavailable'), new Error('404 sandbox not found'),
    { status: 404 }, { response: { status: 404 } }, { code: '404', error: 'not-found' },
    { code: 404 }, { code: 404, error: false },
    Object.assign(new Error('missing'), { name: 'NotFoundError' }),
  ])('propagates operational failures and non-native absence lookalikes: %j', async (error) => {
    vendor.get.mockRejectedValue(error);
    await expect(provider().sandbox.getById(id)).rejects.toBe(error);
    expect(vendor.get).toHaveBeenCalledOnce();
    expect(vendor.delete).not.toHaveBeenCalled();
  });
  it.each([null, undefined, {}, { metadata: {} }, { metadata: { name: 'secret-other-id' } }, { metadata: { name: 42 } }])('rejects malformed positive metadata instead of returning false absence: %j', async (result) => {
    vendor.get.mockResolvedValue(result);
    const error = await provider().sandbox.getById(id).then(() => null, (error: unknown) => error);
    expect(error).toMatchObject(protocol('getById', 'invalid_identity'));
    expect(String(error)).not.toContain('secret');
    expect(error).not.toHaveProperty('cause');
    expect(vendor.get).toHaveBeenCalledOnce();
  });
  it('accepts the native delete response without inventing a terminal status requirement', async () => {
    vendor.delete.mockResolvedValue({ metadata: { name: id }, spec: {}, status: 'DELETING' });
    await expect(provider().sandbox.destroy(id)).resolves.toBeUndefined();
    expect(vendor.delete).toHaveBeenCalledWith(id);
    expect(vendor.delete).toHaveBeenCalledOnce();
    expect(vendor.get).not.toHaveBeenCalled();
  });
  it.each([undefined, null, false, {}, { metadata: {} }, { metadata: { name: 'secret-other-id' } }])('rejects an invalid native delete confirmation: %j', async (result) => {
    vendor.delete.mockResolvedValue(result);
    const error = await provider().sandbox.destroy(id).then(() => null, (error: unknown) => error);
    expect(error).toMatchObject(protocol('destroy', 'invalid_identity'));
    expect(String(error)).not.toContain('secret');
    expect(error).not.toHaveProperty('cause');
    expect(vendor.delete).toHaveBeenCalledOnce();
    expect(vendor.get).not.toHaveBeenCalled();
  });
  it.each([new Error('network'), { code: 401, error: 'auth' }, { code: 403, error: 'permission' }, { code: 429, error: 'rate' }, { code: 404, error: 'not found' }])('does not mask any native delete rejection: %j', async (error) => {
    vendor.delete.mockRejectedValue(error);
    await expect(provider().sandbox.destroy(id)).rejects.toBe(error);
    expect(vendor.delete).toHaveBeenCalledOnce();
  });
  it('preserves originating configuration when destroying a reconnected instance', async () => {
    vendor.get.mockResolvedValue(native());
    const sandbox = await provider().sandbox.getById(id);
    await blaxel({ apiKey: 'other-key', workspace: 'other-workspace' }).sandbox.getById(id);
    vendor.delete.mockResolvedValue(native());
    await expect(sandbox!.destroy()).resolves.toBeUndefined();
    expect(vendor.initialize).toHaveBeenLastCalledWith({ apikey: config.apiKey, workspace: config.workspace });
    expect(vendor.delete).toHaveBeenCalledWith(id);
    expect(vendor.delete).toHaveBeenCalledOnce();
  });
  it('allows an independent absence lookup after native deletion acknowledgement', async () => {
    vendor.get.mockResolvedValueOnce(native()).mockRejectedValueOnce({ code: 404, error: 'not found' });
    vendor.delete.mockResolvedValue(native());
    const compute = provider();
    const sandbox = await compute.sandbox.getById(id);
    await sandbox!.destroy();
    await expect(compute.sandbox.getById(id)).resolves.toBeNull();
    expect(vendor.get).toHaveBeenCalledTimes(2);
    expect(vendor.delete).toHaveBeenCalledOnce();
  });
});

// Match the installed public SandboxInstance.status getter, not raw HTTP's
// `state` field or the SDK's backing `sandbox` storage.
function nativeStatusSnapshot(status: unknown, labels: Record<string, string> = {}) {
  const readStatus = vi.fn(() => status);
  const handle = {
    ...native(),
    metadata: { name: id, labels },
    get status() { return readStatus(); },
  };
  Object.defineProperties(handle, {
    state: { get() { throw new Error('No public SandboxInstance.state getter'); } },
    sandbox: { get() { throw new Error('Do not inspect native backing storage'); } },
  });
  return { handle, readStatus };
}

describe('Blaxel public native status snapshot contract (offline)', () => {
  it('reports the confirmed TERMINATED snapshot as stopped without calling it absent', async () => {
    // Installed @blaxel/core 0.3.21 sandbox.js:17-28 identifies TERMINATED
    // as non-reusable terminal. STANDBY is a separate raw-API state, not a
    // public SandboxInstance property and not this completion signal.
    const { handle, readStatus } = nativeStatusSnapshot('TERMINATED');
    vendor.get.mockResolvedValue(handle);
    const sandbox = await provider().sandbox.getById(id);
    expect(sandbox).not.toBeNull();
    const info = await sandbox!.getInfo();
    expect(info).toMatchObject({
      id, provider: 'blaxel', status: 'stopped',
      metadata: { blaxelStatus: 'TERMINATED' },
    });
    expect(info.metadata).not.toHaveProperty('state');
    expect(info.metadata).not.toHaveProperty('blaxelState');
    expect(readStatus).toHaveBeenCalledOnce();
    expect(vendor.get).toHaveBeenCalledWith(id);
    expect(vendor.get).toHaveBeenCalledOnce();
    expect(vendor.delete).not.toHaveBeenCalled();
    expect(handle.process.exec).not.toHaveBeenCalled();
  });
  it.each([
    ['DEPLOYED', 'running'], ['FAILED', 'error'], ['DELETING', 'stopped'],
    ['DEACTIVATED', 'running'], ['DEACTIVATING', 'running'], ['ARCHIVED', 'running'],
    ['TERMINATING', 'running'], ['STANDBY', 'running'], ['stopped', 'running'],
    ['terminated', 'running'], [' terminated ', 'running'], ['TERMINATED_PENDING', 'running'],
    ['Future state Ω', 'running'], ['x'.repeat(128), 'running'],
  ])('preserves native status %s losslessly and retains mapping %s', async (status, expected) => {
    const { handle } = nativeStatusSnapshot(status);
    vendor.get.mockResolvedValue(handle);
    const sandbox = await provider().sandbox.getById(id);
    const info = await sandbox!.getInfo();
    expect(info.status).toBe(expected);
    expect(info.metadata?.blaxelStatus).toBe(status);
    expect(vendor.get).toHaveBeenCalledOnce();
  });
  it.each([
    { status: 'DEPLOYED', spoof: 'TERMINATED', mapped: 'running' },
    { status: 'TERMINATED', spoof: 'DEPLOYED', mapped: 'stopped' },
    { status: 'Future native value', spoof: 'TERMINATED', mapped: 'running' },
  ])('reserves metadata.blaxelStatus against label spoofing: %j', async ({ status, spoof, mapped }) => {
    const { handle } = nativeStatusSnapshot(status, { blaxelStatus: spoof, project: 'kept' });
    vendor.get.mockResolvedValue(handle);
    const sandbox = await provider().sandbox.getById(id);
    const info = await sandbox!.getInfo();
    expect(info.status).toBe(mapped);
    expect(info.metadata?.blaxelStatus).toBe(status);
    expect(info.metadata?.project).toBe('kept');
  });
  it.each([
    undefined, null, false, 42, {}, ['TERMINATED'],
    { toString: () => 'TERMINATED' }, '', `TERMINATED${'x'.repeat(128)}`,
  ])('does not manufacture terminal metadata from missing/invalid native status %j', async (status) => {
    const { handle } = nativeStatusSnapshot(status, { blaxelStatus: 'TERMINATED', project: 'kept' });
    vendor.get.mockResolvedValue(handle);
    const sandbox = await provider().sandbox.getById(id);
    const info = await sandbox!.getInfo();
    expect(info.status).toBe('running');
    expect(Object.prototype.hasOwnProperty.call(info.metadata, 'blaxelStatus')).toBe(true);
    expect(info.metadata?.blaxelStatus).toBeUndefined();
    expect(info.metadata?.project).toBe('kept');
    expect(vendor.get).toHaveBeenCalledOnce();
  });
  it('uses the metadata snapshot from each fresh getById and makes no getInfo refresh requests', async () => {
    const first = nativeStatusSnapshot('TERMINATED');
    const second = nativeStatusSnapshot('DEPLOYED');
    vendor.get.mockResolvedValueOnce(first.handle).mockResolvedValueOnce(second.handle);
    const compute = provider();
    const oldSnapshot = await compute.sandbox.getById(id);
    const newSnapshot = await compute.sandbox.getById(id);
    await expect(oldSnapshot!.getInfo()).resolves.toMatchObject({
      status: 'stopped', metadata: { blaxelStatus: 'TERMINATED' },
    });
    await expect(newSnapshot!.getInfo()).resolves.toMatchObject({
      status: 'running', metadata: { blaxelStatus: 'DEPLOYED' },
    });
    await oldSnapshot!.getInfo();
    expect(vendor.get).toHaveBeenCalledTimes(2);
    expect(first.readStatus).toHaveBeenCalledTimes(2);
    expect(second.readStatus).toHaveBeenCalledOnce();
    expect(vendor.delete).not.toHaveBeenCalled();
  });
});
