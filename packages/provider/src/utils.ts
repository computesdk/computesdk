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
 * Build a shell command string with optional cwd and env support
 *
 * Produces a properly ordered and escaped shell command where all parts
 * are chained with && so a failure in cd or export stops execution:
 *   cd "/dir" && export KEY="val" && <command>
 *
 * @param command - The shell command to run
 * @param options - Optional cwd and env
 * @param escapeFn - Optional custom escape function (defaults to escapeShellArg)
 * @returns Escaped shell command string
 * @throws Error if env keys contain invalid characters (must match ^[A-Za-z_][A-Za-z0-9_]*$)
 *
 * @example
 * ```typescript
 * buildShellCommand('npm run build', { cwd: '/my app', env: { NODE_ENV: 'production' } })
 * // Result: cd "/my\ app" && export NODE_ENV="production" && npm run build
 * ```
 */
const SAFE_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function buildShellCommand(
  command: string,
  options?: { cwd?: string; env?: Record<string, string> },
  escapeFn: (arg: string) => string = escapeShellArg
): string {
  let shell = command;

  if (options?.env && Object.keys(options.env).length > 0) {
    const exports = Object.entries(options.env)
      .map(([k, v]) => {
        if (!SAFE_ENV_KEY.test(k)) {
          throw new Error(`Invalid environment variable name: ${k}`);
        }
        return `export ${k}="${escapeFn(v)}"`;
      })
      .join(' && ');
    shell = `${exports} && ${shell}`;
  }

  if (options?.cwd) {
    shell = `cd "${escapeFn(options.cwd)}" && ${shell}`;
  }

  return shell;
}
