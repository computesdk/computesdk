/**
 * Commands and background processes over E2B's own process API (envd).
 *
 * envd starts every command in the process group it runs in itself, so killing
 * a command's pid leaves its children running. Each command is therefore
 * re-exec'd under `setsid`, keeping its pid but making it a group leader, and
 * deadlines and kills signal the whole group.
 */

import { CommandExitError } from 'e2b';
import type { Sandbox as E2BSandbox, CommandHandle } from 'e2b';
import type {
  CommandResult,
  ProcessHandle,
  ProcessStatus,
  RunCommandOptions,
  StartProcessOptions,
} from '@computesdk/provider';

/** Exit code reported for a command killed by its timeout. */
const TIMEOUT_EXIT_CODE = 124;
/** Exit code reported when the command could not be started at all. */
const START_FAILURE_EXIT_CODE = 127;
/** How long a kill request may take before it is abandoned. */
const KILL_REQUEST_TIMEOUT_MS = 10_000;

const SIGNALS: Record<string, { name: string; number: number }> = {
  hangup: { name: 'SIGHUP', number: 1 },
  interrupt: { name: 'SIGINT', number: 2 },
  quit: { name: 'SIGQUIT', number: 3 },
  aborted: { name: 'SIGABRT', number: 6 },
  killed: { name: 'SIGKILL', number: 9 },
  'user defined signal 1': { name: 'SIGUSR1', number: 10 },
  'user defined signal 2': { name: 'SIGUSR2', number: 12 },
  'broken pipe': { name: 'SIGPIPE', number: 13 },
  terminated: { name: 'SIGTERM', number: 15 },
};

const SIGNAL_NUMBERS: Record<string, number> = Object.fromEntries(
  Object.values(SIGNALS).map(({ name, number }) => [name, number])
);

export interface E2BExit {
  stdout: string;
  stderr: string;
  exitCode: number;
  signal: string | null;
}

/** Runs `command` in its own process group, with the same pid envd reports. */
export function inProcessGroup(command: string): string {
  const inner = `/bin/bash -c '${command.replace(/'/g, `'\\''`)}'`;
  return `command -v setsid >/dev/null 2>&1 && exec setsid ${inner}; exec ${inner}`;
}

/**
 * Signals the process group led by `pid`, or just `pid` if it does not lead
 * one (no `setsid` in the image) — never a group it merely belongs to.
 */
function killScript(pid: number, signal: string): string {
  const sig = signal.replace(/^SIG/i, '').toUpperCase();
  if (!/^[A-Z0-9]+$/.test(sig)) throw new Error(`e2b: invalid signal ${signal}`);
  return [
    `p=${pid}`,
    `read -r stat < /proc/$p/stat 2>/dev/null || exit 0`,
    `set -- \${stat##*) }`,
    `if [ "$3" = "$p" ]; then kill -s ${sig} -- -$p 2>/dev/null; else kill -s ${sig} $p 2>/dev/null; fi`,
    `exit 0`,
  ].join('; ');
}

