import { afterEach, describe, expect, it, vi } from 'vitest';
import { namespace } from '../index';

const createdInstance = {
  metadata: { instanceId: 'inst-123' },
  extendedMetadata: { commandServiceEndpoint: 'https://cmd.example.com' },
};

function mockFetch() {
  const calls: Array<{ url: string; body: any }> = [];
  const spy = vi.fn(async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return {
      ok: true,
      json: async () => createdInstance,
    } as any;
  });
  vi.stubGlobal('fetch', spy);
  return calls;
}

describe('namespace create deadline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sets the instance deadline from options.timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T15:30:00Z'));
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({ timeout: 6 * 60 * 60 * 1000 } as any);
    expect(calls[0].body.deadline).toBe('2026-10-02T21:30:00.000Z');
  });

  it('defaults the deadline to one hour when no timeout is passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T15:30:00Z'));
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({} as any);
    expect(calls[0].body.deadline).toBe('2026-10-02T16:30:00.000Z');
  });

  it('ignores nonpositive timeouts and uses the one-hour default', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T15:30:00Z'));
    const calls = mockFetch();
    const provider = namespace({ token: 'ns_test' });
    await provider.sandbox.create({ timeout: 0 } as any);
    await provider.sandbox.create({ timeout: -5000 } as any);
    expect(calls[0].body.deadline).toBe('2026-10-02T16:30:00.000Z');
    expect(calls[1].body.deadline).toBe('2026-10-02T16:30:00.000Z');
  });
});
