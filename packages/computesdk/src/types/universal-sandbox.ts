/**
 * Universal Sandbox Interface
 *
 * The canonical interface for all ComputeSDK sandboxes. Providers using
 * @computesdk/provider implement this shape (re-exported as SandboxInterface).
 */

import type { SetupConfig } from '../setup';

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
 * Options for creating a sandbox
 *
 * Providers can extend this with additional properties specific to their implementation
 */
export interface CreateSandboxOptions {
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
  /**
   * Declarative environment spec applied after the sandbox is created.
   * Materializes source code, installs system deps via Nix, and runs install
   * scripts. Build with `defineSetup({...})`.
   */
  setup?: SetupConfig;
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
