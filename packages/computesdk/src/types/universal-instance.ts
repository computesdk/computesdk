/**
 * Universal Instance Interface
 *
 * The canonical interface for all ComputeSDK compute instances — sandboxes,
 * VMs, and baremetal alike. Providers using @computesdk/provider implement
 * this shape (re-exported as InstanceInterface).
 */

/**
 * The form of compute a provider provisions.
 *
 * - `'sandbox'`: ephemeral isolated environments (E2B, Modal, Daytona, ...)
 * - `'vm'`: virtual machines
 * - `'baremetal'`: dedicated physical hosts
 */
export type ComputeKind = 'sandbox' | 'vm' | 'baremetal';

/**
 * Code execution result
 */
export interface CodeResult {
  output: string;
  exitCode: number;
  language: string;
}

/**
 * Command execution result
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/**
 * Instance information
 */
export interface InstanceInfo {
  /** Unique identifier for the instance */
  id: string;
  /** Provider hosting the instance */
  provider: string;
  /** The form of compute this instance is */
  kind?: ComputeKind;
  /** Current status of the instance */
  status: 'running' | 'stopped' | 'error';
  /** When the instance was created */
  createdAt: Date;
  /** Execution timeout in milliseconds */
  timeout: number;
  /** Additional provider-specific metadata */
  metadata?: Record<string, any>;
}

/**
 * File entry from directory listing
 */
export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: Date;
}

/**
 * Options for running a command
 */
export interface RunCommandOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  background?: boolean;
  /**
   * Callback for streamed stdout chunks when supported by the provider.
   */
  onStdout?: (data: string) => void;
  /**
   * Callback for streamed stderr chunks when supported by the provider.
   */
  onStderr?: (data: string) => void;
}

/**
 * Options for starting an interactive long-running process.
 */
export interface StartProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Open a writable stdin pipe. Default false. */
  stdin?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  onExit?: (result: { exitCode: number | null; signal: string | null }) => void;
  /** Interval for the status-polling fallback used when the daemon's SSE port is not reachable. Default 500. */
  pollIntervalMs?: number;
}

/**
 * Snapshot of a running or exited process started via `startProcess`.
 */
export interface ProcessStatus {
  status: 'running' | 'exited';
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated?: boolean;
}

/**
 * Handle to an interactive process started via `startProcess`.
 */
export interface ProcessHandle {
  readonly pid: number | null;
  readonly jobId: string;
  /** Write to stdin. Rejects if the process was not started with `stdin: true` or has exited. */
  write(data: string | Uint8Array): Promise<void>;
  closeStdin(): Promise<void>;
  /** Current snapshot (daemond `status`). */
  status(): Promise<ProcessStatus>;
  /** Resolve when the process exits (daemond `wait`). Rejects with a `daemond:`-prefixed error if `timeout` elapses first. */
  wait(options?: { timeout?: number }): Promise<CommandResult & { signal: string | null }>;
  kill(signal?: string): Promise<void>;
}

/**
 * Snapshot information
 */
export interface Snapshot {
  /** Unique identifier for the snapshot */
  id: string;
  /** Provider hosting the snapshot */
  provider: string;
  /** When the snapshot was created */
  createdAt: Date;
  /** Additional provider-specific metadata */
  metadata?: Record<string, any>;
}

/**
 * Options for creating a snapshot
 */
export interface CreateSnapshotOptions {
  name?: string;
  metadata?: Record<string, any>;
}

/**
 * Filesystem operations interface
 */
export interface InstanceFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<FileEntry[]>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

/**
 * Resource sizing options for instance creation.
 *
 * These are the cross-provider knobs for CPU, memory, and provider-specific
 * resource selection. Field names intentionally mirror the provider SDKs that
 * consume them, so callers can build a single typed resource map (e.g. keyed
 * by provider name) instead of resorting to `Record<string, any>`. Every field
 * is optional; providers only read the keys they understand and fall back to
 * their own defaults.
 *
 * Units are intentionally not normalized — `memory` is MB for Blaxel/Beam,
 * `memoryMiB`/`memMiB` are MiB for Modal/Isorun, and `memoryMb` is MB for
 * Tensorlake. See each provider's docs for the exact interpretation.
 */
