import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  create: vi.fn(async () => ({ session_id: 'session-id', cdp_ws_url: 'wss://kernel.example' })),
  listProxies: vi.fn(async (): Promise<{ id: string; name: string; type: string }[]> => []),
  createProxy: vi.fn(async () => ({ id: 'new-proxy' })),
}));

vi.mock('@onkernel/sdk', () => ({
  default: class Kernel {
    browsers = {
      create: sdk.create,
    };
    proxies = {
      list: sdk.listProxies,
      create: sdk.createProxy,
    };
  },
}));

import { kernel } from '../index';

describe('kernel option mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves explicit stealth false and keeps default egress for proxies false', async () => {
    const provider = kernel({ apiKey: 'test-false' });

    await provider.session.create({
      stealth: false,
      proxies: false,
      viewport: { width: 1920, height: 1080 },
    });

    expect(sdk.create).toHaveBeenCalledWith({
      stealth: false,
      viewport: { width: 1920, height: 1080 },
    });
    expect(sdk.listProxies).not.toHaveBeenCalled();
  });

  it('maps proxies true to a US residential proxy, created once and reused', async () => {
    const provider = kernel({ apiKey: 'test-true' });

    await provider.session.create({ stealth: true, proxies: true });
    await provider.session.create({ stealth: true, proxies: true });

    expect(sdk.createProxy).toHaveBeenCalledTimes(1);
    expect(sdk.createProxy).toHaveBeenCalledWith({
      type: 'residential',
      name: 'computesdk-residential-us',
      config: { country: 'US' },
    });
    expect(sdk.create).toHaveBeenNthCalledWith(2, { stealth: true, proxy_id: 'new-proxy' });
  });

  it('reuses an existing proxy with the same name and type', async () => {
    sdk.listProxies.mockResolvedValueOnce([
      { id: 'isp-proxy', name: 'computesdk-residential-us', type: 'isp' },
      { id: 'resi-proxy', name: 'computesdk-residential-us', type: 'residential' },
    ]);
    const provider = kernel({ apiKey: 'test-existing' });

    await provider.session.create({ stealth: true, proxies: true });

    expect(sdk.createProxy).not.toHaveBeenCalled();
    expect(sdk.create).toHaveBeenCalledWith({ stealth: true, proxy_id: 'resi-proxy' });
  });

  it('maps a typed proxy config with its country', async () => {
    const provider = kernel({ apiKey: 'test-typed' });

    await provider.session.create({ proxies: [{ type: 'isp', geolocation: { country: 'de' } }] });

    expect(sdk.createProxy).toHaveBeenCalledWith({
      type: 'isp',
      name: 'computesdk-isp-de',
      config: { country: 'DE' },
    });
  });

  it('falls back to default egress when the proxy cannot be resolved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sdk.listProxies.mockRejectedValueOnce(new Error('boom'));
    const provider = kernel({ apiKey: 'test-fallback' });

    await provider.session.create({ stealth: true, proxies: true });

    expect(sdk.create).toHaveBeenCalledWith({ stealth: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('maps keepAlive to a long inactivity timeout unless timeout is set', async () => {
    const provider = kernel({ apiKey: 'test' });

    await provider.session.create({ keepAlive: true });
    expect(sdk.create).toHaveBeenLastCalledWith({ timeout_seconds: 3600 });

    await provider.session.create({ keepAlive: true, timeout: 120 });
    expect(sdk.create).toHaveBeenLastCalledWith({ timeout_seconds: 120 });

    await provider.session.create({ keepAlive: false });
    expect(sdk.create).toHaveBeenLastCalledWith({});
  });
});
