import { describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  sessionStart: vi.fn(async () => ({ data: { session_id: 'session-id', cdp_url: 'wss://notte.example', status: 'active' } })),
}));

vi.mock('notte-sdk', () => ({
  createClient: vi.fn(() => ({})),
  sessionStart: sdk.sessionStart,
  sessionStatus: vi.fn(),
  sessionStop: vi.fn(),
  listSessions: vi.fn(),
  profileCreate: vi.fn(),
  profileGet: vi.fn(),
  profileList: vi.fn(),
  profileDelete: vi.fn(),
}));

import { notte } from '../index';

describe('notte option mapping', () => {
  it('preserves explicit proxy false and warns for unsupported stealth', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = notte({ apiKey: 'test' });

    await provider.session.create({
      stealth: false,
      proxies: false,
      viewport: { width: 1920, height: 1080 },
    });

    expect(sdk.sessionStart).toHaveBeenCalledWith({
      client: {},
      body: {
        viewport_width: 1920,
        viewport_height: 1080,
        proxies: false,
      },
      throwOnError: true,
    });
    expect(warn).toHaveBeenCalledWith("[@computesdk/notte] 'stealth' is ignored: Notte does not expose a per-session stealth toggle.");

    warn.mockRestore();
  });
});
