import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  get: vi.fn(), create: vi.fn(), stop: vi.fn(), delete: vi.fn(), snapshotGet: vi.fn(), driveGet: vi.fn(),
}));
vi.mock('@vercel/sandbox', async () => {
  const actual = await vi.importActual<typeof import('@vercel/sandbox')>('@vercel/sandbox');
  return {
    Sandbox: { get: native.get, create: native.create },
    Snapshot: { get: native.snapshotGet }, Drive: { get: native.driveGet }, APIError: actual.APIError,
  };
});
import { APIError } from '@vercel/sandbox';
import { vercel } from '../index';

const id = 'opaque-sandbox-name';
const config = { token: ' opaque-token ', teamId: 'opaque-team', projectId: 'opaque-project' };
const provider = () => vercel(config);
const httpError = (status: number) => new APIError(new Response(null, { status }), { message: 'native-original-error' });

// Installed @vercel/sandbox 3.8.0 Sandbox.get performs a metadata GET (and may
// resume the session); SDK isNotFoundError uses APIError + response.status 404.
// Sandbox.delete permanently removes this named sandbox and returns void.
// deleteOrphanSnapshots:false preserves existing snapshots; drives are separate.
describe('Vercel real-factory lifecycle contract (native SDK boundary)', () => {
  beforeEach(() => {
    for (const key of ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID', 'VERCEL_OIDC_TOKEN', 'COMPUTESDK_API_KEY']) {
      vi.stubEnv(key, '');
    }
    native.stop.mockReset().mockResolvedValue({ id: 'native-session', status: 'stopped' });
    native.delete.mockReset().mockResolvedValue(undefined);
    native.snapshotGet.mockReset();
    native.driveGet.mockReset();
    native.get.mockReset().mockResolvedValue({ name: id, stop: native.stop, delete: native.delete });
    native.create.mockReset().mockResolvedValue({ name: id, stop: native.stop, delete: native.delete });
  });
  afterEach(() => {
    expect(native.stop).not.toHaveBeenCalled();
    expect(native.snapshotGet).not.toHaveBeenCalled();
    expect(native.driveGet).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('returns the requested identity and preserves opaque authentication inputs', async () => {
    const instance = await provider().instances.getById(id);
    expect(instance?.instanceId).toBe(id);
    expect(instance?.getInstance()).toMatchObject({ name: id });
    expect(native.get).toHaveBeenCalledOnce();
    expect(native.get).toHaveBeenCalledWith({ name: id, ...config });
    expect(native.stop).not.toHaveBeenCalled();
  });

  it('preserves native OIDC lookup behavior', async () => {
    vi.stubEnv('VERCEL_OIDC_TOKEN', 'dummy-oidc-only');
    expect((await vercel({}).instances.getById(id))?.instanceId).toBe(id);
    expect(native.get).toHaveBeenCalledOnce();
    expect(native.get).toHaveBeenCalledWith({ name: id });
  });

  it('returns null only on a genuine native APIError 404', async () => {
    native.get.mockRejectedValueOnce(httpError(404));
    await expect(provider().instances.getById(id)).resolves.toBeNull();
  });

  it.each([401, 403, 410, 429, 500])('propagates original lookup HTTP %i errors', async status => {
    const error = httpError(status);
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.getById(id)).rejects.toBe(error);
  });

  it.each([
    new Error('network unavailable'),
    new Error('404 sandbox not found'),
    Object.assign(new Error('NotFoundError'), { name: 'NotFoundError', status: 404 }),
    { response: { status: 404 }, message: 'not found' },
    '404',
  ])('does not infer lookup absence from a message/name/structural error %j', async error => {
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.getById(id)).rejects.toBe(error);
  });

  it.each([undefined, null, {}, { name: '' }, { name: 'other-sandbox' }])(
    'does not credit malformed/wrong native lookup identity %j', async handle => {
      native.get.mockResolvedValueOnce(handle);
      await expect(provider().instances.getById(id)).rejects.toThrow('Vercel sandbox lookup returned an invalid identity.');
    },
  );

  it('does not report absence or successful destroy for missing credentials', async () => {
    await expect(vercel({}).instances.getById(id)).rejects.toThrow('Missing Vercel authentication');
    await expect(vercel({}).instances.destroy(id)).rejects.toThrow('Missing Vercel authentication');
    expect(native.get).not.toHaveBeenCalled();
    expect(native.stop).not.toHaveBeenCalled();
  });

  it('awaits permanent void delete through manager and instance destroy without deleting snapshots', async () => {
    let complete!: () => void;
    native.delete.mockImplementationOnce(() => new Promise<void>(resolve => { complete = resolve; }));
    let finished = false;
    const operation = provider().instances.destroy(id).then(() => { finished = true; });
    await vi.waitFor(() => expect(native.delete).toHaveBeenCalledOnce());
    expect(finished).toBe(false);
    complete();
    await operation;
    expect(native.get).toHaveBeenCalledOnce();
    expect(native.get).toHaveBeenCalledWith({ name: id, ...config });
    await (await provider().instances.create()).destroy();
    expect(native.delete).toHaveBeenCalledTimes(2);
    for (const [options] of native.delete.mock.calls) expect(options).toEqual({ deleteOrphanSnapshots: false });
  });

  it('keeps destroy idempotent for an authoritative missing sandbox before delete', async () => {
    native.get.mockRejectedValueOnce(httpError(404));
    await expect(provider().instances.destroy(id)).resolves.toBeUndefined();
    expect(native.delete).not.toHaveBeenCalled();
  });

  it.each([401, 403, 410, 429, 500])('does not hide destroy lookup HTTP %i', async status => {
    const error = httpError(status);
    native.get.mockRejectedValueOnce(error);
    await expect(provider().instances.destroy(id)).rejects.toBe(error);
    expect(native.delete).not.toHaveBeenCalled();
  });

  it.each([httpError(401), httpError(403), httpError(429), httpError(500), new Error('network unavailable'), 'not found'])(
    'propagates original permanent delete failures %j', async error => {
      native.delete.mockRejectedValueOnce(error);
      await expect(provider().instances.destroy(id)).rejects.toBe(error);
    },
  );

  it('accepts a genuine native delete404 race for this named sandbox', async () => {
    native.delete.mockRejectedValueOnce(httpError(404));
    await expect(provider().instances.destroy(id)).resolves.toBeUndefined();
  });

  it.each([undefined, null, {}, { name: 'other-sandbox' }])('never deletes an invalid lookup handle %j', async handle => {
    native.get.mockResolvedValueOnce(handle);
    await expect(provider().instances.destroy(id)).rejects.toThrow('Vercel sandbox lookup returned an invalid identity.');
    expect(native.delete).not.toHaveBeenCalled();
  });

  it.each([false, true])('permanently removes persistent=%s sandbox rather than only stopping compute', async persistent => {
    let exists = true;
    const handle = { name: id, persistent, stop: native.stop, delete: native.delete };
    native.get.mockImplementation(async () => {
      if (!exists) throw httpError(404);
      return handle;
    });
    native.create.mockResolvedValueOnce(handle);
    native.delete.mockImplementationOnce(async () => { exists = false; });
    await (await provider().instances.create({ persistent })).destroy();
    expect(native.create.mock.calls[0][0].persistent).toBe(persistent);
    expect(native.delete).toHaveBeenCalledWith({ deleteOrphanSnapshots: false });
    await expect(provider().instances.getById(id)).resolves.toBeNull();
  });

  it('does not credit a stop-only handle with permanent destroy', async () => {
    native.get.mockResolvedValueOnce({ name: id, stop: native.stop });
    await expect(provider().instances.destroy(id)).rejects.toBeInstanceOf(TypeError);
    expect(native.delete).not.toHaveBeenCalled();
  });
});
