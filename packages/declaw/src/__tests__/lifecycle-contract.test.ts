import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ create: vi.fn(), connect: vi.fn(), kill: vi.fn() }));
vi.mock('@declaw/sdk', async () => ({
  ...await vi.importActual<typeof import('@declaw/sdk')>('@declaw/sdk'),
  Sandbox: native,
}));
import { NotFoundError, AuthenticationError, SandboxError } from '@declaw/sdk';
import { declaw } from '../index';
const provider = () => declaw({ apiKey: 'dcl_test', domain: 'declaw.invalid' });
// Only public vendor methods are mocked, never defineProvider or private constructors.
const handle = (sandboxId: unknown = 'sb-one') => ({ sandboxId, files: { read: vi.fn().mockRejectedValue(new Error('no egress file')) } });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('DECLAW_API_KEY', ''); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('Declaw lifecycle contract', () => {
  it.each(['sb-one ', ' sb-one', '.', '..', 'sb.one', 'sb/one', 'sb?one', 'sb#one', 'sb\\one', '%2e', '会話', ...Array.from({ length: 32 }, (_, i) => `sb${String.fromCharCode(i)}one`), 'sb\u007fone'])('validates native create identity %j with public strict grammar', async (id) => {
    native.create.mockResolvedValue(handle(id));
    await expect(provider().instances.create()).rejects.toThrow(/identity/i);
    expect(native.create).toHaveBeenCalledOnce();
  });
  it.each(['', ' ', '../other', 'sb?x=1', 'sb#one', 'sb/one'])('rejects an unsafe native resource reference %j before vendor calls', async (id) => {
    await expect(provider().instances.getById(id)).rejects.toThrow(/identity/i);
    await expect(provider().instances.destroy(id)).rejects.toThrow(/identity/i);
    expect(native.connect).not.toHaveBeenCalled(); expect(native.kill).not.toHaveBeenCalled();
  });
  it.each(['getById', 'destroy'] as const)('%s requires credentials', async (method) => {
    await expect(declaw({}).instances[method]('sb-one')).rejects.toThrow(/Missing Declaw API key/);
    expect(native.connect).not.toHaveBeenCalled(); expect(native.kill).not.toHaveBeenCalled();
  });
  it('returns a positively looked-up canonical native identity', async () => {
    native.connect.mockResolvedValue(handle());
    expect((await provider().instances.getById('sb-one'))?.instanceId).toBe('sb-one');
    expect(native.connect).toHaveBeenCalledWith('sb-one', { apiKey: 'dcl_test', domain: 'declaw.invalid' });
  });
  it('maps typed NotFoundError from the single-resource GET only', async () => {
    native.connect.mockRejectedValue(new NotFoundError('HTTP 404: missing'));
    expect(await provider().instances.getById('sb-one')).toBeNull();
  });
  it.each([
    new AuthenticationError('HTTP 401'), new AuthenticationError('HTTP 403'),
    new SandboxError('HTTP 429'), new Error('network failure'),
    new Error('HTTP 404: untyped'), Object.assign(new Error('missing'), { status: 404 }),
    new NotFoundError('other resource', { sandboxId: 'other' }),
  ])('propagates lookup errors without reclassification: %s', async (error) => {
    native.connect.mockRejectedValue(error);
    await expect(provider().instances.getById('sb-one')).rejects.toBe(error);
  });
  it.each([null, {}, { sandboxId: '' }, { sandboxId: '  ' }, { sandboxId: 7 }, { sandboxId: 'other' }, { sandbox_id: 'sb-one' }])('rejects malformed/mismatched lookup identity %j', async (value) => {
    native.connect.mockResolvedValue(value);
    await expect(provider().instances.getById('sb-one')).rejects.toThrow(/identity/i);
  });
  it('propagates identity hydration errors after a positive lookup', async () => {
    const error = new NotFoundError('later getter failure');
    native.connect.mockResolvedValue({ get sandboxId() { throw error; } });
    await expect(provider().instances.getById('sb-one')).rejects.toBe(error);
  });
  it.each([true, false])('accepts documented kill boolean %s (false means already dead)', async (ack) => {
    native.kill.mockResolvedValue(ack);
    await expect(provider().instances.destroy('sb-one')).resolves.toBeUndefined();
    expect(native.kill.mock.calls[0][1].config.apiKey).toBe('dcl_test');
  });
  it('accepts typed missing from the single-resource DELETE', async () => {
    native.kill.mockRejectedValue(new NotFoundError('HTTP 404: missing'));
    await expect(provider().instances.destroy('sb-one')).resolves.toBeUndefined();
  });
  it.each([undefined, 'yes', {}])('rejects non-boolean kill acknowledgement %j', async (ack) => {
    native.kill.mockResolvedValue(ack);
    await expect(provider().instances.destroy('sb-one')).rejects.toThrow(/acknowledgement/i);
  });
  it.each([new AuthenticationError('HTTP 401'), new SandboxError('HTTP 429'), new Error('network 404'), new Error('HTTP 500'), new NotFoundError('other resource', { sandboxId: 'other' })])('preserves destroy failures: %s', async (error) => {
    native.kill.mockRejectedValue(error);
    await expect(provider().instances.destroy('sb-one')).rejects.toBe(error);
  });
  it.each([null, {}, { sandboxId: '' }, { sandboxId: '  ' }, { sandboxId: 7 }, { sandbox_id: 'sb-one' }])('rejects malformed create identity %j', async (value) => {
    native.create.mockResolvedValue(value);
    await expect(provider().instances.create()).rejects.toThrow(/identity/i);
  });
  it.each([new AuthenticationError('HTTP 401'), new SandboxError('HTTP 429'), new Error('network')])('preserves create errors: %s', async (error) => {
    native.create.mockRejectedValue(error);
    await expect(provider().instances.create()).rejects.toBe(error);
  });
  it('creates with the public canonical identity getter', async () => {
    native.create.mockResolvedValue(handle());
    expect((await provider().instances.create()).instanceId).toBe('sb-one');
  });
});
