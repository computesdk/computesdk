import { describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  create: vi.fn(async () => ({ session_id: 'session-id', cdp_ws_url: 'wss://kernel.example' })),
}));

vi.mock('@onkernel/sdk', () => ({
  default: class Kernel {
    browsers = {
      create: sdk.create,
    };
  },
}));

import { kernel } from '../index';

describe('kernel option mapping', () => {
  it('preserves explicit stealth false and warns for unsupported proxies', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = kernel({ apiKey: 'test' });

    await provider.session.create({
      stealth: false,
      proxies: false,
      viewport: { width: 1920, height: 1080 },
    });

    expect(sdk.create).toHaveBeenCalledWith({
      stealth: false,
      viewport: { width: 1920, height: 1080 },
    });
    expect(warn).toHaveBeenCalledWith("[@computesdk/kernel] 'proxies' is ignored: Kernel create-browser supports only a provider proxy_id, which BrowserSessionCreateOptions cannot express.");

    warn.mockRestore();
  });
});
