/**
 * Sandbox Types
 * 
 * Types related to sandbox execution, filesystem, terminal operations
 */

// Forward declaration to avoid circular dependency
interface Provider {
  readonly name: string;
  readonly sandbox: any; // Will be properly typed when imported together
}

/**
 * Supported runtime environments
 */
export type Runtime = 'node' | 'python';

/**
 * Sandbox status types
 */
export type SandboxStatus = 'running' | 'stopped' | 'error';

/**
 * Result of code execution
 */
export interface ExecutionResult {
  /** Standard output from the execution */
  stdout: string;
  /** Standard error from the execution */
  stderr: string;
  /** Exit code from the execution */
  exitCode: number;
  /** Time taken for execution in milliseconds */
  executionTime: number;
  /** ID of the sandbox where the code was executed */
  sandboxId: string;
  /** Provider that executed the code */
  provider: string;
}

/**
 * Information about a sandbox
 */
export interface SandboxInfo {
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
 * Options for creating a sandbox
 */
export interface CreateSandboxOptions {
  /** Runtime environment */
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
 * File system entry information
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





/**
 * Base sandbox interface - what developers interact with
 */
export interface Sandbox {
  /** Unique identifier for the sandbox */
  readonly sandboxId: string;
  /** Provider that created this sandbox */
  readonly provider: string;

  /** Execute code in the sandbox */
  runCode(code: string, runtime?: Runtime): Promise<ExecutionResult>;
  /** Execute shell commands */
  runCommand(command: string, args?: string[]): Promise<ExecutionResult>;
  /** Get information about the sandbox */
  getInfo(): Promise<SandboxInfo>;
  /** Get URL for accessing the sandbox on a specific port */
  getUrl(options: { port: number; protocol?: string }): Promise<string>;
  /** Get the provider instance that created this sandbox */
  getProvider(): Provider;
  /** Get the native provider sandbox instance with proper typing */
  getInstance(): any;
  getInstance<T>(): T;
  /** Kill the sandbox */
  kill(): Promise<void>;
  /** Destroy the sandbox and clean up resources */
  destroy(): Promise<void>;

  /** File system operations */
  readonly filesystem: SandboxFileSystem;
}