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
}

export interface SeedCommandResult {
  exitCode: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  combined: string;
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
