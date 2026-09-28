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
   * Return as soon as the process has started instead of when it exits. The
   * result carries `status: "running"` and a `jobId` to hand to a later
   * `wait`/`status`/`kill` invocation. A detached job has no timeout unless
   * `timeoutMs` is set.
   */
  detach?: boolean;
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

/**
 * Start (or replace) the daemon's dial-out tunnel. `connect` is the control
 * plane WebSocket URL; `tunnelToken` authenticates the daemon to it.
 * `allowPorts` entries are port numbers or `"a-b"` ranges the tunnel may dial
 * inside the sandbox (default: any port, loopback hosts only).
 */
export interface SeedTunnelConnectInput {
  connect: string;
  tunnelToken: string;
  allowPorts?: Array<number | string>;
  timeoutMs?: number;
}

/** Snapshot the tunnel's current state without changing it. */
export interface SeedTunnelStatusInput {
  status: true;
}

/** Stop the tunnel and suppress reconnects. */
export interface SeedTunnelDisconnectInput {
  disconnect: true;
}

export type SeedTunnelPayload =
  | SeedTunnelConnectInput
  | SeedTunnelStatusInput
  | SeedTunnelDisconnectInput;

export interface SeedTunnelInput {
  tunnel: SeedTunnelPayload;
  requestId?: string;
}

export type SeedInput =
  | SeedCommandInput
  | SeedWaitInput
  | SeedStatusInput
  | SeedKillInput
  | SeedTunnelInput;

export type SeedTunnelState = "connecting" | "connected" | "disconnected";

export interface SeedTunnelStatus {
  state: SeedTunnelState;
  url: string | null;
  connectedAt: number | null;
  reconnects: number;
  streamsOpen: number;
  lastError: string | null;
}

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
  /** Present for tunnel invocations: the tunnel status snapshot. */
  tunnel?: SeedTunnelStatus;
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
