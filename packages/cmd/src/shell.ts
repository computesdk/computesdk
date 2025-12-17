import type { Command, ShellOptions } from './types.js';
import { buildShellCommand } from './utils.js';

/**
 * Shell wrapper - callable function with shell-specific methods
 *
 * @example
 * // Default (sh)
 * shell(cmd.npm.install(), { cwd: '/app' })
 * // => ['sh', '-c', 'cd "/app" && npm install']
 *
 * @example
 * // Shell-specific
 * shell.bash(cmd.node('server.js'), { background: true })
 * // => ['bash', '-c', 'nohup node server.js > /dev/null 2>&1 &']
 *
 * @example
 * shell.zsh(cmd.npm.run('dev'), { cwd: '/app' })
 * // => ['zsh', '-c', 'cd "/app" && npm run dev']
 */
export const shell = Object.assign(
  // Default: use sh
  (command: Command, options?: ShellOptions): Command => {
    return buildShellCommand('sh', command, options);
  },
  {
    /** Wrap with sh (POSIX shell) */
    sh: (command: Command, options?: ShellOptions): Command => {
      return buildShellCommand('sh', command, options);
    },
    /** Wrap with bash */
    bash: (command: Command, options?: ShellOptions): Command => {
      return buildShellCommand('bash', command, options);
    },
    /** Wrap with zsh */
    zsh: (command: Command, options?: ShellOptions): Command => {
      return buildShellCommand('zsh', command, options);
    },
  }
);

// Individual shell exports
export const sh = shell.sh;
export const bash = shell.bash;
export const zsh = shell.zsh;
