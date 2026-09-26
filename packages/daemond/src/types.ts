export interface SeedScriptConfig {
  name?: string;
  socket?: string;
  ssePort?: number;
  sseStrictPort?: boolean;
  /** Per-stream buffered-output cap for detached jobs (default 4 MiB). */
  maxJobOutputBytes?: number;
  /** How long an exited detached job stays retrievable (default 10 minutes). */
  jobRetentionMs?: number;
}

export interface SeedCommandInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean;
  timeoutMs?: number;
  requestId?: string;
  /**
   * Return as soon as the process has started instead of when it exits. The
   * result carries `status: "running"` and a `jobId` to hand to a later
   * `wait`/`status`/`kill` invocation. A detached job has no timeout unless
   * `timeoutMs` is set.
   */
  detach?: boolean;
  /**
   * Open a writable stdin pipe on the child. Requires `detach: true` — the
   * job then accepts `stdin`/`closeStdin` messages addressed by `jobId`.
   */
  stdin?: boolean;
}

/** Block until a detached job exits (or `timeoutMs` elapses) and return its result. */
export interface SeedWaitInput {
  wait: string;
  timeoutMs?: number;
  requestId?: string;
}

/** Snapshot a detached job's current state and buffered output without blocking. */
export interface SeedStatusInput {
  status: string;
  requestId?: string;
}

/** Signal a detached job (default SIGTERM) and return its state afterwards. */
export interface SeedKillInput {
  kill: string;
  signal?: string;
  requestId?: string;
}

/** Write data to the stdin pipe of a detached job started with `stdin: true`. */
export interface SeedStdinInput {
  stdin: string;
  data: string;
  encoding?: "utf8" | "base64";
  requestId?: string;
}

/** Close the stdin pipe of a detached job (closing twice is a no-op). */
export interface SeedCloseStdinInput {
  closeStdin: string;
  requestId?: string;
}

export type SeedInput =
  | SeedCommandInput
  | SeedWaitInput
  | SeedStatusInput
  | SeedKillInput
  | SeedStdinInput
  | SeedCloseStdinInput;

export type SeedJobStatus = "running" | "exited";

export interface SeedCommandResult {
  /**
   * The process's exit code. `null` while the job is still running
   * (`status: "running"`) or when it was ended by a signal — never invented.
   */
  exitCode: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  combined: string;
  /** Present for detached jobs and for `wait`/`status`/`kill` results. */
  status?: SeedJobStatus;
  jobId?: string;
  pid?: number | null;
  /** True when a detached job's buffered output exceeded the cap and was tailed. */
  truncated?: boolean;
  /** Total bytes ever appended to each stream (before truncation), for offset-based consumers. */
  stdoutBytes?: number;
  stderrBytes?: number;
}

export interface SeedCommandOptions {
  /**
   * How the launcher script and payload are carried on the command line.
   *
   * - `"quoted"` (default): `sh -c '<prelude>' '<script>' '<payload>'`, single-quoted words.
   * - `"base64"`: `printf %s <b64> | base64 -d | sh -s <b64> <b64>` — every word is
   *   `[A-Za-z0-9+/=]`, so it survives exec layers that re-split or collapse
   *   quotes. Needs `base64` in the sandbox (coreutils or busybox).
   */
  argvEncoding?: "quoted" | "base64";
}

export interface SeedDaemonInfo {
  reused: boolean;
  pid: number | null;
  sseUrl: string;
}

export interface SeedInvocationResult {
  token: string;
  requestId: string;
  daemon: SeedDaemonInfo;
  command: SeedCommandResult;
}

export interface SeedHealthPayload {
  state: "running";
  pid: number;
  uptime: number;
  sseUrl: string;
}

export interface SeedEventFilter {
  channel?: string;
  type?: string;
}
