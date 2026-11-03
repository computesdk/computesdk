import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Sandbox, SandboxError, SandboxNotFoundError, NotFoundError, AuthenticationError, RateLimitError } from 'e2b';
import type { SandboxInfo } from 'e2b';
import { lelantos } from '../index';

// Only public native SDK entrypoints are mocked. Real factory and native error
// classes remain intact. e2b's Node transport uses dynamically imported undici,
// so a global fetch mock alone would not be a safe network boundary here.
const info = (sandboxId: unknown = 'sandbox-id') => ({ sandboxId, state: 'running' }) as SandboxInfo;
const handle = (sandboxId: unknown = 'sandbox-id') => ({ sandboxId }) as Sandbox;
const sdk = () => lelantos({ apiKey: 'lel_abc123', domain: 'slot.invalid', apiUrl: 'https://api.slot.invalid' });
let getInfo: MockInstance<Parameters<typeof Sandbox.getInfo>, ReturnType<typeof Sandbox.getInfo>>;
let connect: MockInstance<Parameters<typeof Sandbox.connect>, Promise<Sandbox>>;
let kill: MockInstance<Parameters<typeof Sandbox.kill>, ReturnType<typeof Sandbox.kill>>;
beforeEach(() => {
  for (const key of ['LELANTOS_API_KEY', 'LELANTOS_DOMAIN', 'LELANTOS_API_URL', 'E2B_API_KEY', 'E2B_DOMAIN', 'E2B_API_URL', 'E2B_ENDPOINT', 'E2B_DEBUG', 'E2B_ACCESS_TOKEN', 'E2B_SANDBOX_URL', 'E2B_VALIDATE_API_KEY']) vi.stubEnv(key, '');
  getInfo = vi.spyOn(Sandbox, 'getInfo').mockResolvedValue(info());
  connect = vi.spyOn(Sandbox, 'connect').mockResolvedValue(handle());
  kill = vi.spyOn(Sandbox, 'kill').mockResolvedValue(true);
  vi.spyOn(Sandbox, 'create').mockResolvedValue(handle());
  // Observe fetch-based requests too; this does NOT cover native dynamic
  // undici. The public static spies above are the operative mock boundaries.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected HTTP request')));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const failures = () => [
  new AuthenticationError('unauthorized'), new RateLimitError('rate limited'),
  new SandboxError('400: failure'), new SandboxError('410: failure'), new SandboxError('500: failure'),
  new NotFoundError('auxiliary resource missing'), new TypeError('network failure'),
  Object.assign(new Error('unclassified 404'), { status: 404 }),
];

describe('Lelantos lifecycle contract', () => {
  it('prechecks identity read-only, then connects with resolved slot options', async () => {
    const box = await sdk().instances.getById('sandbox-id');
    expect(box?.instanceId).toBe('sandbox-id');
    const options = { apiKey: 'e2b_abc123', domain: 'slot.invalid', apiUrl: 'https://api.slot.invalid' };
    expect(getInfo).toHaveBeenCalledWith('sandbox-id', options);
    expect(connect).toHaveBeenCalledWith('sandbox-id', options);
    expect(getInfo.mock.invocationCallOrder[0]).toBeLessThan(connect.mock.invocationCallOrder[0]);
  });
  it('maps only sandbox-specific read-only absence to null', async () => {
    getInfo.mockRejectedValueOnce(new SandboxNotFoundError('missing'));
    await expect(sdk().instances.getById('missing-id')).resolves.toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(failures())('propagates initial native failure %#', async error => {
    getInfo.mockRejectedValueOnce(error);
    await expect(sdk().instances.getById('sandbox-id')).rejects.toBe(error);
    expect(connect).not.toHaveBeenCalled();
  });
  it.each([...failures(), new SandboxNotFoundError('post-positive race')])('propagates post-positive connect failure %#', async error => {
    connect.mockRejectedValueOnce(error);
    await expect(sdk().instances.getById('sandbox-id')).rejects.toBe(error);
  });
  it.each([undefined, null, '', '  ', 42, 'different-id'])('rejects invalid precheck identity %s', async sandboxId => {
    getInfo.mockResolvedValueOnce({ sandboxId } as SandboxInfo);
    await expect(sdk().instances.getById('sandbox-id')).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });
  it.each(['', '  ', 42, 'different-id'])('rejects invalid connected identity %s', async sandboxId => {
    connect.mockResolvedValueOnce(handle(sandboxId));
    await expect(sdk().instances.getById('sandbox-id')).rejects.toThrow();
  });
  it.each(['', '  '])('rejects invalid create identity %s', async sandboxId => {
    vi.mocked(Sandbox.create).mockResolvedValueOnce(handle(sandboxId));
    await expect(sdk().instances.create()).rejects.toThrow();
  });
  it('does not filter retained terminal metadata to fabricate absence', async () => {
    getInfo.mockResolvedValueOnce({ ...info(), state: 'stopped' } as unknown as SandboxInfo);
    await expect(sdk().instances.getById('sandbox-id')).resolves.not.toBeNull();
  });
  it.each([true, false])('uses public static kill acknowledgement %s without connect/resume', async acknowledged => {
    kill.mockResolvedValueOnce(acknowledged);
    await expect(sdk().instances.destroy('sandbox-id')).resolves.toBeUndefined();
    expect(kill).toHaveBeenCalledWith('sandbox-id', { apiKey: 'e2b_abc123', domain: 'slot.invalid', apiUrl: 'https://api.slot.invalid' });
    expect(connect).not.toHaveBeenCalled();
    expect(getInfo).not.toHaveBeenCalled();
  });
  it.each([...failures(), new SandboxNotFoundError('unexpected thrown failure')])('propagates every thrown kill failure %#', async error => {
    kill.mockRejectedValueOnce(error);
    await expect(sdk().instances.destroy('sandbox-id')).rejects.toBe(error);
  });
  it('rejects an invalid non-boolean native kill acknowledgement', async () => {
    kill.mockResolvedValueOnce(undefined as unknown as boolean);
    await expect(sdk().instances.destroy('sandbox-id')).rejects.toThrow();
  });
  it.each(['', '  '])('rejects blank lookup/destroy input %s before native access', async id => {
    await expect(sdk().instances.getById(id)).rejects.toThrow();
    await expect(sdk().instances.destroy(id)).rejects.toThrow();
    expect(getInfo).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled();
  });
});

// These are public vendor-method boundary checks, not HTTP/native API evidence.
const unsafeReferences = [
  '/', 'a/b', '\\', 'a\\b', '?query=1', '#fragment', 'a?query=1', 'a#fragment',
  'a\r\nb', 'a\tb', '\0', '.', '..', '%2f', '%5C', '%3f', '%23', '%0d%0A', '%09', '%00',
  '%2e', '.%2e', '%2e.', '%2E%2e', '%252f', '%255c', '%253f', '%2523',
  '%250d%250a', '%252e%252e', '%25%32%66', '%2525252f', 'safe%2f..%2fother',
];
describe('Lelantos route-safe lifecycle references', () => {
  for (const method of ['getById', 'destroy'] as const) {
    it.each(unsafeReferences)(`${method} rejects ambiguous reference %# before vendor access`, async reference => {
      getInfo.mockRejectedValueOnce(new SandboxNotFoundError('routing miss'));
      kill.mockResolvedValueOnce(false);
      await expect(sdk().instances[method](reference)).rejects.toThrow();
      expect(getInfo).not.toHaveBeenCalled(); expect(connect).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled();
    });
  }
  it.each(['canonical-id_123', 'my.box', '.hidden', 'a..b', 'name space', 'équipe-東京', 'name:@+$,;=', 'literal%25name', 'encoded%20space'])(
    'preserves a safe reference without trimming or imposing a slug grammar: %s', async reference => {
      getInfo.mockResolvedValueOnce(info(reference));
      connect.mockResolvedValueOnce(handle(reference));
      const box = await sdk().instances.getById(reference);
      expect(box?.instanceId).toBe(reference);
      expect(getInfo.mock.calls[0][0]).toBe(reference);
      expect(connect.mock.calls[0][0]).toBe(reference);
    },
  );
  it.each(['../other', '%2e%2e', 'unsafe?query=1', 'unsafe#fragment', '%252f'])(
    'rejects an unsafe native-created canonical identity: %s', async reference => {
      vi.mocked(Sandbox.create).mockResolvedValueOnce(handle(reference));
      await expect(sdk().instances.create()).rejects.toThrow();
    },
  );
});
