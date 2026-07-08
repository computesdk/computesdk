import { describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  create: vi.fn(async () => ({ id: 'session-id', websocketUrl: 'wss://steel.example', status: 'live' })),
}));

vi.mock('steel-sdk', () => ({
  default: class Steel {
    sessions = {
      create: sdk.create,
    };
  },
  toFile: vi.fn(),
}));

import { steel } from '../index';

describe('steel option mapping', () => {
  it('preserves explicit false stealth and proxy values', async () => {
    const provider = steel({ apiKey: 'test' });

    await provider.session.create({
      stealth: false,
      proxies: false,
      viewport: { width: 1920, height: 1080 },
    });

    expect(sdk.create).toHaveBeenCalledWith({
      dimensions: { width: 1920, height: 1080 },
      stealthConfig: { humanizeInteractions: false },
      useProxy: false,
    });
  });
});
