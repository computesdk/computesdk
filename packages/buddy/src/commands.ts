/**
 * Command execution.
 *
 * Buddy has two ways to run a command:
 *
 * - `POST .../exec` runs it synchronously and answers with stdout, stderr and
 *   the exit code in one round trip. It keeps no history, cannot stream and
 *   cannot be interrupted. After 60 s the server stops waiting and answers
 *   400 without output or exit code; the process itself keeps running.
 * - `POST .../execs` accepts the command and returns its execution id
 *   immediately. The SDK's `Command` entity reads the log page by page and in
 *   between lets the API hold a status request until the command finishes, so
 *   nothing is polled on a fixed interval. The log does not tell stdout from
 *   stderr: every line is reported as stdout. Buddy runs at most 3 such
 *   commands at once per member in one sandbox and 10 per workspace, and stops
 *   each one after 90 minutes.
 *
 * A foreground call without streaming callbacks and without a `timeout` takes
 * the first route (one request instead of three). Anything else — callbacks,
 * `background`, any `timeout` — takes the second, where a timeout can kill the
 * command by its id.
 */

import { Command, type ExecView, type SandboxCommandResultView } from '@buddy-works/sandbox-sdk';
import { escapeShellArg } from '@computesdk/provider';
import type { CommandResult, RunCommandOptions } from '@computesdk/provider';

import { retryBootRaces } from './boot.js';
import {
  messageOf,
  sleep,
  statusOf,
  type BuddyCommandRuntime,
  type BuddySandboxHandle,
} from './utils.js';

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

  if (usesExec(options)) {
    // The exec endpoint rejects a booting sandbox instead of queueing, so the
    // 400 is retried. Exec has no command id to kill, which is why only untimed
    // calls come here; when the server gives up at its own limit, the process
    // is left running.
    let result: SandboxCommandResultView;
    try {
      result = await retryBootRaces(() => execCommand(sandbox, payload, runtime));
    } catch (error) {
      if (isExecTimeout(error)) return timedOutResult('', `${messageOf(error)}\n`);
      throw error;
    }
    if (typeof result.exit_code !== 'number') {
      throw new Error('Buddy ran the command but returned no exit code.');
    }
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exit_code,
      durationMs: Date.now() - startedAt,
    };
  }

  // Buddy may hold the submission while the sandbox boots (up to the client's
  // request timeout), so the deadline applies here too: when it passes first,
  // the timeout result is returned and the command is killed once (if ever)
  // Buddy reports it accepted.
  const submission = retryBootRaces(
    () => submitCommand(sandbox, payload, runtime),
    deadline,
  );
  const commandResponse = deadline ? await raceDeadline(submission, deadline) : await submission;
  if (commandResponse === DEADLINE_PASSED) {
    void submission.then(
      response => {
        if (!response.execution_id) return;
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

  if (!commandResponse.execution_id) {
    throw new Error('Buddy accepted the command but returned no execution id.');
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

  // `follow: true` reads until the command has finished, so this loop is the
  // wait; `wait()` afterwards only returns the final state the loop already
  // saw. Each line comes without its terminator, so the newline goes back on
  // here. Aborting at the deadline stops the SDK's requests; the flag stops
  // the loop from firing callbacks for a result nobody will read.
  const abort = new AbortController();
  let timedOut = false;
  const drain = (async () => {
    for await (const line of running.logs({ follow: true, signal: abort.signal })) {
      if (timedOut) break;
      const chunk = `${line}\n`;
      stdout.push(chunk);
      options.onStdout?.(chunk);
    }
    return running.wait({ signal: abort.signal });
  })();

  let finished: Command;
  try {
    const outcome = deadline ? await raceDeadline(drain, deadline) : await drain;
    if (outcome === DEADLINE_PASSED) {
      timedOut = true;
      abort.abort();
      drain.catch(() => {});
      void killCommand(running);
      return timedOutResult(stdout.join(''));
    }
    finished = outcome;
  } catch (error) {
    // Reading the log or the status broke mid-command. Buddy keeps running it,
    // so stop it — best effort and not awaited, so a hanging kill cannot delay
    // the error.
    void killCommand(running);
    throw error;
  }

  const { exitCode, message } = outcomeOf(finished.data);
  return {
    stdout: stdout.join(''),
    stderr: message ? `${message}\n` : '',
    exitCode,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * `POST .../execs`. Over Buddy's concurrency limit the API answers 409; that
 * becomes an error saying what to do about it instead of a bare HTTP status.
 */
async function submitCommand(
  sandbox: BuddySandboxHandle,
  command: string,
  runtime: BuddyCommandRuntime,
): Promise<ExecView> {
  try {
    return await sandbox.client.executeCommand({
      path: { sandbox_id: sandbox.sandboxId },
      body: { command, runtime },
    });
  } catch (error) {
    if (statusOf(error) !== 409) throw error;
    throw new Error(
      `Buddy refused to start the command on sandbox ${sandbox.sandboxId}: too many commands `
      + 'are running (at most 3 per member in one sandbox and 10 per workspace). '
      + `Retry once one of them finishes. (${messageOf(error)})`,
    );
  }
}

/**
 * The exit code of a finished command. A command Buddy failed or cancelled
 * without an exit code — e.g. stopped at the 90-minute limit — counts as a
 * failure, with Buddy's explanation as the message.
 */
export function outcomeOf(view: ExecView): { exitCode: number; message?: string } {
  if (typeof view.exit_code === 'number') return { exitCode: view.exit_code };
  if (view.status === 'SUCCESSFUL') return { exitCode: 0 };
  const reason = view.error_message ?? view.failure_reason;
  return {
    exitCode: 1,
    message: `Buddy command ${view.execution_id ?? ''} ended ${view.status ?? 'without a status'}`
      + (reason ? `: ${reason}` : ' without an exit code'),
  };
}

/** The server gave up waiting for an `exec` command at its own limit. */
export function isExecTimeout(error: unknown): boolean {
  return statusOf(error) === 400 && /did not finish on instance .* within \d+s/i.test(messageOf(error));
}

/**
 * Foreground, no streaming callbacks and no `timeout`. Callbacks force the log
 * stream because exec only has the output once the command has finished; a
 * timeout needs a command id to kill, which exec does not return.
 */
export function usesExec(options: BuddyRunCommandOptions): boolean {
  return !options.background && !options.onStdout && !options.onStderr && !options.timeout;
}

/**
 * `POST /workspaces/{workspace}/sandboxes/{id}/exec`. The SDK client waits
 * just past the server's own limit, so the server decides the outcome.
 */
function execCommand(
  sandbox: BuddySandboxHandle,
  command: string,
  runtime: BuddyCommandRuntime,
): Promise<SandboxCommandResultView> {
  return sandbox.client.execCommand({
    body: { command, runtime },
    path: { sandbox_id: sandbox.sandboxId },
  });
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

/** The exit code `timeout(1)` uses for a killed command; reported for every timeout. */
export const TIMEOUT_EXIT_CODE = 124;
