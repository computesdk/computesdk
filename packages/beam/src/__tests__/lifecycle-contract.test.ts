import { beforeEach, describe, expect, it, vi } from 'vitest';
import { beam } from '../index';

// Installed beam-js 1.0.22: Sandbox.connect performs a public gateway request;
// it has no absence discriminator. terminate returns Boolean(response.data?.ok).
const vendor = vi.hoisted(() => ({ connect: vi.fn(), terminate: vi.fn(), opts: {} as Record<string, unknown> }));
vi.mock('@beamcloud/beam-js', () => ({
  default: {}, beamOpts: vendor.opts,
  Sandbox: { connect: vendor.connect, terminate: vendor.terminate }, Image: {}, Volume: class {},
}));
const id = 'opaque /?%# sandbox ID';
const config = { token: 'dummy-beam', workspaceId: 'dummy-workspace' };
const provider = () => beam(config);
const native = () => ({ containerId: id, exec: vi.fn() });
const protocol = (operation: string, reason: string) => ({
  name: 'LifecycleProtocolError', code: 'SDK_LIFECYCLE_PROTOCOL_ERROR',
  provider: 'beam', operation, reason,
});
beforeEach(() => { vi.resetAllMocks(); });

describe('Beam native lifecycle contract (offline)', () => {
  it('looks up via public native connect and preserves opaque identity without executing a command', async () => {
    const handle = native();
    vendor.connect.mockResolvedValue(handle);
    const sandbox = await provider().sandbox.getById(id);
    expect(sandbox?.instanceId).toBe(id);
    expect(sandbox?.getInstance()).toBe(handle);
    expect(vendor.connect).toHaveBeenCalledWith(id);
    expect(vendor.connect).toHaveBeenCalledOnce();
    expect(handle.exec).not.toHaveBeenCalled();
    expect(vendor.terminate).not.toHaveBeenCalled();
  });
  it.each([
    new Error('authentication failed'), { code: 401, error: 'unauthorized' },
    { code: 403, error: 'forbidden' }, { code: 429, error: 'rate limited' },
    new Error('network unavailable'), { response: { status: 404 } },
    { code: 404, error: 'not found' }, new Error('sandbox not found 404'),
    Object.assign(new Error('ambiguous'), { name: 'SandboxConnectionError' }),
  ])('never invents absence from an unclassified native lookup failure: %j', async (error) => {
    vendor.connect.mockRejectedValue(error);
    await expect(provider().sandbox.getById(id)).rejects.toBe(error);
    expect(vendor.connect).toHaveBeenCalledOnce();
    expect(vendor.terminate).not.toHaveBeenCalled();
  });
  it.each([null, undefined, {}, { containerId: 'secret-other-id' }, { containerId: 42 }])('rejects an unverified positive identity: %j', async (result) => {
    vendor.connect.mockResolvedValue(result);
    const error = await provider().sandbox.getById(id).then(() => null, (error: unknown) => error);
    expect(error).toMatchObject(protocol('getById', 'invalid_identity'));
    expect(String(error)).not.toContain('secret');
    expect(error).not.toHaveProperty('cause');
    expect(vendor.connect).toHaveBeenCalledOnce();
  });
  it.each(['getById', 'destroy'] as const)('does not silently succeed at %s when credentials are missing', async (operation) => {
    const error = new Error('Beam token is not set');
    vendor.connect.mockRejectedValue(error);
    vendor.terminate.mockRejectedValue(error);
    const compute = beam({ token: '', workspaceId: '' });
    await expect(compute.sandbox[operation](id)).rejects.toBe(error);
  });
  it('accepts only exact native true from destroy and forwards the opaque ID once', async () => {
    vendor.terminate.mockResolvedValue(true);
    await expect(provider().sandbox.destroy(id)).resolves.toBeUndefined();
    expect(vendor.terminate).toHaveBeenCalledWith(id);
    expect(vendor.terminate).toHaveBeenCalledOnce();
    expect(vendor.connect).not.toHaveBeenCalled();
  });
  it.each([false, undefined, null, 0, 1, 'true', { ok: true }])('rejects unconfirmed native termination: %j', async (result) => {
    vendor.terminate.mockResolvedValue(result);
    const error = await provider().sandbox.destroy(id).then(() => null, (error: unknown) => error);
    expect(error).toMatchObject(protocol('destroy', 'unconfirmed_destroy'));
    expect(error).not.toHaveProperty('cause');
    expect(vendor.terminate).toHaveBeenCalledOnce();
    expect(vendor.connect).not.toHaveBeenCalled();
  });
  it.each([new Error('network'), { code: 401 }, { code: 403 }, { code: 429 }, { code: 404 }])('propagates native destroy failures without retry: %j', async (error) => {
    vendor.terminate.mockRejectedValue(error);
    await expect(provider().sandbox.destroy(id)).rejects.toBe(error);
    expect(vendor.terminate).toHaveBeenCalledOnce();
  });
  it('restores the original configuration for instance destruction after another provider is used', async () => {
    vendor.connect.mockResolvedValue(native());
    const sandbox = await provider().sandbox.getById(id);
    await beam({ token: 'other-token', workspaceId: 'other-workspace' }).sandbox.getById(id);
    vendor.terminate.mockImplementation(async () => {
      expect(vendor.opts.token).toBe(config.token);
      expect(vendor.opts.workspaceId).toBe(config.workspaceId);
      return true;
    });
    await expect(sandbox!.destroy()).resolves.toBeUndefined();
    expect(vendor.terminate).toHaveBeenCalledOnce();
  });
  it('does not claim absence after deletion when native connect has no typed absence signal', async () => {
    const error = { code: 404, error: 'unknown native shape for Beam' };
    vendor.terminate.mockResolvedValue(true);
    vendor.connect.mockRejectedValue(error);
    const compute = provider();
    await compute.sandbox.destroy(id);
    await expect(compute.sandbox.getById(id)).rejects.toBe(error);
    expect(vendor.terminate).toHaveBeenCalledOnce();
    expect(vendor.connect).toHaveBeenCalledOnce();
  });
});
