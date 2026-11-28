import { describe, expect, it, vi } from 'vitest';
import { kubi, lifetimeSeconds } from '../index';

describe('kubi provider', () => {
  it('turns a ComputeSDK timeout into a Kubi end time, within 60 s and 30 days', () => {
    expect(lifetimeSeconds(300_000)).toBe(300);
    expect(lifetimeSeconds(1_500)).toBe(60);
    expect(lifetimeSeconds(90_001)).toBe(91);
    expect(lifetimeSeconds(10 * 2_592_000_000)).toBe(2_592_000);
  });

  it('names itself kubi', () => {
    expect(kubi({ apiKey: 'test' }).name).toBe('kubi');
  });

  it('asks for a key when none is set', async () => {
    const saved = process.env.KUBI_API_KEY;
    delete process.env.KUBI_API_KEY;
    try {
      await expect(kubi({}).instances.create()).rejects.toThrow(/Missing Kubi API key/);
    } finally {
      if (saved !== undefined) process.env.KUBI_API_KEY = saved;
    }
  });

  it('refuses a bad env name before creating a screen', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await expect(kubi({ apiKey: 'test' }).instances.create({ envs: { 'BAD-NAME': 'x' } })).rejects.toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
