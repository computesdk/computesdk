import { describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'session-id', wsEndpoint: 'wss://hyperbrowser.example', status: 'active' })),
}));

vi.mock('@hyperbrowser/sdk', () => ({
  Hyperbrowser: class Hyperbrowser {
    sessions = {
      create: sdk.create,
    };
  },
}));

import { hyperbrowser } from '../index';

describe('hyperbrowser option mapping', () => {
  it('preserves explicit false stealth and proxy values', async () => {
    const provider = hyperbrowser({ apiKey: 'test' });

    await provider.session.create({
      stealth: false,
      proxies: false,
      viewport: { width: 1920, height: 1080 },
    });

    expect(sdk.create).toHaveBeenCalledWith({
      useStealth: false,
      useProxy: false,
      screen: { width: 1920, height: 1080 },
    });
  });
});
