import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ create: vi.fn(), connect: vi.fn() }));
vi.mock('tensorlake', async () => ({
  ...await vi.importActual<typeof import('tensorlake')>('tensorlake'),
  Sandbox: native,
}));
import { SandboxNotFoundError, RemoteAPIError } from 'tensorlake';
import { tensorlake } from '../index';
const provider = () => tensorlake({ apiKey: 'test', apiUrl: 'https://tensorlake.invalid' });
const edgeWhitespace = ['sb-one ', ' sb-one', '. ', '.. ', ' .', ' ..', 'sb-one\u00a0', '\u00a0sb-one'];
const controls = [...Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)), '\u007f'];
const encodedUnsafe = ['%2e', '%2E', '%2e%2e', '.%2E', '%2e.', '%2F', '%5c', '%3f', '%23', '%00', '%1f', '%7f', '%20', '%09', '%0d', '%0a', '%252e%252e'];
const unsafeReferences = [...edgeWhitespace, ...controls.flatMap(char => [`${char}sb-one`, `sb${char}one`, `sb-one${char}`]), ...encodedUnsafe];
// Public SDK boundary only. info() mirrors the real method's canonicalization.
function handle(id: unknown = 'sb-one', infoId: unknown = id) {
  const sandbox = {
    sandboxId: id,
    info: vi.fn(async () => { sandbox.sandboxId = infoId; return { sandboxId: infoId, status: 'running' }; }),
    terminate: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(new Error('no egress file')),
  };
  return sandbox;
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('TENSORLAKE_API_KEY', ''); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('Tensorlake lifecycle contract', () => {
  it.each(unsafeReferences)('rejects URL-normalizable/unsafe reference %j before connect', async (id) => {
    await expect(provider().instances.getById(id)).rejects.toThrow(/identity/i);
    await expect(provider().instances.destroy(id)).rejects.toThrow(/identity/i);
    expect(native.connect).not.toHaveBeenCalled();
  });
  it.each([...edgeWhitespace, ...controls.map(char => `sb${char}one`), ...encodedUnsafe, '.', '..', 'sb/one', 'sb?one', 'sb#one', 'sb\\one'])('rejects unsafe create identity %j after the one native create', async (id) => {
    native.create.mockResolvedValue(handle(id));
    await expect(provider().instances.create()).rejects.toThrow(/identity/i);
    expect(native.create).toHaveBeenCalledOnce();
    expect(native.connect).not.toHaveBeenCalled();
  });
  it.each([...edgeWhitespace, ...controls.map(char => `sb${char}one`), ...encodedUnsafe])('rejects unsafe positive-query identity %j before wrapping', async (id) => {
    const sandbox = handle('sb-one', id); native.connect.mockResolvedValue(sandbox);
    await expect(provider().instances.getById('sb-one')).rejects.toThrow(/identity/i);
    expect(sandbox.info).toHaveBeenCalledOnce();
    expect(sandbox.readFile).not.toHaveBeenCalled();
  });
  it('rejects an unsafe native connect handle before its query can issue an ambiguous 404', async () => {
    const sandbox = handle('sb-one ');
    sandbox.info.mockRejectedValue(new SandboxNotFoundError('sb-one'));
    native.connect.mockResolvedValue(sandbox);
    await expect(provider().instances.getById('sb-one')).rejects.toThrow(/identity/i);
    expect(sandbox.info).not.toHaveBeenCalled();
  });
  it.each(['project.session-1', 'session_name-1', '会話-session', 'session name'])('preserves safe-segment name alias %j without UUID-only grammar', async (alias) => {
    const sandbox = handle(alias, 'sb-canonical'); native.connect.mockResolvedValue(sandbox);
    expect((await provider().instances.getById(alias))?.instanceId).toBe('sb-canonical');
    expect(native.connect.mock.calls[0][0].sandboxId).toBe(alias);
  });
  it.each(['', ' ', '.', '..', '../other', 'sb?x=1', 'sb#one', 'sb/one', '%2e%2e'])('rejects an unsafe unencoded native resource reference %j before vendor calls', async (id) => {
    await expect(provider().instances.getById(id)).rejects.toThrow(/identity/i);
    await expect(provider().instances.destroy(id)).rejects.toThrow(/identity/i);
    expect(native.connect).not.toHaveBeenCalled();
  });
  it.each(['getById', 'destroy'] as const)('%s requires credentials', async (method) => {
    await expect(tensorlake({}).instances[method]('sb-one')).rejects.toThrow(/Missing Tensorlake API key/);
    expect(native.connect).not.toHaveBeenCalled();
  });
  it('queries info() because native connect alone is only a local handle', async () => {
    const sandbox = handle(); native.connect.mockResolvedValue(sandbox);
    expect((await provider().instances.getById('sb-one'))?.instanceId).toBe('sb-one');
    expect(sandbox.info).toHaveBeenCalledOnce();
  });
  it('supports documented name aliases using the canonical info identity', async () => {
    const sandbox = handle('session-name', 'sb-canonical'); native.connect.mockResolvedValue(sandbox);
    expect((await provider().instances.getById('session-name'))?.instanceId).toBe('sb-canonical');
  });
  it('maps resource-specific SandboxNotFoundError from info() to null', async () => {
    const sandbox = handle(); sandbox.info.mockRejectedValue(new SandboxNotFoundError('sb-one')); native.connect.mockResolvedValue(sandbox);
    expect(await provider().instances.getById('sb-one')).toBeNull();
  });
  it.each([new RemoteAPIError(401, 'auth'), new RemoteAPIError(403, 'auth'), new RemoteAPIError(429, 'rate'), new Error('network 404'), new RemoteAPIError(404, 'generic route'), new SandboxNotFoundError('other')])('propagates query failures outside the exact missing oracle: %s', async (error) => {
    const sandbox = handle(); sandbox.info.mockRejectedValue(error); native.connect.mockResolvedValue(sandbox);
    await expect(provider().instances.getById('sb-one')).rejects.toBe(error);
  });
  it('does not classify connect/hydration errors as an existence oracle', async () => {
    const error = new SandboxNotFoundError('sb-one'); native.connect.mockRejectedValue(error);
    await expect(provider().instances.getById('sb-one')).rejects.toBe(error);
  });
  it.each([null, {}, { sandboxId: '' }, { sandboxId: '  ' }, { sandboxId: 7 }, { id: 'sb-one' }])('rejects malformed query identity %j', async (info) => {
    const sandbox = handle(); sandbox.info.mockResolvedValue(info as any); native.connect.mockResolvedValue(sandbox);
    await expect(provider().instances.getById('sb-one')).rejects.toThrow(/identity/i);
  });
  it('rejects a canonical handle/query identity mismatch', async () => {
    const sandbox = handle(); sandbox.info.mockResolvedValue({ sandboxId: 'other', status: 'running' }); native.connect.mockResolvedValue(sandbox);
    await expect(provider().instances.getById('sb-one')).rejects.toThrow(/identity/i);
  });
  it('preserves typed missing from identity hydration after a positive query', async () => {
    const error = new SandboxNotFoundError('sb-one');
    let queried = false;
    native.connect.mockResolvedValue({
      info: vi.fn(async () => { queried = true; return { sandboxId: 'sb-one' }; }),
      get sandboxId() { if (queried) throw error; return 'sb-one'; },
    });
    await expect(provider().instances.getById('sb-one')).rejects.toBe(error);
  });
  it('does not hide retained terminal metadata', async () => {
    const sandbox = handle(); sandbox.info.mockResolvedValue({ sandboxId: 'sb-one', status: 'terminated' }); native.connect.mockResolvedValue(sandbox);
    expect((await provider().instances.getById('sb-one'))?.instanceId).toBe('sb-one');
  });
  it('accepts native Promise<void> terminate acknowledgement', async () => {
    const sandbox = handle(); native.connect.mockResolvedValue(sandbox);
    await expect(provider().instances.destroy('sb-one')).resolves.toBeUndefined();
    expect(sandbox.terminate).toHaveBeenCalledOnce();
  });
  it('makes native resource-specific missing delete idempotent', async () => {
    const sandbox = handle(); sandbox.terminate.mockRejectedValue(new SandboxNotFoundError('sb-one')); native.connect.mockResolvedValue(sandbox);
    await expect(provider().instances.destroy('sb-one')).resolves.toBeUndefined();
  });
  it.each([new RemoteAPIError(401, 'auth'), new RemoteAPIError(429, 'rate'), new Error('network 404'), new RemoteAPIError(404, 'generic'), new SandboxNotFoundError('other')])('preserves destroy failures: %s', async (error) => {
    const sandbox = handle(); sandbox.terminate.mockRejectedValue(error); native.connect.mockResolvedValue(sandbox);
    await expect(provider().instances.destroy('sb-one')).rejects.toBe(error);
  });
  it.each([null, {}, { sandboxId: '' }, { sandboxId: 7 }, { sandboxId: 'other' }])('does not destroy an invalid/mismatched handle %j', async (sandbox) => {
    native.connect.mockResolvedValue(sandbox);
    await expect(provider().instances.destroy('sb-one')).rejects.toThrow(/identity/i);
  });
  it.each([null, {}, { sandboxId: '' }, { sandboxId: '  ' }, { sandboxId: 7 }, { sandbox_id: 'sb-one' }])('rejects malformed create identity %j', async (sandbox) => {
    native.create.mockResolvedValue(sandbox);
    await expect(provider().instances.create()).rejects.toThrow(/identity/i);
  });
  it.each([new RemoteAPIError(401, 'auth'), new RemoteAPIError(429, 'rate'), new Error('network')])('preserves create errors: %s', async (error) => {
    native.create.mockRejectedValue(error);
    await expect(provider().instances.create()).rejects.toBe(error);
  });
  it('creates with the native canonical identity', async () => {
    native.create.mockResolvedValue(handle());
    expect((await provider().instances.create()).instanceId).toBe('sb-one');
  });
  it('does not retry a post-positive identity error as a create quota failure', async () => {
    vi.useFakeTimers();
    try {
      const error = new Error('reached its quota: identity getter failed');
      native.create.mockResolvedValue({ get sandboxId() { throw error; } });
      const rejection = expect(provider().instances.create()).rejects.toBe(error);
      await vi.advanceTimersByTimeAsync(31_000);
      await rejection;
      expect(native.create).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Tensorlake fresh getInfo reliability', () => {
  async function instanceWith(sandbox = handle()) {
    native.create.mockResolvedValue(sandbox);
    return { instance: await provider().instances.create(), sandbox };
  }

  it.each([
    new RemoteAPIError(401, 'authentication'),
    new RemoteAPIError(403, 'authorization'),
    new RemoteAPIError(429, 'rate limit'),
    new SandboxNotFoundError('sb-one'),
    new Error('connection interrupted'),
    new SyntaxError('native response decoding failed'),
  ])('propagates fresh info failure instead of inventing running: %s', async (error) => {
    const { instance, sandbox } = await instanceWith();
    sandbox.info.mockRejectedValue(error);
    await expect(instance.getInfo()).rejects.toBe(error);
    expect(sandbox.info).toHaveBeenCalledOnce();
  });

  it.each([
    ['pending', 'stopped'],
    ['running', 'running'],
    ['snapshotting', 'stopped'],
    ['suspending', 'stopped'],
    ['suspended', 'stopped'],
    ['terminated', 'stopped'],
    ['timeout', 'stopped'],
    ['failed', 'error'],
  ])('maps public native status %s without making a deletion claim', async (status, expected) => {
    const { instance, sandbox } = await instanceWith();
    const createdAt = new Date('2026-01-02T03:04:05Z');
    sandbox.info.mockResolvedValue({ sandboxId: 'sb-one', status, createdAt, timeoutSecs: 27 } as any);
    const info = await instance.getInfo();
    expect(info).toMatchObject({
      id: 'sb-one', provider: 'tensorlake', status: expected, timeout: 27_000,
    });
    expect(info.createdAt).toBe(createdAt);
    expect(sandbox.info).toHaveBeenCalledOnce();
  });

  it.each([
    null, {}, { sandboxId: 'other', status: 'running' },
    { sandboxId: 7, status: 'running' },
    { sandboxId: 'sb-one' },
    { sandboxId: 'sb-one', status: null },
    { sandboxId: 'sb-one', status: 7 },
    { sandboxId: 'sb-one', status: 'PRIVATE_PROTOCOL_SENTINEL' },
    { sandboxId: 'sb-one', status: 'running', createdAt: '2026-01-02' },
    { sandboxId: 'sb-one', status: 'running', createdAt: new Date(NaN) },
    { sandboxId: 'sb-one', status: 'running', timeoutSecs: -1 },
    { sandboxId: 'sb-one', status: 'running', timeoutSecs: Infinity },
    { sandboxId: 'sb-one', status: 'running', timeoutSecs: '30' },
  ])('rejects malformed or wrong-owned fresh DTO %j rather than defaulting it to a healthy instance', async (dto) => {
    const { instance, sandbox } = await instanceWith();
    sandbox.info.mockResolvedValue(dto as any);
    const error = await instance.getInfo().catch(e => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain('PRIVATE_PROTOCOL_SENTINEL');
    expect(error.cause).toBeUndefined();
  });

  it('queries fresh info on every call, including after a prior successful observation', async () => {
    const { instance, sandbox } = await instanceWith();
    const firstDate = new Date('2026-01-02T03:04:05Z');
    const secondDate = new Date('2026-01-02T03:04:06Z');
    const error = new Error('later read failed');
    sandbox.info
      .mockResolvedValueOnce({ sandboxId: 'sb-one', status: 'running', createdAt: firstDate, timeoutSecs: 5 } as any)
      .mockResolvedValueOnce({ sandboxId: 'sb-one', status: 'terminated', createdAt: secondDate, timeoutSecs: 0 } as any)
      .mockRejectedValueOnce(error);
    expect(await instance.getInfo()).toMatchObject({ status: 'running', timeout: 5_000, createdAt: firstDate });
    expect(await instance.getInfo()).toMatchObject({ status: 'stopped', timeout: 0, createdAt: secondDate });
    await expect(instance.getInfo()).rejects.toBe(error);
    expect(sandbox.info).toHaveBeenCalledTimes(3);
  });

  it('keeps compatibility defaults only after a valid positive DTO with optional fields omitted', async () => {
    const { instance, sandbox } = await instanceWith();
    sandbox.info.mockResolvedValue({ sandboxId: 'sb-one', status: 'running' });
    const before = Date.now();
    const info = await instance.getInfo();
    expect(info.timeout).toBe(300_000);
    expect(info.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(info.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('validates the locally retained target before attempting a fresh native info query', async () => {
    const { instance, sandbox } = await instanceWith();
    sandbox.sandboxId = 'sb-one ';
    await expect(instance.getInfo()).rejects.toThrow(/identity/i);
    expect(sandbox.info).not.toHaveBeenCalled();
  });

  it('does not follow a locally retargeted valid ID instead of the facade-owned ID', async () => {
    const { instance, sandbox } = await instanceWith();
    sandbox.sandboxId = 'other';
    sandbox.info.mockResolvedValue({ sandboxId: 'other', status: 'running' });
    await expect(instance.getInfo()).rejects.toThrow(/identity/i);
    expect(sandbox.info).not.toHaveBeenCalled();
  });

  it('does not adopt a wrong canonical ID that the native info method retained during a rejected observation', async () => {
    const { instance, sandbox } = await instanceWith(handle('sb-one', 'other'));
    await expect(instance.getInfo()).rejects.toThrow(/identity/i);
    await expect(instance.getInfo()).rejects.toThrow(/identity/i);
    expect(sandbox.info).toHaveBeenCalledOnce();
  });
});
