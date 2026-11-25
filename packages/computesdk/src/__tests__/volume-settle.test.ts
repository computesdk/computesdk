import { describe, expect, it, vi } from 'vitest';
import { withVolumeSettle } from '../provider/utils';

describe('withVolumeSettle', () => {
  it('retries while the provider reports the volume still attached', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ code: 'VOLUME_ALREADY_ATTACHED', message: 'Volume already attached to sandbox:old' })
      .mockResolvedValueOnce('mounted');
    await expect(withVolumeSettle(fn, { intervalMs: 1 })).resolves.toBe('mounted');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows at once an attachment error the provider marks as held', async () => {
    const err = Object.assign(new Error('Volume already attached to sandbox:live, which still runs'), { volumeHeld: true });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withVolumeSettle(fn, { intervalMs: 1, deadlineMs: 60_000 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('still retries an attachment error that is only marked not retryable', async () => {
    // Platform API errors carry retryable: false for any 4xx; that is not a
    // statement about the volume, so the settle loop keeps waiting.
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('409 volume still attached'), { retryable: false }))
      .mockResolvedValueOnce('mounted');
    await expect(withVolumeSettle(fn, { intervalMs: 1 })).resolves.toBe('mounted');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('rethrows an unrelated error without retrying', async () => {
    const err = new Error('quota exceeded');
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withVolumeSettle(fn, { intervalMs: 1 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
