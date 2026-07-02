export interface SeedScriptConfig {
  name?: string;
  socket?: string;
  ssePort?: number;
  sseStrictPort?: boolean;
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
   * When true, the command is launched in the background inside the daemon.
   * The daemon spawns the process detached, captures output in a ring buffer,
   * and responds immediately with a `jobId`. Use `daemonSeedScriptJobReadCommand`
   * to poll the buffered output and status.
   */
  background?: boolean;
}

export interface SeedCommandResult {
  exitCode: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  combined: string;
  /**
   * Present when `background: true` was passed. Use this with
   * `daemonSeedScriptJobReadCommand` to read buffered output from the daemon.
   */
  jobId?: string;
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

/**
 * Status of a background job returned by `daemonSeedScriptJobReadCommand`.
 */
export interface SeedJobStatus {
  jobId: string;
  pid: number | null;
  running: boolean;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}
