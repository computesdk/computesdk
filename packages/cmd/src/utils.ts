import type { Command, ShellOptions } from './types.js';

/**
 * Escape a string for safe use in shell commands using single quotes.
 * This is the safest method as single quotes preserve all characters literally,
 * except for single quotes themselves which must be handled specially.
 *
 * @example shellEscape("hello world") // "'hello world'"
 * @example shellEscape("it's here") // "'it'\\''s here'"
 * @example shellEscape("$HOME") // "'$HOME'" (no variable expansion)
 */
export function shellEscape(s: string): string {
  // Wrap in single quotes and escape any embedded single quotes
  // 'foo'bar' becomes 'foo'\''bar' (end quote, escaped quote, start quote)
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Escape a string for use inside double quotes.
 *
 * This is a legacy helper kept for backward compatibility; for new code,
 * prefer {@link shellEscape} which uses single-quoted, safer shell escaping.
 *
 * @example esc('path with "quotes"') // 'path with \\"quotes\\"'
 * @deprecated Use {@link shellEscape} for safer escaping. This function only escapes
 *   double quotes and may not be safe for all shell contexts. Migration: replace
 *   `esc(str)` with `shellEscape(str)`.
 */
export function esc(s: string): string {
  return s.replace(/"/g, '\\"');
}

/**
 * Escape each argument in a command array and join them with spaces.
 * Arguments that are safe (alphanumeric, dash, underscore, dot, slash, colon, equals)
 * are left unquoted for readability.
 *
 * @example escapeArgs(['npm', 'install', 'express']) // 'npm install express'
 * @example escapeArgs(['echo', 'hello world']) // "echo 'hello world'"
 * @example escapeArgs(['cp', 'file with spaces.txt', '/dest']) // "cp 'file with spaces.txt' /dest"
 */
export function escapeArgs(args: string[]): string {
  return args.map(arg => {
    // If arg contains only safe characters, no escaping needed
    if (/^[a-zA-Z0-9_./:=@-]+$/.test(arg) && arg.length > 0) {
      return arg;
    }
    // Otherwise, use shellEscape for safety
    return shellEscape(arg);
  }).join(' ');
}

/**
 * Internal helper to build shell command with proper escaping
 */
export function buildShellCommand(shellBin: string, command: Command, options?: ShellOptions): Command {
  if (!options?.cwd && !options?.background) {
    return command;
  }

  let cmdStr = escapeArgs(command);

  // Build command: first wrap with nohup if background, then prepend cd if cwd
  // Result: cd '/path' && nohup cmd > /dev/null 2>&1 &
  if (options.background) {
    cmdStr = `nohup ${cmdStr} > /dev/null 2>&1 &`;
  }

  if (options.cwd) {
    cmdStr = `cd ${shellEscape(options.cwd)} && ${cmdStr}`;
  }

  return [shellBin, '-c', cmdStr];
}
