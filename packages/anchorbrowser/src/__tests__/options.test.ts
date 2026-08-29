import { describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  create: vi.fn(async () => ({ data: { id: 'session-id', cdp_url: 'wss://anchor.example' } })),
}));

vi.mock('anchorbrowser', () => ({
  default: class Anchorbrowser {
    sessions = {
      create: sdk.create,
    };
  },
}));

import { anchorbrowser } from '../index';

describe('anchorbrowser option mapping', () => {
  it('preserves explicit false stealth and proxy values', async () => {
    const provider = anchorbrowser({ apiKey: 'test' });

    await provider.session.create({
      stealth: false,
      proxies: false,
      viewport: { width: 1920, height: 1080 },
    });

    expect(sdk.create).toHaveBeenCalledWith({
      browser: {
        viewport: { width: 1920, height: 1080 },
        extra_stealth: { active: false },
      },
      session: {
        proxy: { active: false, type: 'anchor_proxy' },
      },
    });
  });
});