export interface InstanceResourceOptions {
  /** CPU cores (Modal, Beam). Modal: 1 core = 2 vCPUs. */
  cpu?: number;
  /** Hard CPU limit (Modal). */
  cpuLimit?: number;
  /** CPU cores (Tensorlake). */
  cpus?: number;
  /** vCPUs (Isorun). Vercel uses `resources.vcpus` instead. */
  vcpus?: number;
  /** Memory in MB (Blaxel, Beam). */
  memory?: number;
  /** Memory in MiB (Modal). */
  memoryMiB?: number;
  /** Memory in MiB (Isorun). */
  memMiB?: number;
  /** Memory in MB (Tensorlake). */
  memoryMb?: number;
  /** Disk size in MiB (Isorun). */
  diskMiB?: number;
  /** Root disk size in MB (Tensorlake). `ephemeralDiskMb` is also accepted. */
  diskMb?: number;
  /**
   * Vercel resource overrides. Vercel only exposes vCPU control; memory is
   * derived from the vCPU count.
   */
  resources?: VercelSandboxResources;
  /**
   * Runloop-only. Forwarded verbatim into the devbox `launch_parameters`.
   * Use `resource_size_request: 'CUSTOM_SIZE'` with the `custom_*` fields to
   * request an explicit size.
   */
  launch_parameters?: RunloopLaunchParameters;
  /** Northflank billing plan ID (e.g. `'nf-compute-50'`). */
  deploymentPlan?: string;
  /** Upstash box size preset (e.g. `'small'`, `'medium'`, `'large'`). */
  size?: string;
  /** CodeSandbox VM tier. Pass the SDK's `VMTier` value or its string equivalent. */
  vmTier?: string | number;
}

/**
 * Runloop `launch_parameters` shape for instance creation.
 *
 * Only the resource-relevant fields are typed; additional runloop-specific
 * keys pass through via the index signature.
 */
export interface RunloopLaunchParameters {
  keep_alive_time_seconds?: number;
  resource_size_request?:
    | 'X_SMALL'
    | 'SMALL'
    | 'MEDIUM'
    | 'LARGE'
    | 'X_LARGE'
    | '2X_LARGE'
    | 'CUSTOM_SIZE';
  custom_cpu_cores?: number;
  custom_memory_gb?: number;
  custom_disk_size?: number;
  [key: string]: any;
}

/**
 * Vercel `resources` shape for instance creation.
 */
export interface VercelSandboxResources {
  vcpus?: number;
  [key: string]: any;
}

/**
 * Egress routing options for instance creation.
 *
 * When set, the provider writes a self-contained forward-proxy shim into the
 * instance and starts it via `startProcess`. The shim terminates TLS for
 * `credentialedHosts` using a root CA it generates inside the instance, relays
 * those decrypted requests to `injectorUrl` (which attaches real credentials
 * off-box), and CONNECT-tunnels or denies everything else depending on
 * `mode`. The shim never holds a credential value — only host rules, the
 * injector URL, and the injector token.
 *
 * After creation, `instance.egress` carries `{ proxyUrl, caCertPath }` so the
 * caller can export proxy/CA env vars (`HTTPS_PROXY`, `ALL_PROXY`,
 * `GIT_SSL_CAINFO`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`,
 * `SSL_CERT_FILE`) into job containers. See `instanceEgressEnvVars`.
 */
export interface InstanceEgressOptions {
  /** Endpoint the shim relays credentialed requests to. */
  injectorUrl: string;
  /** Token the shim presents to the injector. Not a credential. */
  injectorToken?: string;
  /**
   * Hostnames whose TLS the shim terminates and relays. Exact hostnames or
   * `"*.suffix.com"` wildcards (a wildcard also covers the bare suffix).
   */
  credentialedHosts: string[];
  /**
   * `'passthrough'` (default): non-credentialed hosts are CONNECT-tunneled
   * directly upstream. `'allowlist'`: non-credentialed requests get a 403.
   */
  mode?: 'passthrough' | 'allowlist';
  /**
   * Loopback port the shim binds inside the instance. `0` (default) picks an
   * ephemeral port; the bound port is reported on `instance.egress.port`.
   */
  port?: number;
}

/**
 * Egress router state attached to an instance created with `egress`.
 */
export interface InstanceEgressInfo {
  /** Loopback proxy URL to export as `HTTPS_PROXY`/`ALL_PROXY` (e.g. `http://127.0.0.1:43111`). */
  proxyUrl: string;
  /** Absolute path of the shim's generated root CA certificate (PEM). */
  caCertPath: string;
  /**
   * Absolute path of a bundle containing the shim's CA prepended to the
   * instance's public trust store — point CA env vars that REPLACE the
   * default bundle at this so passthrough traffic still verifies.
   */
  caBundlePath?: string;
  /** Bound port of the shim's loopback listener. */
  port: number;
  /** PID of the router process inside the instance (for liveness checks). */
  pid?: number;
  /** Daemon job ID of the running router process (`ProcessHandle.jobId`). */
  processJobId: string;
}

