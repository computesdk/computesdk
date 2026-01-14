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
