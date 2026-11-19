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

  it('maps keepAlive to an idle timeout bounded by the max duration', async () => {
    const provider = notte({ apiKey: 'test' });
    const lastBody = (body: Record<string, unknown>) => expect.objectContaining({ body });

    await provider.session.create({ keepAlive: true });
    expect(sdk.sessionStart).toHaveBeenLastCalledWith(lastBody({ idle_timeout_minutes: 15 }));

    await provider.session.create({ keepAlive: true, timeout: 120 });
    expect(sdk.sessionStart).toHaveBeenLastCalledWith(lastBody({ max_duration_minutes: 2, idle_timeout_minutes: 2 }));

    await provider.session.create({ keepAlive: true, timeout: 3600 });
    expect(sdk.sessionStart).toHaveBeenLastCalledWith(lastBody({ max_duration_minutes: 60, idle_timeout_minutes: 30 }));

    await provider.session.create({ keepAlive: false });
    expect(sdk.sessionStart).toHaveBeenLastCalledWith(lastBody({}));
  });
});
