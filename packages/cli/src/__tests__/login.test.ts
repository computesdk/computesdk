import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:timers/promises', () => ({ setTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)) }));
const saveCredentials = vi.fn();
const getMe = vi.fn();
const setActiveOrganization = vi.fn();
const spawn = vi.fn();
vi.mock('node:child_process', () => ({ spawn: (...args: unknown[]) => spawn(...args) }));
vi.mock('@benchsdk/cli', () => ({
  BENCH_OAUTH_CLIENT_ID: 'benchsdk-cli', BENCH_OAUTH_SCOPE: 'sandboxes:write offline_access',
  saveCredentials: (...args: unknown[]) => saveCredentials(...args),
  getMe: (...args: unknown[]) => getMe(...args),
  setActiveOrganization: (...args: unknown[]) => setActiveOrganization(...args),
  createApiClient: async () => ({ auth: { token: 'access', refreshToken: 'refresh', tokenExpiresAt: 9999 } }),
}));
const { login } = await import('../login.js');
const org = { id: 'o1', slug: 'personal', name: 'Personal' };
const device = {
  device_code: 'private-device-code', user_code: 'ABCD-EFGH',
  verification_uri: 'http://localhost:3210/device',
  verification_uri_complete: 'http://localhost:3210/device?user_code=ABCD-EFGH',
  expires_in: 60, interval: 1,
};
const token = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600 };
const fetchMock = vi.fn();
function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  getMe.mockResolvedValue({ activeOrganizationId: org.id, organizations: [org] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function finish(promise: Promise<void>, milliseconds = 1000) {
  // Attach the rejection handler before timers can reject the login promise.
  const result = promise.then(() => undefined, (error: Error) => error);
  await vi.advanceTimersByTimeAsync(milliseconds);
  return result;
}

describe('ComputeSDK device login', () => {
  it('prints a fallback URL, polls the token endpoint, and saves the shared session and org', async () => {
    respond(device); respond(token);
    expect(await finish(login({ baseUrl: 'http://localhost:3210/api/v1/', browser: false }))).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(device.verification_uri_complete));
    expect(saveCredentials).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'oauth', clientId: 'benchsdk-cli', token: 'access', orgId: org.id, orgSlug: org.slug,
    }));
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('http://localhost:3210/api/auth/oauth2/token');
    expect(init.body.get('device_code')).toBe(device.device_code);
    expect(init.body.get('resource')).toBe('http://localhost:3210/api/v1');
    expect(vi.mocked(console.error).mock.calls.flat().join(' ')).not.toContain(device.device_code);
  });

  it('launches the browser without a shell and falls back if the opener fails', async () => {
    spawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('error', new Error('no browser')));
      return child;
    });
    respond(device); respond(token);
    expect(await finish(login({ baseUrl: 'http://localhost:3210' }))).toBeUndefined();
    expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([device.verification_uri_complete]), {
      stdio: 'ignore', timeout: 5000,
    });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Could not open a browser'));
  });

  it('respects pending and slow_down without requesting a second device code', async () => {
    respond(device); respond({ error: 'authorization_pending' }, 400);
    respond({ error: 'slow_down' }, 400); respond(token);
    expect(await finish(login({ baseUrl: 'http://localhost:3210', browser: false }), 8000)).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(['access_denied', 'expired_token'])('does not save credentials on %s', async (error) => {
    respond(device); respond({ error }, 400);
    const result = await finish(login({ baseUrl: 'http://localhost:3210', browser: false }));
    expect(result?.message).toMatch(/denied|expired/);
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it('selects a sole org if approval did not select one', async () => {
    getMe.mockResolvedValue({ activeOrganizationId: null, organizations: [org] });
    setActiveOrganization.mockResolvedValue({ organization: org });
    respond(device); respond(token);
    expect(await finish(login({ baseUrl: 'http://localhost:3210', browser: false }))).toBeUndefined();
    expect(setActiveOrganization).toHaveBeenCalledWith(expect.anything(), org.slug);
  });

  it('leaves a recoverable signed-in session when no org can be selected', async () => {
    getMe.mockResolvedValue({ activeOrganizationId: null, organizations: [] });
    respond(device); respond(token);
    const result = await finish(login({ baseUrl: 'http://localhost:3210', browser: false }));
    expect(result?.message).toContain('compute org use');
    expect(saveCredentials).toHaveBeenCalledTimes(1);
  });

  it('refuses a verification URL from another origin', async () => {
    respond({ ...device, verification_uri_complete: 'https://evil.example/device' });
    const result = await finish(login({ baseUrl: 'http://localhost:3210', browser: false }), 0);
    expect(result?.message).toContain('unexpected verification URL');
    expect(saveCredentials).not.toHaveBeenCalled();
  });

  it('refuses an untrusted login host before requesting a code', async () => {
    await expect(login({ baseUrl: 'https://evil.example' })).rejects.toThrow('trusted');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('expires locally instead of polling forever', async () => {
    respond({ ...device, expires_in: 2 }); respond({ error: 'authorization_pending' }, 400);
    const result = await finish(login({ baseUrl: 'http://localhost:3210', browser: false }));
    expect(result?.message).toContain('expired');
    expect(saveCredentials).not.toHaveBeenCalled();
  });
});
