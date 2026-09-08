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

  // `follow: true` holds the connection open until the command exits, so this
  // loop is the wait — nothing is polled. Each record is one line without its
  // terminator, so the newline goes back on here.
  const drain = (async () => {
    for await (const log of running.logs({ follow: true })) {
      if (log.data == null) continue;
      const chunk = `${log.data}\n`;
      if (log.type === 'STDERR') {
        stderr.push(chunk);
        options.onStderr?.(chunk);
      } else {
        stdout.push(chunk);
        options.onStdout?.(chunk);
      }
    }
  })();

  // The SDK stream cannot be aborted, so on timeout the result is returned
  // right away and the reader is left to finish on its own once the kill (best
  // effort — it may fail or take the client's request timeout) closes it.
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = options.timeout
    ? new Promise<void>(resolve => {
      killTimer = setTimeout(() => {
        timedOut = true;
        void running.kill().catch(() => {});
        resolve();
      }, options.timeout);
    })
    : undefined;

  try {
    await (timeout ? Promise.race([drain, timeout]) : drain);
  } catch (error) {
    // The stream broke mid-command. Buddy keeps running it, so stop it — best
    // effort and not awaited, so a hanging kill cannot delay the error.
    void running.kill().catch(() => {});
    throw error;
  } finally {
    if (killTimer) clearTimeout(killTimer);
    if (timedOut) drain.catch(() => {});
  }

  const exitCode = timedOut
    ? TIMEOUT_EXIT_CODE
    : await waitForExitCode(sandbox, commandId);

  return {
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    exitCode,
    durationMs: Date.now() - startedAt,
  };
}

/** What a shell reports for a command killed by `timeout(1)`. */
export const TIMEOUT_EXIT_CODE = 124;

const EXIT_CODE_WAIT_MS = 5_000;
const EXIT_CODE_POLL_MS = 200;

export interface BuddyCommandDetails {
  exit_code?: number;
  status?: string;
}

/**
 * The log stream can close a moment before Buddy records the result, so the
 * details may still say `INPROGRESS` without an `exit_code`. Treating that as
 * success would hide failures; poll briefly until a terminal state shows up.
 */
export async function waitForExitCode(
  sandbox: Pick<BuddySandboxHandle, 'client' | 'sandboxId'>,
  commandId: string,
  deadlineMs = EXIT_CODE_WAIT_MS,
): Promise<number> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const details: BuddyCommandDetails = await sandbox.client.getCommandDetails({
      path: { sandbox_id: sandbox.sandboxId, id: commandId },
    });
    if (typeof details.exit_code === 'number') return details.exit_code;
    if (details.status === 'FAILED') return 1;
    if (details.status === 'SUCCESSFUL') return 0;
    if (Date.now() >= deadline) {
      throw new Error(
        `Buddy command ${commandId} on sandbox ${sandbox.sandboxId} reported no exit code `
        + `within ${deadlineMs / 1000}s of its log stream closing (status: ${details.status ?? 'unknown'}).`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, EXIT_CODE_POLL_MS));
  }
}
