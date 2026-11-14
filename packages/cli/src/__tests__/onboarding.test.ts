import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionsCliError } from '../actions-client.js';

const client = vi.fn();
const login = vi.fn();
const loadCredentials = vi.fn();
vi.mock('../actions.js', () => ({ client: (...args: unknown[]) => client(...args) }));
vi.mock('../login.js', () => ({ login: (...args: unknown[]) => login(...args) }));
vi.mock('@benchsdk/cli', () => ({ loadCredentials: () => loadCredentials() }));
const { creationClient } = await import('../onboarding.js');
const missing = new ActionsCliError('no_credentials', 'No API key. Run compute login.');
const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const stderrTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
beforeEach(() => {
  vi.clearAllMocks();
  for (const name of ['CI', 'COMPUTE_API_KEY', 'BENCHMARKS_PLATFORM_API_KEY', 'BENCHMARKS_PLATFORM_TOKEN']) vi.stubEnv(name, '');
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
  client.mockRejectedValueOnce(missing).mockResolvedValue({ ready: true });
  loadCredentials.mockResolvedValue(undefined);
  login.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (stdinTTY) Object.defineProperty(process.stdin, 'isTTY', stdinTTY);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  if (stderrTTY) Object.defineProperty(process.stderr, 'isTTY', stderrTTY);
  else Reflect.deleteProperty(process.stderr, 'isTTY');
});
describe('first-run creation auth', () => {
  it('logs in once and resolves again with the original flags before any provisioning', async () => {
    const opts = { baseUrl: 'http://localhost:3210', org: 'team', browser: false };
    expect(await creationClient(opts)).toEqual({ ready: true });
    expect(login).toHaveBeenCalledWith({ baseUrl: opts.baseUrl, browser: false, org: opts.org });
    expect(client.mock.calls).toEqual([[opts], [opts]]);
  });
  it.each([{ json: true }, { quiet: true }, { apiKey: 'explicit' }])('never starts login for %j', async (opts) => {
    await expect(creationClient(opts)).rejects.toBe(missing);
    expect(login).not.toHaveBeenCalled();
  });
  it.each(['CI', 'COMPUTE_API_KEY', 'BENCHMARKS_PLATFORM_API_KEY', 'BENCHMARKS_PLATFORM_TOKEN'])('respects %s', async (name) => {
    vi.stubEnv(name, 'set');
    await expect(creationClient({})).rejects.toBe(missing);
    expect(login).not.toHaveBeenCalled();
  });
  it('fails promptly without a terminal', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    await expect(creationClient({})).rejects.toBe(missing);
    expect(login).not.toHaveBeenCalled();
  });
  it.each([{ token: 'expired' }, { apiKey: 'old' }, { refreshToken: 'failed' }])('does not replace an existing credential: %j', async (stored) => {
    loadCredentials.mockResolvedValue(stored);
    await expect(creationClient({})).rejects.toBe(missing);
    expect(login).not.toHaveBeenCalled();
  });
  it('does not treat a transport failure as missing credentials', async () => {
    client.mockReset().mockRejectedValue(new Error('network failed'));
    await expect(creationClient({})).rejects.toThrow('network failed');
    expect(login).not.toHaveBeenCalled();
  });
  it('does not retry when sign-in is denied', async () => {
    login.mockRejectedValue(new Error('denied'));
    await expect(creationClient({})).rejects.toThrow('denied');
    expect(client).toHaveBeenCalledTimes(1);
  });
});
