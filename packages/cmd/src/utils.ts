import type { Command, ShellOptions } from './types.js';

/**
 * Escape a string for safe use in shell commands (escapes double quotes)
 * @example esc('path with "quotes"') // 'path with \\"quotes\\"'
 */
export function esc(s: string): string {
  return s.replace(/"/g, '\\"');
}

/**
 * Internal helper to build shell command
 */
export function buildShellCommand(shellBin: string, command: Command, options?: ShellOptions): Command {
  if (!options?.cwd && !options?.background) {
    return command;
  }

  let cmdStr = command.join(' ');

  // Apply nohup first, then cd - so nohup wraps the command, not cd
  if (options.background) {
    cmdStr = `nohup ${cmdStr} > /dev/null 2>&1 &`;
  }

  if (options.cwd) {
    const escapedCwd = esc(options.cwd);
    cmdStr = `cd "${escapedCwd}" && ${cmdStr}`;
  }

  return [shellBin, '-c', cmdStr];
}
