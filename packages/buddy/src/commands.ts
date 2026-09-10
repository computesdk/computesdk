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

import { sleep, type BuddyCommandRuntime, type BuddySandboxHandle } from './utils.js';

export interface BuddyRunCommandOptions extends RunCommandOptions {
  /**
   * Interpreter Buddy runs the command with. Defaults to `BASH`; the other
   * runtimes take a script instead of a shell line, so `cwd` and `env` do not
   * apply to them.
   */
  runtime?: BuddyCommandRuntime;
}

/** What a POSIX shell accepts as a variable name. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Prepends `cd` and `export` when the caller asked for a cwd or env. Values are
 * escaped; names cannot be, so a name that is not a valid identifier is
 * rejected instead of being spliced into the shell line.
 */
export function buildShellCommand(command: string, options: RunCommandOptions = {}): string {
  let line = command;

  if (options.env && Object.keys(options.env).length > 0) {
    const exports = Object.entries(options.env)
      .map(([key, value]) => {
        if (!ENV_NAME.test(key)) {
          throw new TypeError(
            `Invalid environment variable name ${JSON.stringify(key)}: `
            + 'names must match /^[A-Za-z_][A-Za-z0-9_]*$/.',
          );
        }
        return `${key}="${escapeShellArg(String(value))}"`;
      })
      .join(' ');
    line = `export ${exports} && ${line}`;
  }
  if (options.cwd) {
    line = `cd "${escapeShellArg(options.cwd)}" && ${line}`;
  }
  return line;
}

/** A termination that fails leaves the command running remotely, so retry. */
const KILL_ATTEMPTS = 3;
const KILL_RETRY_DELAY_MS = 500;

/** Best-effort kill: never throws, gives up after `KILL_ATTEMPTS`. */
export async function killCommand(running: Pick<Command, 'kill'>): Promise<boolean> {
  for (let attempt = 1; attempt <= KILL_ATTEMPTS; attempt++) {
    try {
      await running.kill();
      return true;
    } catch {
      if (attempt < KILL_ATTEMPTS) await sleep(KILL_RETRY_DELAY_MS);
    }
  }
  return false;
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

  const deadline = options.timeout ? startedAt + options.timeout : undefined;
  const timedOutResult = (stdout = '', stderr = '') => ({
    stdout, stderr, exitCode: TIMEOUT_EXIT_CODE, durationMs: Date.now() - startedAt,
  });

  // Buddy may hold the submission while the sandbox boots (up to the client's
  // request timeout), so the deadline applies here too: when it passes first,
  // the timeout result is returned and the command is killed once (if ever)
  // Buddy reports it accepted.
  const submission = sandbox.client.executeCommand({
    path: { sandbox_id: sandbox.sandboxId },
    body: { command: payload, runtime },
  });
  const commandResponse = deadline ? await raceDeadline(submission, deadline) : await submission;
  if (commandResponse === DEADLINE_PASSED) {
    void submission.then(
      response => {
        if (!response.id) return;
        void killCommand(new Command({
          commandResponse: response,
          client: sandbox.client,
          sandboxId: sandbox.sandboxId,
        }));
      },
      () => {},
    );
    return timedOutResult();
  }

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
  // terminator, so the newline goes back on here. Once the caller has been
  // given the timeout result the loop stops at the next record instead of
  // buffering output and firing callbacks for a result nobody will read.
  let timedOut = false;
  const drain = (async () => {
    for await (const log of running.logs({ follow: true })) {
      if (timedOut) break;
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
  // right away — with whatever output arrived before the deadline — and the
  // reader is left to finish on its own once the kill (best effort, retried)
  // closes it or the next record arrives.
  try {
    const outcome = deadline ? await raceDeadline(drain, deadline) : await drain;
    if (outcome === DEADLINE_PASSED) {
      timedOut = true;
      void killCommand(running);
      drain.catch(() => {});
      return timedOutResult(stdout.join(''), stderr.join(''));
    }
  } catch (error) {
    // The stream broke mid-command. Buddy keeps running it, so stop it — best
    // effort and not awaited, so a hanging kill cannot delay the error.
    void killCommand(running);
    throw error;
  }

  return {
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    exitCode: await waitForExitCode(sandbox, commandId),
    durationMs: Date.now() - startedAt,
  };
}

const DEADLINE_PASSED = Symbol('deadline passed');

/** Resolves to `DEADLINE_PASSED` if `deadline` (epoch ms) arrives first. */
async function raceDeadline<T>(work: Promise<T>, deadline: number): Promise<T | typeof DEADLINE_PASSED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof DEADLINE_PASSED>(resolve => {
    timer = setTimeout(() => resolve(DEADLINE_PASSED), Math.max(0, deadline - Date.now()));
  });
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
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
