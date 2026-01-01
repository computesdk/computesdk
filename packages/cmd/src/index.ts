/**
 * @computesdk/cmd - Type-safe shell command builders
 *
 * Build shell commands as tuples for use with sandbox.runCommand()
 *
 * @example
 * ```typescript
 * import { cmd, npm, node } from '@computesdk/cmd';
 *
 * await sandbox.runCommand(npm.install('express'));
 * await sandbox.runCommand(cmd.mkdir('/app/src'));
 * await sandbox.runCommand(node('server.js'), { background: true });
 * ```
 */

// Re-export types
export type { Command, ShellOptions } from './types.js';

// Re-export utilities
export { esc, shellEscape, escapeArgs, buildShellCommand } from './utils.js';

// Re-export shell wrappers
export { shell, sh, bash, zsh } from './shell.js';

// Import all commands for assembly
import * as filesystem from './commands/filesystem.js';
import * as process from './commands/process.js';
import * as packages from './commands/packages.js';
import * as gitCommands from './commands/git.js';
import * as network from './commands/network.js';
import * as text from './commands/text.js';
import * as archive from './commands/archive.js';
import * as system from './commands/system.js';
import * as computeCommands from './commands/compute.js';

import type { Command } from './types.js';
import { buildShellCommand } from './utils.js';

/**
 * Command builders for common shell operations
 * 
 * Namespace containing command builder functions for filesystem operations,
 * package managers, git, network utilities, and more.
 * 
 * For shell wrapping with cwd/background options, use `shell()` instead.
 *
 * @example
 * // Command builders
 * cmd.npm.install('express')
 * // => ['npm', 'install', 'express']
 * 
 * cmd.mkdir('/app/src')
 * // => ['mkdir', '-p', '/app/src']
 * 
 * @example
 * // For shell wrapping, use shell() instead
 * import { shell, npm } from '@computesdk/cmd';
 * shell(npm.install(), { cwd: '/app' })
 * // => ['sh', '-c', 'cd '/app' && npm install']
 */
export const cmd = {
  // Filesystem
  ...filesystem,
  // Process
  ...process,
  // Package managers
  ...packages,
  // Git
  ...gitCommands,
  // Network
  ...network,
  // Text processing
  ...text,
  // Archives
  ...archive,
  // System
  ...system,
  // Compute
  ...computeCommands,
};

// Export individual command builders for destructured imports
// Filesystem
export const {
  mkdir, rm, cp, mv, ls, pwd, chmod, chown, touch, cat, ln, readlink, test, rsync,
} = filesystem;

// Process
export const { node, python, kill, pkill, ps, timeout } = process;

// Package managers
export const { npm, pnpm, yarn, pip, bun, deno, npx, bunx, uv, poetry, pipx } = packages;

// Git
export const { git } = gitCommands;

// Network
export const { curl, wget, port, net } = network;

// Text processing
export const { grep, sed, head, tail, wc, sort, uniq, jq, xargs, awk, cut, tr } = text;

// Archives
export const { tar, unzip } = archive;

// System
export const {
  echo, env, printenv, which, whoami, uname, hostname,
  df, du, sleep, date, find, tee, diff, parallel, raw,
  base64, md5sum, sha256sum, sha1sum,
} = system;

// Compute
export const { compute } = computeCommands;

// Default export for convenience
export default cmd;
