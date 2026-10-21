/**
 * Utility functions for ComputeSDK
 */

/**
 * Calculate exponential backoff delay with jitter
 * 
 * Uses exponential backoff (2^attempt) multiplied by base delay,
 * plus random jitter to prevent thundering herd.
 * 
 * @param attempt - Current retry attempt (0-indexed)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @param jitterMax - Maximum random jitter in milliseconds (default: 100)
 * @returns Delay in milliseconds
 * 
 * @example
 * ```typescript
 * // First retry: 1000-1100ms
 * calculateBackoff(0);
 * 
 * // Second retry: 2000-2100ms
 * calculateBackoff(1);
 * 
 * // Third retry: 4000-4100ms
 * calculateBackoff(2);
 * ```
 */
export function calculateBackoff(
  attempt: number,
  baseDelay: number = 1000,
  jitterMax: number = 100
): number {
  return baseDelay * Math.pow(2, attempt) + Math.random() * jitterMax;
}

/**
 * Escapes a string for safe use in shell commands
 * 
 * Escapes special shell characters to prevent command injection.
 * Use this when interpolating user-controlled values into shell commands.
 * 
 * @param arg - The string to escape
 * @returns Escaped string safe for shell interpolation
 * 
 * @example
 * ```typescript
 * const path = '/path/with spaces';
 * const command = `cd "${escapeShellArg(path)}" && ls`;
 * // Result: cd "/path/with\ spaces" && ls
 * 
 * const env = { KEY: 'value with $pecial chars' };
 * const command = `KEY="${escapeShellArg(env.KEY)}" npm run build`;
 * // Result: KEY="value with \$pecial chars" npm run build
 * ```
 */
export function escapeShellArg(arg: string): string {
  return arg
    .replace(/\\/g, '\\\\')  // Escape backslashes
    .replace(/"/g, '\\"')    // Escape double quotes
    .replace(/\$/g, '\\$')   // Escape dollar signs (variable expansion)
    .replace(/`/g, '\\`');   // Escape backticks (command substitution)
}

/**
 * Resolved identity of a `string | Volume` reference — providers pick the
 * field their API addresses volumes by.
 */
export interface VolumeRef {
  id?: string;
  name?: string;
  native?: unknown;
}

/**
 * Normalize a volume reference from `VolumeMount.volume`, `attachVolume`, or
 * `detachVolume`: a plain string (id or name, per provider) or a `Volume`
 * handle from `provider.volume`/`compute.volume` (which may carry `native`).
 */
export function resolveVolumeRef(volume: string | VolumeRef): VolumeRef {
  if (typeof volume === 'string') return { id: volume, name: volume };
  return {
    id: typeof volume?.id === 'string' ? volume.id : undefined,
    name: typeof volume?.name === 'string' ? volume.name : undefined,
    native: volume?.native,
  };
}

const VOLUME_ATTACHED_RE = /attached|mounted|in.?use|busy|in_use|still in use/i;

/**
 * Best-effort text of a thrown value. Providers throw plain API error
 * objects (`{error: "Volume is attached"}`) as often as real Errors —
 * String(err) on those is the useless "[object Object]".
 */
export function errorText(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error && err.message) parts.push(err.message);
  if (typeof err === 'string') parts.push(err);
  if (typeof err === 'object' && err !== null) {
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') parts.push(json);
    } catch { /* unstringifiable */ }
  }
  return parts.join(' ') || String(err);
}

/**
 * Retry a volume operation while the provider reports the volume still
 * attached. `sandbox.destroy()` returns before the control plane finishes
 * unmounting, so a volume delete issued right after can 400/409 on a volume
 * that detaches moments later — callers get a settled answer instead of
 * racing the provider's async detach.
 */
export async function withVolumeSettle<T>(
  fn: () => Promise<T>,
  options?: { deadlineMs?: number; intervalMs?: number },
): Promise<T> {
  const deadline = Date.now() + (options?.deadlineMs ?? 120_000);
  const intervalMs = options?.intervalMs ?? 3_000;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const text = errorText(err);
      if (!VOLUME_ATTACHED_RE.test(text) || Date.now() >= deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}
