import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => vi.fn());
vi.mock('@briq-cloud/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@briq-cloud/sdk')>()),
  nativeSandbox: (options: unknown) => {
    native(options);
    return { list: async () => [] };
  },
}));

import { briq } from '../index';

describe('briq config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    native.mockClear();
  });

  it('reports a missing key on first use, with the setup steps', async () => {
    vi.stubEnv('BRIQ_API_KEY', '');
    const provider = briq();
    await expect(provider.instances.list()).rejects.toThrow(/BRIQ_API_KEY/);
    expect(native).not.toHaveBeenCalled();
  });

  it('reads the key and the API address from the environment', async () => {
    vi.stubEnv('BRIQ_API_KEY', 'env-key');
    vi.stubEnv('BRIQ_API_URL', 'https://api.example.test');
    await briq().instances.list();
    expect(native).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'env-key', baseUrl: 'https://api.example.test' }),
    );
  });

  it('prefers the config over the environment and builds the client once', async () => {
    vi.stubEnv('BRIQ_API_KEY', 'env-key');
    const provider = briq({ apiKey: 'config-key', baseUrl: 'https://custom.test', stack: 's' });
    await provider.instances.list();
    await provider.instances.list();
    expect(native).toHaveBeenCalledTimes(1);
    expect(native).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'config-key', baseUrl: 'https://custom.test', stack: 's' }),
    );
  });
});
