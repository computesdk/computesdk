/**
 * Internal ownership for one shared-suite test, not a provider cancellation API.
 * Deadlines observe promises; they cannot cancel a native allocation or destroy.
 */
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
          await sandbox.destroy();
          // A destroy acknowledgement alone need not establish SDK absence.
          // Caller-supplied verification shares this same cleanup deadline.
          await verifyCleanup?.(sandbox);
        }, () => undefined),
        cleanupTimeoutMs,
        'Sandbox cleanup failed or timed out',
      );
      return cleanup;
    },
  };
}
