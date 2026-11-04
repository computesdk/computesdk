import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProviderSuiteAttempt } from '../provider-suite-attempt';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const sandbox = () => ({ destroy: vi.fn(async () => {}) });

describe('provider-suite attempt ownership and bounded cleanup (no adapters)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('clears both deadline timers after successful creation and cleanup', async () => {
    vi.useFakeTimers();
    const instance = sandbox();
    const attempt = createProviderSuiteAttempt(async () => instance, 50, 20);
    expect(await attempt.ready).toBe(instance);
    expect(vi.getTimerCount()).toBe(0);
    await attempt.cleanup();
    await attempt.cleanup();
    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reuse a previous attempt when creation fails, and clears rejection timers', async () => {
    vi.useFakeTimers();
    const previous = sandbox();
    const first = createProviderSuiteAttempt(async () => previous, 50, 20);
    await first.ready;
    await first.cleanup();
    const failed = createProviderSuiteAttempt(() => { throw new Error('native-secret'); }, 50, 20);
    await expect(failed.ready).rejects.toThrow('Sandbox creation failed or timed out');
    await failed.cleanup();
    expect(previous.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('surfaces failed cleanup without leaking native errors and clears its timer', async () => {
    vi.useFakeTimers();
    const attempt = createProviderSuiteAttempt(async () => ({
      destroy: async () => { throw new Error('native-secret'); },
    }), 50, 20);
    await attempt.ready;
    await expect(attempt.cleanup()).rejects.toThrow(/^Sandbox cleanup failed or timed out$/);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds hung cleanup and leaves no deadline timer', async () => {
    vi.useFakeTimers();
    const attempt = createProviderSuiteAttempt(async () => ({ destroy: () => new Promise<void>(() => {}) }), 50, 20);
    await attempt.ready;
    const failure = expect(attempt.cleanup()).rejects.toThrow('Sandbox cleanup failed or timed out');
    await vi.advanceTimersByTimeAsync(20);
    await failure;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans a late create on its own attempt without replacing the next sandbox', async () => {
    vi.useFakeTimers();
    const pending = deferred<ReturnType<typeof sandbox>>();
    const late = sandbox();
    const verifyLateCleanup = vi.fn(async (owned: typeof late) => { expect(owned).toBe(late); });
    const first = createProviderSuiteAttempt(() => pending.promise, 10, 20, verifyLateCleanup);
    const creationFailure = expect(first.ready).rejects.toThrow('Sandbox creation failed or timed out');
    await vi.advanceTimersByTimeAsync(10);
    await creationFailure;
    const cleanup = first.cleanup();
    const nextInstance = sandbox();
    const next = createProviderSuiteAttempt(async () => nextInstance, 10, 20);
    expect(await next.ready).toBe(nextInstance);
    pending.resolve(late);
    await cleanup;
    await first.cleanup();
    expect(late.destroy).toHaveBeenCalledTimes(1);
    expect(verifyLateCleanup).toHaveBeenCalledTimes(1);
    expect(nextInstance.destroy).not.toHaveBeenCalled();
    expect(await next.ready).toBe(nextInstance);
    await next.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports unresolved allocation cleanup as failure, while still observing a later destroy', async () => {
    vi.useFakeTimers();
    const pending = deferred<ReturnType<typeof sandbox>>();
    const first = createProviderSuiteAttempt(() => pending.promise, 10, 20);
    const creationFailure = expect(first.ready).rejects.toThrow('Sandbox creation failed or timed out');
    await vi.advanceTimersByTimeAsync(10);
    await creationFailure;
    const cleanupFailure = expect(first.cleanup()).rejects.toThrow('Sandbox cleanup failed or timed out');
    await vi.advanceTimersByTimeAsync(20);
    await cleanupFailure;
    const late = sandbox();
    late.destroy.mockRejectedValue(new Error('native-secret'));
    pending.resolve(late);
    await vi.runAllTimersAsync();
    expect(late.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('verifies cleanup only after destroy, once for the exact owned sandbox', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const instance = { destroy: vi.fn(async () => { events.push('destroy'); }) };
    const verifyCleanup = vi.fn(async (owned: typeof instance) => {
      expect(owned).toBe(instance);
      events.push('verify');
    });
    const attempt = createProviderSuiteAttempt(async () => instance, 50, 20, verifyCleanup);
    await attempt.ready;
    await attempt.cleanup();
    await attempt.cleanup();
    expect(events).toEqual(['destroy', 'verify']);
    expect(verifyCleanup).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails closed when destroy acknowledges but cleanup verification rejects', async () => {
    vi.useFakeTimers();
    const instance = sandbox();
    const verifyCleanup = vi.fn(async () => { throw new Error('native-secret-verification'); });
    const attempt = createProviderSuiteAttempt(async () => instance, 50, 20, verifyCleanup);
    await attempt.ready;
    await expect(attempt.cleanup()).rejects.toThrow(/^Sandbox cleanup failed or timed out$/);
    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(verifyCleanup).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('includes post-destroy verification in the same cleanup deadline, not a second budget', async () => {
    vi.useFakeTimers();
    const instance = { destroy: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 15))) };
    const verifyCleanup = vi.fn(() => new Promise<void>(() => {}));
    const attempt = createProviderSuiteAttempt(async () => instance, 50, 20, verifyCleanup);
    await attempt.ready;
    const outcome = attempt.cleanup().then(
      () => undefined,
      (error: Error) => error,
    );
    await vi.advanceTimersByTimeAsync(15);
    expect(verifyCleanup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5);
    expect(await outcome).toEqual(new Error('Sandbox cleanup failed or timed out'));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not verify absence after destroy itself rejects', async () => {
    vi.useFakeTimers();
    const instance = { destroy: vi.fn(async () => { throw new Error('native-secret-destroy'); }) };
    const verifyCleanup = vi.fn(async () => {});
    const attempt = createProviderSuiteAttempt(async () => instance, 50, 20, verifyCleanup);
    await attempt.ready;
    await expect(attempt.cleanup()).rejects.toThrow('Sandbox cleanup failed or timed out');
    expect(verifyCleanup).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('observes the exact owned sandbox before original destroy and verification', async () => {
    const events: string[] = [];
    const instance = { destroy: vi.fn(async () => { events.push('destroy'); }) };
    const started = vi.fn((owned: typeof instance) => {
      expect(owned).toBe(instance);
      events.push('started');
    });
    const attempt = createProviderSuiteAttempt(async () => instance, 50, 20,
      async () => { events.push('verified'); }, { started });
    await attempt.ready;
    await attempt.cleanup();
    await attempt.cleanup();
    expect(events).toEqual(['started', 'destroy', 'verified']);
    expect(started).toHaveBeenCalledTimes(1);
    expect(instance.destroy).toHaveBeenCalledTimes(1);
  });

  it('observes the unchanged original destroy rejection, not a cleanup verification error', async () => {
    const original = new Error('native-private-error');
    const rejected = vi.fn((_owned: { destroy(): Promise<void> }, error: unknown) => {
      expect(error).toBe(original);
      throw new Error('observer-private-error');
    });
    const failed = { destroy: async () => { throw original; } };
    const attempt = createProviderSuiteAttempt(async () => failed, 50, 20, undefined, { rejected });
    await attempt.ready;
    await expect(attempt.cleanup()).rejects.toThrow(/^Sandbox cleanup failed or timed out$/);
    expect(rejected).toHaveBeenCalledWith(failed, original);
    const verified = sandbox();
    const verification = createProviderSuiteAttempt(async () => verified, 50, 20,
      async () => { throw new Error('verification-private-error'); }, { rejected });
    await verification.ready;
    await expect(verification.cleanup()).rejects.toThrow(/^Sandbox cleanup failed or timed out$/);
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it('still destroys and verifies when the synchronous started observer throws', async () => {
    const instance = sandbox();
    const verify = vi.fn(async () => {});
    const rejected = vi.fn();
    const attempt = createProviderSuiteAttempt(async () => instance, 50, 20, verify, {
      started: () => { throw new Error('observer-private-error'); }, rejected,
    });
    await attempt.ready;
    await expect(attempt.cleanup()).rejects.toThrow(/^Sandbox cleanup failed or timed out$/);
    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(instance);
    expect(rejected).not.toHaveBeenCalled();
  });

  it('observes a late owned allocation once without observing a different attempt', async () => {
    vi.useFakeTimers();
    const pending = deferred<ReturnType<typeof sandbox>>();
    const started = vi.fn();
    const attempt = createProviderSuiteAttempt(() => pending.promise, 10, 20, undefined, { started });
    const failure = expect(attempt.ready).rejects.toThrow('Sandbox creation failed or timed out');
    await vi.advanceTimersByTimeAsync(10);
    await failure;
    const cleanup = attempt.cleanup();
    const nextInstance = sandbox();
    const next = createProviderSuiteAttempt(async () => nextInstance, 10, 20);
    await next.ready;
    const late = sandbox();
    pending.resolve(late);
    await cleanup;
    await attempt.cleanup();
    expect(started).toHaveBeenCalledTimes(1);
    expect(started).toHaveBeenCalledWith(late);
    expect(late.destroy).toHaveBeenCalledTimes(1);
    expect(nextInstance.destroy).not.toHaveBeenCalled();
    await next.cleanup();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not await an accidentally async observer and observes its rejection safely', async () => {
    vi.useFakeTimers();
    const instance = sandbox();
    const pending = deferred<void>();
    const observer = pending.promise.then(() => { throw new Error('observer-private-error'); });
    const attempt = createProviderSuiteAttempt(async () => instance, 50, 20, undefined, {
      started: () => observer,
    });
    await attempt.ready;
    await expect(attempt.cleanup()).rejects.toThrow(/^Sandbox cleanup failed or timed out$/);
    expect(instance.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    pending.resolve();
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  });

});
