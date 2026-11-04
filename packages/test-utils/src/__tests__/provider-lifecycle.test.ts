import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForSandboxAbsence, withDeadline } from '../provider-lifecycle';

describe('private lifecycle deadlines (no provider SDK)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears its timer when an operation succeeds', async () => {
    await expect(withDeadline(async () => 'ok', 100, 'safe')).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sanitizes asynchronous and synchronous native failures and clears timers', async () => {
    for (const operation of [
      () => Promise.reject(new Error('NATIVE_SECRET')),
      () => { throw new Error('NATIVE_SECRET'); },
    ]) {
      const error = await withDeadline(operation, 100, 'safe failure').catch((error) => error);
      expect(error.message).toBe('safe failure');
      expect(error.cause).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it('bounds a hung operation and observes a rejection arriving after its deadline', async () => {
    let rejectLate!: (error: Error) => void;
    const running = withDeadline(() => new Promise((_, reject) => { rejectLate = reject; }), 100, 'safe deadline');
    const assertion = expect(running).rejects.toThrow('safe deadline');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    rejectLate(new Error('NATIVE_SECRET'));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts only null, polling eventual absence without an initial sleep', async () => {
    const get = vi.fn().mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'deleting' }).mockResolvedValueOnce(null);
    const running = waitForSandboxAbsence(get, { timeoutMs: 100, pollIntervalMs: 10, failureMessage: 'not absent' });
    await vi.advanceTimersByTimeAsync(0);
    expect(get).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20);
    await running;
    expect(get).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([undefined, false, { status: 'running' }, { status: 'deleting' }])(
    'fails unverified value %j at the overall deadline without leftover timers',
    async (value) => {
      const get = vi.fn().mockResolvedValue(value);
      const running = waitForSandboxAbsence(get, { timeoutMs: 25, pollIntervalMs: 10, failureMessage: 'not absent' });
      const assertion = expect(running).rejects.toThrow('not absent');
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
      expect(get).toHaveBeenCalledTimes(3);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not let a hanging query bypass the overall verification deadline', async () => {
    const get = vi.fn(() => new Promise<never>(() => {}));
    const running = waitForSandboxAbsence(get, { timeoutMs: 25, pollIntervalMs: 10, failureMessage: 'query deadline' });
    const assertion = expect(running).rejects.toThrow('query deadline');
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(get).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a sanitized query failure immediately, without retrying it into absence', async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error('NATIVE_SECRET')).mockResolvedValue(null);
    await expect(waitForSandboxAbsence(get, {
      timeoutMs: 25, pollIntervalMs: 10, failureMessage: 'query failed',
    })).rejects.toThrow('query failed');
    expect(get).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid deadline %s without calling the provider', async (timeoutMs) => {
    const get = vi.fn().mockResolvedValue(null);
    await expect(waitForSandboxAbsence(get, {
      timeoutMs, pollIntervalMs: 10, failureMessage: 'safe',
    })).rejects.toThrow('finite positive');
    expect(get).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
