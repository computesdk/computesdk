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
 * The lifecycle around that — deadline, kill, exit polling, recovering from a
 * dropped follow — is the framework's `streamCommandViaProcess`; this file is
 * only the mapping onto Tensorlake's process calls.
 */

import { OutputMode, ProcessStatus } from "tensorlake";
import {
  streamCommandViaProcess,
  TIMEOUT_EXIT_CODE,
} from "@computesdk/provider";
import type {
  CommandResult,
  RunCommandOptions,
  StreamedProcess,
} from "@computesdk/provider";

export { TIMEOUT_EXIT_CODE };

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

/** Tensorlake follows output by line; the helper works in text. */
async function* lines(
  events: AsyncIterable<{ line: string }>,
): AsyncIterable<string> {
  for await (const event of events) {
    yield `${event.line}\n`;
  }
}

const joinLines = (buffered: string[]): string =>
  buffered.length === 0 ? "" : `${buffered.join("\n")}\n`;

/**
 * Runs `command` under `sh -c`, streaming its output through the callbacks, and
 * resolves with the same shape as a non-streaming run.
 */
export async function streamTensorlakeCommand(
  sandbox: StreamableTensorlakeSandbox,
  command: string,
  options: RunCommandOptions,
): Promise<CommandResult> {
  return await streamCommandViaProcess(async (): Promise<StreamedProcess> => {
    const { pid } = await sandbox.startProcess("sh", {
      args: ["-c", command],
      stdoutMode: OutputMode.CAPTURE,
      stderrMode: OutputMode.CAPTURE,
      ...(options.env &&
        Object.keys(options.env).length > 0 && { env: options.env }),
      ...(options.cwd && { workingDir: options.cwd }),
    });

    return {
      followStdout: (signal) => lines(sandbox.followStdout(pid, { signal })),
      followStderr: (signal) => lines(sandbox.followStderr(pid, { signal })),
      status: async () => {
        const info = await sandbox.getProcess(pid);
        return {
          running: info.status === ProcessStatus.RUNNING,
          exitCode: info.exitCode,
        };
      },
      kill: async () => await sandbox.killProcess(pid),
      bufferedStdout: async () => joinLines((await sandbox.getStdout(pid)).lines),
      bufferedStderr: async () => joinLines((await sandbox.getStderr(pid)).lines),
    };
  }, options);
}
