/**
 * Streaming a command's output over a provider's own process API.
 *
 * The framework's default way to serve `onStdout`/`onStderr` is the daemond
 * bridge: seed a daemon inside the sandbox and read its SSE endpoint over a port
 * the provider exposes. Plenty of providers instead expose the whole thing on
 * their management API — start a process, follow its output, read its exit
 * status — which needs no routable port at all.
 *
 * The awkward part of using that is not the following, it is the lifecycle
 * around it: a deadline that has to hold even when the request to stop the
 * process never answers, an output connection that can drop while the process
 * keeps running, and an exit code that may not be readable the instant the
 * output ends. That part is identical for every such provider, so it lives here
 * and a provider supplies only the four calls its API actually names.
 */

import type { CommandResult, RunCommandOptions } from './types';

/** How long to keep asking for an exit code once both streams have ended. */
const EXIT_POLL_ATTEMPTS = 25;
const EXIT_POLL_INTERVAL_MS = 200;

/** Exit code reported when the command was killed for exceeding its timeout. */
export const TIMEOUT_EXIT_CODE = 124;
/** Exit code reported when the process could not be started at all. */
export const START_FAILURE_EXIT_CODE = 127;

/** A process the provider has started, in the terms this helper needs. */
export interface StreamedProcess {
  /**
   * Output as it arrives. Text, not lines — a line-oriented API should append
   * its own separator so what is streamed matches what the buffer holds.
   */
  followStdout(signal: AbortSignal): AsyncIterable<string>;
  followStderr(signal: AbortSignal): AsyncIterable<string>;
  /**
   * The process's current state. `running: true` when it is still going or when
   * the answer is unknown — an unreadable status must not look like an exit.
   */
  status(): Promise<{ running: boolean; exitCode?: number }>;
  /** Best-effort stop. May reject, and may never settle; neither is fatal. */
  kill(): Promise<void>;
  /**
   * The complete output the provider buffered, used to recover the tail when a
   * follow connection drops. Omit if the provider keeps no buffer.
   */
  bufferedStdout?(): Promise<string>;
  bufferedStderr?(): Promise<string>;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Follows one stream, handing every chunk to the caller as it arrives. A follow
 * that fails part way through is reported rather than thrown: the process is
 * still running and its output is still retrievable, so the missing tail is
 * backfilled from the provider's buffer once it exits.
 */
async function pump(
  chunks: AsyncIterable<string>,
  onText: (text: string) => void
): Promise<{ failed: boolean }> {
  try {
    for await (const chunk of chunks) {
      onText(chunk);
    }
    return { failed: false };
  } catch {
    return { failed: true };
  }
}

/**
 * Emits whatever the buffered output has beyond what was seen on the wire.
 * Compares lengths rather than content — it is the same byte sequence, and the
 * length is the only question a backfill has to answer.
 */
function backfill(
  buffered: string,
  streamed: string,
  emit: (text: string) => void
): string {
  if (buffered.length <= streamed.length) return streamed;
  emit(buffered.slice(streamed.length));
  return buffered;
}

/**
 * Runs a provider's process to completion, streaming its output through
 * `onStdout`/`onStderr` and resolving with the same shape as a non-streaming
 * run. `start` is the only provider-specific part; a failure to start is
 * reported as exit 127 rather than thrown, matching the non-streaming paths.
 */
export async function streamCommandViaProcess(
  start: () => Promise<StreamedProcess>,
  options: RunCommandOptions
): Promise<CommandResult> {
  const startTime = Date.now();
  const durationMs = () => Date.now() - startTime;

  let process: StreamedProcess;
  try {
    process = await start();
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: START_FAILURE_EXIT_CODE,
      durationMs: durationMs()
    };
  }

  let stdout = '';
  let stderr = '';
  const controller = new AbortController();

  let timedOut = false;
  let exited = false;
  // The deadline abandons the follow streams first and only then asks for the
  // kill, so neither a kill that fails nor one that never answers can hold the
  // caller open past its timeout. It is disarmed once the process is known to
  // have exited, so the exit status can be read at leisure without a late
  // deadline claiming a finished command.
  let timer: ReturnType<typeof setTimeout> | undefined =
    options.timeout === undefined
      ? undefined
      : setTimeout(() => {
          if (exited) return;
          timedOut = true;
          controller.abort();
          void process.kill().catch(() => {});
        }, options.timeout);

  const disarm = () => {
    exited = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  try {
    const [stdoutPump, stderrPump] = await Promise.all([
      pump(process.followStdout(controller.signal), (text) => {
        stdout += text;
        options.onStdout?.(text);
      }),
      pump(process.followStderr(controller.signal), (text) => {
        stderr += text;
        options.onStderr?.(text);
      })
    ]);

    // A stream can end for two reasons, and they mean opposite things. If both
    // ended cleanly the process has exited, so the deadline no longer applies to
    // it. If either *failed*, the process is very likely still running — the
    // deadline is still the only thing that will stop it, and its exit is worth
    // waiting for however long the caller allowed.
    const lostStream = stdoutPump.failed || stderrPump.failed;
    if (!lostStream) disarm();

    const status = () => process.status().catch(() => ({ running: true }));

    let info: { running: boolean; exitCode?: number } = await status();
    // A timed-out command's exit status is not worth waiting for: it is reported
    // as a timeout either way, and waiting is what the deadline just refused.
    const attempts =
      lostStream && options.timeout !== undefined
        ? Number.POSITIVE_INFINITY
        : EXIT_POLL_ATTEMPTS;
    for (
      let attempt = 0;
      !timedOut && attempt < attempts && info.running;
      attempt += 1
    ) {
      await sleep(EXIT_POLL_INTERVAL_MS);
      info = await status();
    }
    disarm();

    if (stdoutPump.failed && process.bufferedStdout) {
      const buffered = await process.bufferedStdout().catch(() => '');
      stdout = backfill(buffered, stdout, (text) => options.onStdout?.(text));
    }
    if (stderrPump.failed && process.bufferedStderr) {
      const buffered = await process.bufferedStderr().catch(() => '');
      stderr = backfill(buffered, stderr, (text) => options.onStderr?.(text));
    }

    const exitCode = timedOut
      ? TIMEOUT_EXIT_CODE
      : (info.exitCode ?? (info.running ? -1 : 0));

    return { stdout, stderr, exitCode, durationMs: durationMs() };
  } catch (error) {
    controller.abort();
    return {
      stdout,
      stderr: stderr + (error instanceof Error ? error.message : String(error)),
      exitCode: START_FAILURE_EXIT_CODE,
      durationMs: durationMs()
    };
  } finally {
    disarm();
  }
}
