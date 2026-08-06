/**
 * Command execution.
 *
 * Buddy accepts a command and returns its id immediately; output arrives over a
 * JSONL log stream. The provider consumes that stream once through the SDK's
 * `Command` entity, splits it into stdout/stderr and forwards chunks to the
 * streaming callbacks, then reads the exit code from the command details.
 * `Command.wait()` is deliberately unused — it polls once a second, which would
 * add up to a second to every call.
 */

import { Command } from '@buddy-works/sandbox-sdk';
import { escapeShellArg } from '@computesdk/provider';
import type { CommandResult, RunCommandOptions } from '@computesdk/provider';

import type { BuddyCommandRuntime, BuddySandboxHandle } from './utils.js';

export interface BuddyRunCommandOptions extends RunCommandOptions {
  /**
   * Interpreter Buddy runs the command with. Defaults to `BASH`; the other
   * runtimes take a script instead of a shell line, so `cwd` and `env` do not
   * apply to them.
   */
  runtime?: BuddyCommandRuntime;
}

/** Prepends `cd` and `export` when the caller asked for a cwd or env. */
export function buildShellCommand(command: string, options: RunCommandOptions = {}): string {
  let line = command;

  if (options.env && Object.keys(options.env).length > 0) {
    const exports = Object.entries(options.env)
      .map(([key, value]) => `${key}="${escapeShellArg(String(value))}"`)
      .join(' ');
    line = `export ${exports} && ${line}`;
  }
  if (options.cwd) {
    line = `cd "${escapeShellArg(options.cwd)}" && ${line}`;
  }
  return line;
}

export async function runCommand(
  sandbox: BuddySandboxHandle,
  command: string,
  options: BuddyRunCommandOptions = {},
): Promise<CommandResult> {
  // `ADD-PROVIDER.md` still documents an older `runCommand(command, args)`
  // shape. Called that way, the array arrives here as `options`, where only
  // `cwd` and `env` are read — the arguments would be dropped silently and the
  // bare command would still exit 0. Fail loudly instead.
  if (Array.isArray(options)) {
    throw new TypeError(
      `runCommand takes a command line and an options object, not an argument array. `
      + `Pass the arguments inside the command, e.g. '${command} ${options.join(' ')}'.`,
    );
  }

  const startedAt = Date.now();
  const runtime = options.runtime ?? 'BASH';
  const payload = runtime === 'BASH' ? buildShellCommand(command, options) : command;

  const commandResponse = await sandbox.client.executeCommand({
    path: { sandbox_id: sandbox.sandboxId },
    body: { command: payload, runtime },
  });

  const commandId = commandResponse.id;
  if (!commandId) {
    throw new Error('Buddy accepted the command but returned no command id.');
  }

  const running = new Command({
    commandResponse,
    client: sandbox.client,
    sandboxId: sandbox.sandboxId,
  });

  // Fire-and-forget: return as soon as Buddy has the command queued.
  if (options.background) {
    return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startedAt };
  }

  const stdout: string[] = [];
  const stderr: string[] = [];

  // Killing the command ends the followed stream, which is what unblocks the
  // loop below — there is no way to abort the HTTP read itself.
  const killTimer = options.timeout
    ? setTimeout(() => { void running.kill().catch(() => {}); }, options.timeout)
    : undefined;

  try {
    // `follow: true` holds the connection open until the command exits, so this
    // loop is the wait — nothing is polled.
    for await (const log of running.logs({ follow: true })) {
      if (log.data == null) continue;
      if (log.type === 'STDERR') {
        stderr.push(log.data);
        options.onStderr?.(log.data);
      } else {
        stdout.push(log.data);
        options.onStdout?.(log.data);
      }
    }
  } finally {
    if (killTimer) clearTimeout(killTimer);
  }

  const details = await sandbox.client.getCommandDetails({
    path: { sandbox_id: sandbox.sandboxId, id: commandId },
  });

  return {
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    exitCode: resolveExitCode(details),
    durationMs: Date.now() - startedAt,
  };
}

/**
 * `exit_code` is missing while a command is still in progress, which happens
 * when the log stream ends before Buddy has recorded the result. Reporting a
 * failure there would be wrong, so the status decides.
 */
function resolveExitCode(details: { exit_code?: number; status?: string }): number {
  if (typeof details.exit_code === 'number') return details.exit_code;
  return details.status === 'FAILED' ? 1 : 0;
}
