/**
 * Internal lifecycle deadlines. A deadline observes (but cannot cancel) the
 * underlying operation; callers must retain ownership of allocated resources.
 */
function requirePositiveDuration(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Lifecycle durations must be finite positive milliseconds');
  }
}

/**
 * Bound an operation and replace native errors with a caller-supplied, safe
 * diagnostic. Never attach the native error as a cause: it may contain secrets.
 * Both branches remain observed when the deadline wins.
 */
export async function withDeadline<T>(
  operation: () => PromiseLike<T> | T,
  timeoutMs: number,
  failureMessage: string,
): Promise<T> {
  requirePositiveDuration(timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(failureMessage)), timeoutMs);
      }),
    ]);
  } catch {
    throw new Error(failureMessage);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface AbsenceVerificationOptions {
  timeoutMs: number;
  pollIntervalMs: number;
  /** Safe context only; do not include credentials or native error text. */
  failureMessage: string;
}

/**
 * Require SDK-reported absence (`getById() === null`), NOT physical deletion
 * proof. No inferred tombstone statuses, truthiness shortcuts, or swallowed
 * query errors. The budget includes every query, including a hanging one.
 */
export async function waitForSandboxAbsence(
  getById: () => Promise<unknown>,
  { timeoutMs, pollIntervalMs, failureMessage }: AbsenceVerificationOptions,
): Promise<void> {
  requirePositiveDuration(timeoutMs);
  requirePositiveDuration(pollIntervalMs);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(failureMessage);
    const result = await withDeadline(getById, remaining, failureMessage);
    if (Date.now() >= deadline) throw new Error(failureMessage);
    if (result === null) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(pollIntervalMs, deadline - Date.now()));
    });
  }
}
