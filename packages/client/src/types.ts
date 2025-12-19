/**
 * Shared Types - Canonical definitions for ComputeSDK
 *
 * These types are used across the SDK, providers, and client.
 * All other packages should import from here (via @computesdk/client).
 */

/**
 * Supported runtime environments for code execution
 */
export type Runtime = 'node' | 'python';

/**
 * Sandbox status types
 */
export type SandboxStatus = 'running' | 'stopped' | 'error';

/**
 * Options for running commands
 */
export interface RunCommandOptions {
  /** Run command in background (non-blocking) */
  background?: boolean;
  /** Working directory for the command */
  cwd?: string;
}

/**
 * Options for creating a sandbox
 */
export interface CreateSandboxOptions {
  /** Runtime environment (defaults to 'node' if not specified) */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Custom sandbox ID (if supported by provider) */
  sandboxId?: string;
  /** Template ID for sandbox creation (provider-specific) */
  templateId?: string;
  /** Additional metadata for the sandbox */
  metadata?: Record<string, any>;
  /** Domain for sandbox connection (provider-specific) */
  domain?: string;
  /** Environment variables for the sandbox */
  envs?: Record<string, string>;
}

/**
 * File system entry information (provider-agnostic)
 */
export interface FileEntry {
  /** File/directory name */
  name: string;
  /** Full path to the entry */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** File size in bytes (0 for directories) */
  size: number;
  /** Last modified timestamp */
  lastModified: Date;
}

/**
 * File system interface for sandbox operations
 */
export interface SandboxFileSystem {
  /** Read file contents */
  readFile(path: string): Promise<string>;
  /** Write file contents */
  writeFile(path: string, content: string): Promise<void>;
  /** Create directory */
  mkdir(path: string): Promise<void>;
  /** List directory contents */
  readdir(path: string): Promise<FileEntry[]>;
  /** Check if file/directory exists */
  exists(path: string): Promise<boolean>;
  /** Remove file or directory */
  remove(path: string): Promise<void>;
}

/**
 * Provider-agnostic sandbox info (used by providers like e2b, docker, etc.)
 *
 * Note: This is different from the API-specific SandboxInfo in index.ts
 * which represents gateway API responses.
 */
export interface ProviderSandboxInfo {
  /** Unique identifier for the sandbox */
  id: string;
  /** Provider hosting the sandbox */
  provider: string;
  /** Runtime environment in the sandbox */
  runtime: Runtime;
  /** Current status of the sandbox */
  status: SandboxStatus;
  /** When the sandbox was created */
  createdAt: Date;
  /** Execution timeout in milliseconds */
  timeout: number;
  /** Additional provider-specific metadata */
  metadata?: Record<string, any>;
}

/**
 * Error thrown when a command exits with a non-zero status
 */
export class CommandExitError extends Error {
  name = 'CommandExitError';
  constructor(public result: {
    exitCode: number;
    stdout: string;
    stderr: string;
    error: boolean;
  }) {
    super(`Command exited with code ${result.exitCode}`);
  }
}

/**
 * Type guard to check if an error is a CommandExitError
 */
export function isCommandExitError(error: unknown): error is CommandExitError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'CommandExitError' &&
    'result' in error
  );
}
