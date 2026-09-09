/**
 * The boot gate.
 *
 * `create` deliberately returns while the sandbox is still starting, because
 * Buddy queues commands submitted against a starting sandbox. Two other groups
 * of endpoints do not queue:
 *
 * - the content endpoints answer 400 "Instance is not running", or answer 2xx to
 *   a write whose bytes never land (observed roughly once in twelve sandboxes);
 * - `updateSandbox` answers 400 "Cannot update sandbox, operation in progress".
 *
 * So those calls wait here for `RUNNING` + `setup_status: SUCCESS` once per
 * sandbox, and retry the two races until the deadline.
 */

import {
  getSandboxData,
  isInstanceNotRunning,
  isOperationInProgress,
  sleep,
  type BuddySandboxHandle,
} from './utils.js';

/** Long enough to cover a drained warm pool; a real boot failure surfaces sooner. */
const BOOT_WAIT_TIMEOUT_MS = 90_000;
const BOOT_WAIT_POLL_MS = 250;

/** Sandboxes already known to have booted — the gate runs at most once each. */
const settled = new WeakSet<BuddySandboxHandle>();

export async function untilSettled(sandbox: BuddySandboxHandle): Promise<void> {
  if (settled.has(sandbox)) return;

  const deadline = Date.now() + BOOT_WAIT_TIMEOUT_MS;
  for (;;) {
    const data = await getSandboxData(sandbox.config, sandbox.sandboxId);
    if (data.status === 'RUNNING' && data.setup_status === 'SUCCESS') {
      settled.add(sandbox);
      return;
    }
    if (data.status === 'FAILED' || data.setup_status === 'FAILED') {
      throw new Error(
        `Buddy sandbox ${sandbox.sandboxId} failed to start ` +
        `(status: ${data.status}, setup: ${data.setup_status}).`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Buddy sandbox ${sandbox.sandboxId} was still starting after ` +
        `${BOOT_WAIT_TIMEOUT_MS / 1000}s (status: ${data.status}, setup: ${data.setup_status}).`,
      );
    }
    await sleep(BOOT_WAIT_POLL_MS);
  }
}

/**
 * Runs an operation once the sandbox has booted, retrying the races that remain
 * afterwards — Buddy reports a snapshot or app operation still in flight the
 * same way.
 */
export async function whenBooted<T>(
  sandbox: BuddySandboxHandle,
  operation: () => Promise<T>,
): Promise<T> {
  await untilSettled(sandbox);

  const deadline = Date.now() + BOOT_WAIT_TIMEOUT_MS;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      const retryable = isInstanceNotRunning(error) || isOperationInProgress(error);
      if (!retryable || Date.now() >= deadline) throw error;
      await sleep(BOOT_WAIT_POLL_MS);
    }
  }
}