export async function signalProcess(sandbox: E2BSandbox, pid: number, signal: string): Promise<void> {
  try {
    await sandbox.commands.run(killScript(pid, signal), {
      timeoutMs: KILL_REQUEST_TIMEOUT_MS,
      requestTimeoutMs: KILL_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    if (signal.replace(/^SIG/i, '').toUpperCase() !== 'KILL') throw error;
    await sandbox.commands.kill(pid, { requestTimeoutMs: KILL_REQUEST_TIMEOUT_MS });
  }
}

/** envd reports a signal death as exit -1 with Go's `signal: <name>` text. */
function exitFromResult(
  result: { stdout?: string; stderr?: string; exitCode?: number; error?: string },
  sentSignal: string | null
): E2BExit {
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const match = /^signal: (.+)$/.exec(result.error ?? '');
  if (match) {
    const known = SIGNALS[match[1]];
    const signal = known?.name ?? sentSignal ?? match[1];
    const number = known?.number ?? SIGNAL_NUMBERS[signal];
    return { stdout, stderr, exitCode: number ? 128 + number : -1, signal };
  }
  return { stdout, stderr, exitCode: result.exitCode ?? -1, signal: null };
}

/** Resolves once the command exits; never rejects. */
function settle(handle: CommandHandle, sentSignal: () => string | null): Promise<E2BExit> {
  return handle.wait().then(
    (result) => exitFromResult(result, null),
    (error) => {
      if (error instanceof CommandExitError) {
        return exitFromResult(
          { stdout: error.stdout, stderr: error.stderr, exitCode: error.exitCode, error: error.error },
          sentSignal()
        );
      }
      // The output stream was lost; what arrived is all that is known.
      const message = error instanceof Error ? error.message : String(error);
      return {
        stdout: handle.stdout,
        stderr: handle.stderr + (handle.stderr && !handle.stderr.endsWith('\n') ? '\n' : '') + message,
        exitCode: -1,
        signal: sentSignal(),
      };
    }
  );
}

function launch(
  sandbox: E2BSandbox,
  command: string,
  options: {
    cwd?: string;
    env?: Record<string, string>;
    stdin?: boolean;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  }
): Promise<CommandHandle> {
  return sandbox.commands.run(inProcessGroup(command), {
    background: true,
    // 0 disables the SDK's 60s default; deadlines are enforced here instead.
    timeoutMs: 0,
    cwd: options.cwd,
    envs: options.env,
    stdin: options.stdin ?? false,
    onStdout: options.onStdout,
    onStderr: options.onStderr,
  });
}

/**
 * `runCommand` and streaming `runCommand`: callbacks fire as envd delivers
 * output; a `timeout` kills the command's whole process group and reports 124.
 */
export async function runE2BCommand(
  sandbox: E2BSandbox,
  command: string,
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  const startTime = Date.now();
  const durationMs = () => Date.now() - startTime;

  let handle: CommandHandle;
  try {
    handle = await launch(sandbox, command, {
      cwd: options.cwd,
      env: options.env,
      onStdout: options.onStdout,
      onStderr: options.onStderr,
    });
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: START_FAILURE_EXIT_CODE,
      durationMs: durationMs(),
    };
  }

  if (options.background) {
    await handle.disconnect();
    return { stdout: '', stderr: '', exitCode: 0, durationMs: durationMs() };
  }

  const exited = settle(handle, () => null);
  if (options.timeout === undefined) {
    const exit = await exited;
    return { stdout: exit.stdout, stderr: exit.stderr, exitCode: exit.exitCode, durationMs: durationMs() };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), options.timeout);
  });
  try {
    const outcome = await Promise.race([exited, deadline]);
    if (outcome !== 'timeout') {
      return { stdout: outcome.stdout, stderr: outcome.stderr, exitCode: outcome.exitCode, durationMs: durationMs() };
    }
    const stdout = handle.stdout;
    const stderr = handle.stderr;
    await handle.disconnect();
    await signalProcess(sandbox, handle.pid, 'SIGKILL').catch(() => {});
    return { stdout, stderr, exitCode: TIMEOUT_EXIT_CODE, durationMs: durationMs() };
  } finally {
    clearTimeout(timer);
  }
}

class E2BProcessHandle implements ProcessHandle {
  readonly runtime = 'native' as const;
  readonly jobId: string;
  private exit?: E2BExit;
  private sentSignal: string | null = null;
  private readonly exited: Promise<E2BExit>;
  private readonly startedAt = Date.now();

  constructor(
    private readonly sandbox: E2BSandbox,
    private readonly handle: CommandHandle,
    private readonly options: StartProcessOptions
  ) {
    this.jobId = String(handle.pid);
    this.exited = settle(handle, () => this.sentSignal).then((exit) => {
      this.exit = exit;
      try {
        options.onExit?.({ exitCode: exit.exitCode, signal: exit.signal });
      } catch {
        // A throwing callback must not change the process's result.
      }
      return exit;
    });
  }

  get pid(): number {
    return this.handle.pid;
  }

  async write(data: string | Uint8Array): Promise<void> {
    if (!this.options.stdin) throw new Error(`e2b: process ${this.jobId} was not started with stdin: true`);
    if (this.exit) throw new Error(`e2b: process ${this.jobId} has exited`);
    await this.handle.sendStdin(data);
  }

  async closeStdin(): Promise<void> {
    if (!this.options.stdin || this.exit) return;
    await this.handle.closeStdin();
  }

  async status(): Promise<ProcessStatus> {
    if (this.exit) {
      return { status: 'exited', exitCode: this.exit.exitCode, signal: this.exit.signal, stdout: this.exit.stdout, stderr: this.exit.stderr };
    }
    return { status: 'running', exitCode: null, signal: null, stdout: this.handle.stdout, stderr: this.handle.stderr };
  }

  async wait(options?: { timeout?: number }): Promise<CommandResult & { signal: string | null }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const exit = await (options?.timeout === undefined
        ? this.exited
        : Promise.race([
            this.exited,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`e2b: process ${this.jobId} did not exit within ${options.timeout}ms`)),
                options.timeout
              );
            }),
          ]));
      return { ...exit, durationMs: Date.now() - this.startedAt };
    } finally {
      clearTimeout(timer);
    }
  }

  async kill(signal = 'SIGTERM'): Promise<void> {
    if (this.exit) return;
    const name = `SIG${signal.replace(/^SIG/i, '').toUpperCase()}`;
    this.sentSignal = name;
    await signalProcess(this.sandbox, this.handle.pid, name);
  }
}

/** `startProcess` over envd: live output, stdin, kill by signal. */
export async function startE2BProcess(
  sandbox: E2BSandbox,
  command: string,
  options: StartProcessOptions = {}
): Promise<ProcessHandle> {
  const handle = await launch(sandbox, command, options);
  return new E2BProcessHandle(sandbox, handle, options);
}
