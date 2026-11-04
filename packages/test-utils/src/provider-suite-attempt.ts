/**
 * Internal ownership for one shared-suite test, not a provider cancellation API.
 * Deadlines observe promises; they cannot cancel a native allocation or destroy.
 */
export interface ProviderSuiteCleanupObserver<T> {
  started?: (sandbox: T) => void;
  rejected?: (sandbox: T, error: unknown) => void;
}

/** Observe synchronously without letting diagnostic code block native cleanup. */
function notifyCleanupObserver<T>(
  observer: ProviderSuiteCleanupObserver<T>,
  phase: 'started' | 'rejected',
  sandbox: T,
  error?: unknown,
): boolean {
  try {
    const returned: unknown = phase === 'started'
      ? observer.started?.(sandbox)
      : observer.rejected?.(sandbox, error);
    if (returned !== null && (typeof returned === 'object' || typeof returned === 'function')
      && typeof (returned as PromiseLike<unknown>).then === 'function') {
      // These hooks must be synchronous. Observe accidental async rejection,
      // but never await it or extend native cleanup's existing deadline.
      void Promise.resolve(returned as PromiseLike<unknown>).catch(() => {});
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

async function withinSuiteDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } catch {
    // Native errors may include credentials. Keep the failure, not its secrets.
    throw new Error(message);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createProviderSuiteAttempt<T extends { destroy(): Promise<void> }>(
  create: () => Promise<T>,
  createTimeoutMs = 60_000,
  cleanupTimeoutMs = 10_000,
  verifyCleanup?: (sandbox: T) => Promise<void>,
  observeCleanup?: ProviderSuiteCleanupObserver<T>,
) {
  for (const duration of [createTimeoutMs, cleanupTimeoutMs]) {
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Suite lifecycle durations must be finite positive milliseconds');
    }
  }
  // Each attempt owns this promise, including after its creation deadline.
  const allocation = Promise.resolve().then(create);
  const ready = withinSuiteDeadline(allocation, createTimeoutMs, 'Sandbox creation failed or timed out');
  let cleanup: Promise<void> | undefined;
  return {
    ready,
    cleanup(): Promise<void> {
      // Retain the allocation even when setup fails. A late create is destroyed
      // by this continuation, never assigned to the next test's sandbox.
      // If it outlives the cleanup budget the test fails (ownership unresolved);
      // the continuation remains observed and still attempts late destruction.
      cleanup ??= withinSuiteDeadline(
        allocation.then(async (sandbox) => {
          const diagnosticFailed = observeCleanup
            ? notifyCleanupObserver(observeCleanup, 'started', sandbox)
            : false;
          try {
            await sandbox.destroy();
          } catch (error) {
            if (observeCleanup) notifyCleanupObserver(observeCleanup, 'rejected', sandbox, error);
            // Preserve the original SDK error for the observer; only the outer
            // deadline sanitizer controls the public test diagnostic.
            throw error;
          }
          // A destroy acknowledgement alone need not establish SDK absence.
          // Caller-supplied verification shares this same cleanup deadline.
          await verifyCleanup?.(sandbox);
          if (diagnosticFailed) throw new Error('Sandbox cleanup observer failed');
        }, () => undefined),
        cleanupTimeoutMs,
        'Sandbox cleanup failed or timed out',
      );
      return cleanup;
    },
  };
}
