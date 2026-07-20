/**
 * Universal Sandbox Interface
 *
 * The canonical interface for all ComputeSDK sandboxes. Providers using
 * @computesdk/provider implement this shape (re-exported as SandboxInterface).
 */

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
 * Sandbox information
 */
export interface SandboxInfo {
  /** Unique identifier for the sandbox */
  id: string;
  /** Provider hosting the sandbox */
  provider: string;
  /** Current status of the sandbox */
  status: 'running' | 'stopped' | 'error';
  /** When the sandbox was created */
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
export interface SandboxFileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readdir(path: string): Promise<FileEntry[]>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

/**
 * Resource sizing options for sandbox creation.
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
export interface SandboxResourceOptions {
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
 * Runloop `launch_parameters` shape for sandbox creation.
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
 * Vercel `resources` shape for sandbox creation.
 */
export interface VercelSandboxResources {
  vcpus?: number;
  [key: string]: any;
}

/**
 * Options for creating a sandbox.
 *
 * Extends {@link SandboxResourceOptions} with the core lifecycle fields
 * (timeout, template/snapshot IDs, env, metadata, etc.). Providers can also
 * read additional provider-specific keys via the index signature.
 */
export interface CreateSandboxOptions extends SandboxResourceOptions {
  timeout?: number;
  /** Provider-agnostic template/image ID to boot from */
  templateId?: string;
  /**
   * Snapshot ID to restore from when creating a sandbox.
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
  /** AbortSignal for cancelling sandbox creation and cleaning up orphaned sandboxes */
  signal?: AbortSignal;
  /**
   * Runtime environment for the sandbox (e.g. `'node'`, `'python'`).
   *
   * Read by Isorun, Blaxel, Upstash, Northflank and others to pick a default
   * image when `image` is not set.
   */
  runtime?: string;
  /** Container/VM image to boot from, overriding the provider default. */
  image?: string;
  // Allow provider-specific properties (e.g., domain for E2B)
  [key: string]: any;
}

/**
 * Universal Sandbox Interface
 * 
 * All ComputeSDK sandboxes implement this interface.
 * Core methods are required, advanced features are optional.
 * 
 * Note: Implementations may use slightly different types for return values
 * as long as they are structurally compatible. For example, getInfo() might
 * return additional fields beyond the base SandboxInfo.
 */
export interface Sandbox {
  // ============================================================================
  // Core Properties & Methods (Required)
  // ============================================================================
  
  /** Unique identifier for the sandbox */
  readonly sandboxId: string;
  
  /** Provider name (e2b, railway, modal, etc.) */
  readonly provider: string;
  
  /** 
   * Execute shell command
   * 
   * Send raw command string to the sandbox - no preprocessing.
   * The provider/server handles shell invocation and execution details.
   */
  runCommand(command: string, options?: RunCommandOptions): Promise<CommandResult>;
  
  /** Get information about the sandbox */
  getInfo(): Promise<SandboxInfo>;
  
  /** Get URL for accessing the sandbox on a specific port */
  getUrl(options: { port: number; protocol?: string }): Promise<string>;
  
  /** Destroy the sandbox and clean up resources */
  destroy(): Promise<void>;
  
  /** File system operations */
  readonly filesystem: SandboxFileSystem;
}