/**
 * Options for creating an instance.
 *
 * Extends {@link InstanceResourceOptions} with the core lifecycle fields
 * (timeout, template/snapshot IDs, env, metadata, etc.). Providers can also
 * read additional provider-specific keys via the index signature.
 */
export interface CreateInstanceOptions extends InstanceResourceOptions {
  /**
   * Restrict creation to providers of a given compute form
   * (`'sandbox' | 'vm' | 'baremetal'`). Providers declare their form via
   * `ProviderConfig.kind` (default `'sandbox'`). Unset = any provider.
   */
  kind?: ComputeKind;
  /**
   * Select the provider's ephemeral compute surface when it offers both
   * ephemeral and persistent instances.
   *
   * - `true`: lightweight/ephemeral surface — Upstash `EphemeralBox`,
   *   Archil serverless exec, Cloud Run `sandbox do`.
   * - `false`: durable VM/instance — Upstash `Box`, Archil persistent
   *   sandbox, Cloud Run stateful session.
   * - unset: the provider's configured default.
   *
   * Providers that offer only one surface ignore this field.
   */
  ephemeral?: boolean;
  timeout?: number;
  /** Provider-agnostic template/image ID to boot from */
  templateId?: string;
  /**
   * Snapshot ID to restore from when creating an instance.
   *
   * Each provider maps this to its native concept:
   * - E2B: passed directly as the template/image ID
   * - Daytona: sets `createParams.snapshot`
   * - Modal: loads the image via `client.images.fromId(snapshotId)`
   * - CodeSandbox: calls `sdk.sandboxes.resume(snapshotId)`
   * - Runloop: maps to `snapshot_id` in devbox creation params
   */
  snapshotId?: string;
  metadata?: Record<string, any>;
  envs?: Record<string, string>;
  name?: string;
  namespace?: string;
  directory?: string;
  /** AbortSignal for cancelling instance creation and cleaning up orphaned instances */
  signal?: AbortSignal;
  /**
   * Runtime environment for the instance (e.g. `'node'`, `'python'`).
   *
   * Read by Isorun, Blaxel, Upstash, Northflank and others to pick a default
   * image when `image` is not set.
   */
  runtime?: string;
  /** Container/VM image to boot from, overriding the provider default. */
  image?: string;
  /**
   * Egress routing: run the on-box router shim so credentialed hosts are
   * MITM'd and relayed to an off-box credential injector. See
   * {@link InstanceEgressOptions}. Providers that cannot host the shim throw
   * an `egress:`-prefixed error instead of silently ignoring the option.
   *
   * The `string`/`string[]` forms are reserved for providers that used this
   * option name before the router existed (givemeanode's `'open' | 'none'`,
   * createos-sandbox's network allow-list); they do not activate the router.
   */
  egress?: InstanceEgressOptions | string | string[];
  // Allow provider-specific properties (e.g., domain for E2B)
  [key: string]: any;
}

/**
 * Universal Instance Interface
 *
 * All ComputeSDK compute instances implement this interface, whatever their
 * form — sandbox, VM, or baremetal.
 * Core methods are required, advanced features are optional.
 *
 * Note: Implementations may use slightly different types for return values
 * as long as they are structurally compatible. For example, getInfo() might
 * return additional fields beyond the base InstanceInfo.
 */
export interface Instance {
  // ============================================================================
  // Core Properties & Methods (Required)
  // ============================================================================

  /** Unique identifier for the instance */
  readonly instanceId: string;

  /**
   * @deprecated Use `instanceId`. Kept for backwards compatibility; always
   * identical to `instanceId`.
   */
  readonly sandboxId: string;

  /** Provider name (e2b, railway, modal, etc.) */
  readonly provider: string;

  /**
   * Execute shell command
   *
   * Send raw command string to the instance - no preprocessing.
   * The provider/server handles shell invocation and execution details.
   */
  runCommand(command: string, options?: RunCommandOptions): Promise<CommandResult>;

  /**
   * Start an interactive long-running process.
   *
   * Runs `sh -lc <command>` via the on-instance daemon, returning a handle for
   * stdin writes, status snapshots, output callbacks, and wait/kill control.
   */
  startProcess(command: string, options?: StartProcessOptions): Promise<ProcessHandle>;

  /** Get information about the instance */
  getInfo(): Promise<InstanceInfo>;

  /** Get URL for accessing the instance on a specific port */
  getUrl(options: { port: number; protocol?: string }): Promise<string>;

  /** Destroy the instance and clean up resources */
  destroy(): Promise<void>;

  /** File system operations */
  readonly filesystem: InstanceFileSystem;

  /**
   * Egress router details, set when the instance was created with
   * `CreateInstanceOptions.egress`. Undefined otherwise.
   */
  readonly egress?: InstanceEgressInfo;
}
