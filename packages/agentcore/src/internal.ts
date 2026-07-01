/**
 * Pure, side-effect-free helpers for the AgentCore provider.
 *
 * Kept in a separate module so they can be unit-tested without AWS credentials —
 * these functions hold the trickiest logic (shell escaping, command wrapping,
 * marker parsing, error classification) and benefit from direct coverage.
 */

import type { RunCommandOptions } from 'computesdk';

/** AgentCore session timeout bounds (seconds), per the StartCodeInterpreterSession API. */
export const MIN_SESSION_TIMEOUT_SECONDS = 1;
export const MAX_SESSION_TIMEOUT_SECONDS = 28800; // 8 hours

/**
 * POSIX single-quote a string for safe shell interpolation. Single quotes
 * disable all expansion ($, backticks, etc.); an embedded `'` is closed,
 * escaped, and reopened. Safe for any path or value, unlike double quotes.
 *
 * We intentionally use this instead of `escapeShellArg` from `@computesdk/provider`:
 * that helper targets double-quote contexts and does not neutralize spaces or
 * shell metacharacters, whereas single-quoting is safe for arbitrary user paths.
 */
export function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Clamp a requested session timeout into the API's accepted range so `create`
 * fails friendly (or just works) instead of surfacing a raw ValidationException.
 */
export function clampSessionTimeout(seconds: number): number {
  if (!Number.isFinite(seconds)) return MAX_SESSION_TIMEOUT_SECONDS;
  return Math.min(MAX_SESSION_TIMEOUT_SECONDS, Math.max(MIN_SESSION_TIMEOUT_SECONDS, Math.ceil(seconds)));
}

/**
 * Build the shell command from the user command plus env/cwd/background options.
 * Throws on an invalid environment variable name.
 */
export function buildCommand(command: string, options?: RunCommandOptions): string {
  let full = command;
  // Apply env first so the variables bind to the actual command, then wrap in
  // cwd. (Prefixing env onto a `cd ... && cmd` would only export it to `cd`.)
  if (options?.env && Object.keys(options.env).length > 0) {
    const envPrefix = Object.entries(options.env)
      .map(([k, v]) => {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) {
          throw new Error(`Invalid environment variable name: ${k}`);
        }
        return `${k}=${sq(String(v))}`;
      })
      .join(' ');
    full = `${envPrefix} ${full}`;
  }
  if (options?.cwd) full = `cd ${sq(options.cwd)} && ${full}`;
  // Background: detach so the call returns immediately with exit code 0. Note that
  // AgentCore tears down the process tree when the invocation returns, so a
  // backgrounded job does not survive past this call (see README limitations).
  if (options?.background) full = `nohup ${full} > /dev/null 2>&1 &`;
  return full;
}

/**
 * Wrap a command so its stdout, stderr, and exit code can be recovered faithfully.
 *
 * AgentCore runs commands through a PTY, which (a) merges stderr into stdout and
 * (b) reports the *tool's* success, not the command's exit code — a failing
 * command otherwise loses its stdout entirely. So we redirect the command's
 * streams to temp files inside a subshell, then emit the exit code plus base64 of
 * each stream. base64 also side-steps PTY CRLF mangling, so output is byte-exact.
 * The `tag` (a UUID) namespaces the markers and temp files so concurrent calls on
 * one session can't collide. (The k8s provider uses the same exit-code marker technique.)
 */
export function wrapForCapture(inner: string, tag: string): string {
  const out = `/tmp/.csdk-${tag}.out`;
  const err = `/tmp/.csdk-${tag}.err`;
  // Subshell so the command's own `exit N` can't terminate the wrapper.
  return (
    `( ${inner} ) >${out} 2>${err}; __rc=$?; ` +
    `printf 'CSDKrc${tag}=%s\\n' "$__rc"; base64 ${out}; echo CSDKsep${tag}; base64 ${err}; rm -f ${out} ${err}`
  );
}

/**
 * Parse the wrapper's output — `CSDKrc<tag>=<code>` then `<base64 stdout>`,
 * a `CSDKsep<tag>` separator, then `<base64 stderr>` — into a clean result.
 * If the markers are absent (unexpected shell failure), fall back to returning
 * the raw text as stdout. Tolerates the PTY's CRLF around markers; base64
 * payloads are whitespace-stripped.
 */
export function parseWrappedResult(
  raw: string,
  tag: string,
): { stdout: string; stderr: string; exitCode: number } {
  const rc = raw.match(new RegExp(`CSDKrc${tag}=(\\d+)`));
  if (!rc) {
    return { stdout: raw, stderr: '', exitCode: raw.trim() ? 1 : 0 };
  }
  const exitCode = Number(rc[1]);
  const [outB64, errB64] = raw.slice(rc.index! + rc[0].length).split(new RegExp(`CSDKsep${tag}`));
  const decode = (b64?: string) => Buffer.from((b64 ?? '').replace(/\s/g, ''), 'base64').toString('utf8');
  return { stdout: decode(outB64), stderr: decode(errB64), exitCode };
}

/** Wrap opaque AWS SDK errors with actionable ComputeSDK guidance. */
export function friendlyError(action: string, error: unknown): Error {
  const name = (error as { name?: string })?.name ?? '';
  const message = error instanceof Error ? error.message : String(error);
  const matches = (pattern: RegExp) => pattern.test(name) || pattern.test(message);

  if (matches(/Region is missing/i)) {
    return new Error(
      `Missing AWS region for AgentCore.\n\n` +
        `Pass it: agentcore({ region: 'us-west-2' })\n` +
        `Or set AWS_REGION / AWS_DEFAULT_REGION, or a region in your AWS profile.`,
    );
  }
  if (matches(/Credentials|security token|UnrecognizedClient|ExpiredToken|could not load credentials/i)) {
    return new Error(
      `AWS authentication failed for AgentCore. Check your credentials ` +
        `(env vars, SSO session, or profile) and that they are not expired.\n${message}`,
    );
  }
  if (matches(/AccessDenied|not authorized/i)) {
    return new Error(
      `Access denied ${action}. Ensure your IAM principal allows the ` +
        `bedrock-agentcore:*CodeInterpreter* and InvokeCodeInterpreter actions.\n${message}`,
    );
  }
  return new Error(`Failed ${action}: ${message}`);
}
