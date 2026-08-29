import { describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'session-id', cdpUrl: 'https://browseruse.example', status: 'active' })),
}));

vi.mock('browser-use-sdk/v3', () => ({
  BrowserUse: class BrowserUse {
    browsers = {
      create: sdk.create,
    };
  },
}));

import { browseruse } from '../index';

describe('browseruse option mapping', () => {
  it('preserves explicit proxy false and warns for unsupported stealth', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = browseruse({ apiKey: 'test' });

    await provider.session.create({
      stealth: false,
      proxies: false,
      viewport: { width: 1920, height: 1080 },
    });

    expect(sdk.create).toHaveBeenCalledWith({
      browserScreenWidth: 1920,
      browserScreenHeight: 1080,
      proxyCountryCode: null,
    });
    expect(warn).toHaveBeenCalledWith("[@computesdk/browseruse] 'stealth' is ignored: Browser Use does not expose a per-session stealth toggle.");

    warn.mockRestore();
  });
});
