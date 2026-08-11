/**
 * Live command output for Tensorlake, over Tensorlake's own API.
 *
 * The framework's default way to stream a command is the daemond bridge: it
 * seeds a daemon inside the sandbox and reads its SSE endpoint over an HTTP port
 * exposed by the provider. A Tensorlake sandbox reaches that port only through
 * `<port>-<sandbox-id>.<ingress>`, which requires the port to be added to the
 * proxy allowlist and its auth relaxed — a publicly routable port per CI job for
 * output the management API already has.
 *
 * So this streams the way Tensorlake means output to be streamed: start the
 * process, follow its stdout and stderr, and read the exit status when they end.
 * Nothing is exposed, and callbacks fire line by line while the command runs
 * rather than once it exits.
 */

import { OutputMode, ProcessStatus } from "tensorlake";
import type { CommandResult, RunCommandOptions } from "@computesdk/provider";

/** How long to keep asking for an exit code once both streams have ended. */
const EXIT_POLL_ATTEMPTS = 25;
const EXIT_POLL_INTERVAL_MS = 200;

/** Exit code reported when the command was killed for exceeding its timeout. */
export const TIMEOUT_EXIT_CODE = 124;

/**
 * The part of Tensorlake's `Sandbox` this needs. Structural rather than the SDK
 * class so a test can hand over a fake process without a sandbox.
 */
export interface StreamableTensorlakeSandbox {
  startProcess(
    command: string,
    options?: {
      args?: string[];
      env?: Record<string, string>;
      workingDir?: string;
      stdoutMode?: OutputMode;
      stderrMode?: OutputMode;
    },
  ): Promise<{ pid: number }>;
  followStdout(
    pid: number,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<{ line: string }>;
  followStderr(
    pid: number,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<{ line: string }>;
  getProcess(pid: number): Promise<{ status: string; exitCode?: number }>;
  getStdout(pid: number): Promise<{ lines: string[] }>;
  getStderr(pid: number): Promise<{ lines: string[] }>;
  killProcess(pid: number): Promise<void>;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Follows one stream, handing every line to the caller as it arrives. A follow
 * that fails part way through is reported rather than thrown: the process is
 * still running and its output is still retrievable, so the missing tail is
 * backfilled from the daemon's buffer once it exits.
 */
async function pump(
  events: AsyncIterable<{ line: string }>,
  onText: (text: string) => void,
): Promise<{ failed: boolean }> {
  try {
    for await (const event of events) {
      onText(`${event.line}\n`);
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
  buffered: string[],
  streamed: string,
  emit: (text: string) => void,
): string {
  const complete = buffered.length === 0 ? "" : `${buffered.join("\n")}\n`;
  if (complete.length <= streamed.length) return streamed;
  const missing = complete.slice(streamed.length);
  emit(missing);
  return complete;
}

/**
 * Runs `command` under `sh -c`, streaming its output through the callbacks, and
 * resolves with the same shape as a non-streaming run.
 */
export async function streamTensorlakeCommand(
  sandbox: StreamableTensorlakeSandbox,
  command: string,
  options: RunCommandOptions,
): Promise<CommandResult> {
  const startTime = Date.now();
  const durationMs = () => Date.now() - startTime;

  let process: { pid: number };
  try {
    process = await sandbox.startProcess("sh", {
      args: ["-c", command],
      stdoutMode: OutputMode.CAPTURE,
      stderrMode: OutputMode.CAPTURE,
      ...(options.env &&
        Object.keys(options.env).length > 0 && { env: options.env }),
      ...(options.cwd && { workingDir: options.cwd }),
    });
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 127,
      durationMs: durationMs(),
    };
  }

  let stdout = "";
  let stderr = "";
  const controller = new AbortController();

  let timedOut = false;
  let exited = false;
  // The deadline kills the process and then abandons the follow streams, so a
  // kill that never lands can't hold the caller open past its timeout. It is
  // disarmed the moment the process is known to have exited, so the exit status
  // can be read at leisure without a late deadline claiming a finished command.
  let timer: ReturnType<typeof setTimeout> | undefined =
    options.timeout === undefined
      ? undefined
      : setTimeout(() => {
          if (exited) return;
          timedOut = true;
          void Promise.resolve()
            .then(() => sandbox.killProcess(process.pid))
            .catch(() => {})
            .finally(() => controller.abort());
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
      pump(sandbox.followStdout(process.pid, { signal: controller.signal }), (text) => {
        stdout += text;
        options.onStdout?.(text);
      }),
      pump(sandbox.followStderr(process.pid, { signal: controller.signal }), (text) => {
        stderr += text;
        options.onStderr?.(text);
      }),
    ]);

    // Both streams have ended, so the process is gone and the deadline no longer
    // applies to it.
    disarm();

    const status = () =>
      sandbox
        .getProcess(process.pid)
        .catch(() => ({ status: ProcessStatus.RUNNING as string }));

    let info: { status: string; exitCode?: number } = await status();
    // A timed-out command's exit status is not worth waiting for: it is reported
    // as a timeout either way, and waiting is what the deadline just refused.
    for (
      let attempt = 0;
      !timedOut &&
      attempt < EXIT_POLL_ATTEMPTS &&
      info.status === ProcessStatus.RUNNING;
      attempt += 1
    ) {
      await sleep(EXIT_POLL_INTERVAL_MS);
      info = await status();
    }

    if (stdoutPump.failed) {
      const buffered = await sandbox
        .getStdout(process.pid)
        .catch(() => ({ lines: [] as string[] }));
      stdout = backfill(buffered.lines, stdout, (text) => options.onStdout?.(text));
    }
    if (stderrPump.failed) {
      const buffered = await sandbox
        .getStderr(process.pid)
        .catch(() => ({ lines: [] as string[] }));
      stderr = backfill(buffered.lines, stderr, (text) => options.onStderr?.(text));
    }

    const exitCode = timedOut
      ? TIMEOUT_EXIT_CODE
      : (info.exitCode ?? (info.status === ProcessStatus.RUNNING ? -1 : 0));

    return { stdout, stderr, exitCode, durationMs: durationMs() };
  } catch (error) {
    controller.abort();
    return {
      stdout,
      stderr: stderr + (error instanceof Error ? error.message : String(error)),
      exitCode: 127,
      durationMs: durationMs(),
    };
  } finally {
    disarm();
  }
}
