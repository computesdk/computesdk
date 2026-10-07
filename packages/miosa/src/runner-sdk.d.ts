/**
 * Ambient contract for `@miosa/sdk`'s SOMA one-hop runner transport,
 * hand-written against sdks/typescript/src/runner/ at tag
 * sdks/typescript/v3.3.0 in Miosa-osa/miosa.
 *
 * `@miosa/sdk@3.3.0` was not yet installable from the npm registry when this
 * was written, so there were no real types on disk to resolve against. This
 * file is the only reason this package's dynamic `import("@miosa/sdk")`
 * type-checks until then.
 *
 * DELETE THIS FILE as soon as `@miosa/sdk@^3.3.0` installs: its real `.d.ts`
 * take over module resolution and this ambient declaration would only be a
 * redundant, driftable second source of truth.
 */
declare module "@miosa/sdk" {
  export interface RunnerSandboxCreateResult {
    /** Empty string if the response body carried no `id` field. */
    id: string;
    /** The per-host URL this sandbox lives on. Empty when created via fallbackCreate. */
    runnerUrl: string;
    data: Record<string, unknown>;
  }

  export interface RunnerClientOptions {
    apiKey: string;
    /** Defaults to `us`. */
    region?: string;
    /** Overrides `miosa.ai` - for self-hosted / test deployments. */
    baseDomain?: string;
    tenant?: string;
    /** Sessions opened per resolved region address. Default 8. */
    sessionsPerAddress?: number;
    /** Called for creates the runner does not serve (template, image, snapshot, cwd, persistent, non-xs). */
    fallbackCreate?: (
      params: Record<string, unknown>,
      opts: { idempotencyKey?: string },
    ) => Promise<RunnerSandboxCreateResult>;
  }

  export interface RunnerExecOptions {
    cwd?: string;
    env?: Record<string, string>;
    /** Seconds. Defaults to 30 on the runner if omitted. */
    timeout?: number;
  }

  export interface RunnerDestroyResult {
    cpu_ms?: number;
    lifetime_ms?: number;
    [key: string]: unknown;
  }

  export type RunnerExecStreamEvent =
    | { type: "stdout"; line: string }
    | { type: "stderr"; line: string }
    | { type: "exit"; exit_code: number };

  export interface SomaSandboxGetResult {
    instance_id: string;
    state: "ready" | "stopping";
    backend: string;
  }

  export interface SomaSandboxStopResult {
    instance_id: string;
    state: "stopped";
  }

  export interface RunnerSetTimeoutResult {
    id: string;
    [key: string]: unknown;
  }

  export interface SomaSandboxListEntry {
    instance_id: string;
    state: string;
    host: "live" | "absent" | "unknown";
    backend: string;
  }

  export interface SomaSandboxListResult {
    sandboxes: SomaSandboxListEntry[];
    count: number;
  }

  /** Shape shared by every filesystem/terminal result; a refusal is reported in-band. */
  export interface SomaOperationResult {
    instance_id: string;
    operation: string;
    refusal?: string;
    [key: string]: unknown;
  }

  export class RunnerError extends Error {
    readonly status: number;
    readonly code: string;
    readonly runnerUrl: string | undefined;
    readonly retryable: boolean | undefined;
  }

  export class RunnerClient {
    constructor(options: RunnerClientOptions);
    readonly region: string;
    readonly hostname: string;

    createSandbox(
      params?: Record<string, unknown>,
      opts?: { idempotencyKey?: string },
    ): Promise<RunnerSandboxCreateResult>;

    exec(
      sandboxId: string,
      command: string,
      opts?: RunnerExecOptions,
    ): Promise<Record<string, unknown>>;

    execStream(
      sandboxId: string,
      command: string,
      opts?: RunnerExecOptions,
    ): AsyncIterableIterator<RunnerExecStreamEvent>;

    destroySandbox(sandboxId: string): Promise<RunnerDestroyResult>;

    get(sandboxId: string, opts?: { operationId?: string }): Promise<SomaSandboxGetResult>;
    stop(sandboxId: string, opts?: { operationId?: string }): Promise<SomaSandboxStopResult>;
    setTimeout(sandboxId: string, seconds: number): Promise<RunnerSetTimeoutResult>;
    list(opts?: { addressIndex?: number; tag?: string }): Promise<SomaSandboxListResult>;

    readonly filesystem: {
      read(sandboxId: string, path: string): Promise<SomaOperationResult>;
      write(sandboxId: string, path: string, content: string | Uint8Array): Promise<SomaOperationResult>;
      list(sandboxId: string, path: string): Promise<SomaOperationResult>;
      exists(sandboxId: string, path: string): Promise<SomaOperationResult>;
      remove(sandboxId: string, path: string, recursive?: boolean): Promise<SomaOperationResult>;
      mkdir(sandboxId: string, path: string): Promise<SomaOperationResult>;
    };

    readonly terminal: {
      open(sandboxId: string, columns: number, rows: number): Promise<SomaOperationResult>;
      resize(sandboxId: string, columns: number, rows: number): Promise<SomaOperationResult>;
      write(sandboxId: string, input: string | Uint8Array): Promise<SomaOperationResult>;
      read(sandboxId: string, waitMs?: number): Promise<SomaOperationResult>;
      close(sandboxId: string): Promise<SomaOperationResult>;
    };

    close(): Promise<void>;
  }
}
