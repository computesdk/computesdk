/**
 * ComputeSDK Types
 * 
 * This file contains all the type definitions for the ComputeSDK.
 */

/**
 * Supported runtime environments
 */
export type Runtime = 'node' | 'python';

/**
 * Supported provider types
 */
export type ProviderType = 'e2b' | 'vercel' | 'cloudflare' | 'fly' | 'auto';

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
 * Configuration for container-based providers
 */
export interface ContainerConfig {
  /** Docker image to use */
  image: string;
  /** Command to run in the container */
  command?: string[];
  /** Environment variables for the container */
  env?: Record<string, string>;
  /** Ports to expose from the container */
  ports?: number[];
  /** Working directory in the container */
  workdir?: string;
}

/**
 * Configuration for creating a compute sandbox
 */
export interface SandboxConfig {
  /** Provider to use for execution */
  provider?: ProviderType;
  /** Runtime environment to use */
  runtime?: Runtime;
  /** Container configuration if using container-based provider */
  container?: string | ContainerConfig;
  /** Execution timeout in milliseconds */
  timeout?: number;
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
 * Basic terminal session information
 */
export interface TerminalSession {
  /** Terminal process ID */
  pid: number;
  /** Terminal command */
  command: string;
  /** Terminal status */
  status: 'running' | 'exited';
  /** Exit code (if exited) */
  exitCode?: number;
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
 * Terminal operations interface for managing terminal sessions in a sandbox
 */
export interface SandboxTerminal {
  /** Create a new interactive terminal session */
  create(options?: TerminalCreateOptions): Promise<InteractiveTerminalSession>;
  /** List active terminal sessions */
  list(): Promise<InteractiveTerminalSession[]>;
}

/**
 * Base provider specification that all providers must implement
 */
export interface BaseComputeSpecification {
  /** Version of the specification */
  specificationVersion: 'v1';
  /** Provider identifier */
  provider: string;
  /** Sandbox identifier */
  sandboxId: string;

  /** Execute code in the sandbox */
  doExecute(code: string, runtime?: Runtime): Promise<ExecutionResult>;
  /** Execute code in a runtime environment */
  runCode(code: string, runtime?: Runtime): Promise<ExecutionResult>;
  /** Execute shell commands */
  runCommand(command: string, args?: string[]): Promise<ExecutionResult>;
  /** Kill the sandbox */
  doKill(): Promise<void>;
  /** Get information about the sandbox */
  doGetInfo(): Promise<SandboxInfo>;
}

/**
 * Provider specification with filesystem support
 */
export interface FilesystemComputeSpecification extends BaseComputeSpecification {
  /** File system operations */
  readonly filesystem: SandboxFileSystem;
}

/**
 * Provider specification with terminal support
 */
export interface TerminalComputeSpecification extends BaseComputeSpecification {
  /** Terminal operations */
  readonly terminal: SandboxTerminal;
}

/**
 * Provider specification with full filesystem and terminal support
 */
export interface FullComputeSpecification extends FilesystemComputeSpecification, TerminalComputeSpecification {}

/**
 * Union type for all possible provider specifications
 */
export type ComputeSpecification = BaseComputeSpecification | FilesystemComputeSpecification | TerminalComputeSpecification | FullComputeSpecification;

/**
 * Base compute sandbox interface that all providers expose
 */
export interface BaseComputeSandbox {
  /** Provider identifier */
  provider: string;
  /** Sandbox identifier */
  sandboxId: string;

  /** Execute code in the sandbox */
  execute(code: string, runtime?: Runtime): Promise<ExecutionResult>;
  /** Execute code in a runtime environment */
  runCode(code: string, runtime?: Runtime): Promise<ExecutionResult>;
  /** Execute shell commands */
  runCommand(command: string, args?: string[]): Promise<ExecutionResult>;
  /** Kill the sandbox */
  kill(): Promise<void>;
  /** Get information about the sandbox */
  getInfo(): Promise<SandboxInfo>;
}

/**
 * Compute sandbox with filesystem support
 */
export interface FilesystemComputeSandbox extends BaseComputeSandbox {
  /** File system operations */
  readonly filesystem: SandboxFileSystem;
}

/**
 * Compute sandbox with terminal support
 */
export interface TerminalComputeSandbox extends BaseComputeSandbox {
  /** Terminal operations */
  readonly terminal: SandboxTerminal;
}

/**
 * Compute sandbox with full filesystem and terminal support
 */
export interface FullComputeSandbox extends FilesystemComputeSandbox, TerminalComputeSandbox {}

/**
 * Union type for all possible compute sandbox types
 */
export type ComputeSandbox = BaseComputeSandbox | FilesystemComputeSandbox | TerminalComputeSandbox | FullComputeSandbox;

/**
 * Parameters for the executeSandbox function
 */
export interface ExecuteSandboxParams {
  /** Sandbox to execute in */
  sandbox: ComputeSandbox;
  /** Code to execute */
  code: string;
  /** Runtime to use */
  runtime?: Runtime;
}

/**
 * Provider registry configuration
 */
export interface ProviderRegistry {
  /** Get a sandbox by ID */
  sandbox(id: string): ComputeSandbox;
}

/**
 * Provider factory function type for base providers
 */
export type BaseProviderFactory = (config?: any) => BaseComputeSandbox;

/**
 * Provider factory function type for filesystem providers
 */
export type FilesystemProviderFactory = (config?: any) => FilesystemComputeSandbox;

/**
 * Provider factory function type for terminal providers
 */
export type TerminalProviderFactory = (config?: any) => TerminalComputeSandbox;

/**
 * Provider factory function type for full-featured providers
 */
export type FullProviderFactory = (config?: any) => FullComputeSandbox;

/**
 * Union type for all provider factory types
 */
export type ProviderFactory = BaseProviderFactory | FilesystemProviderFactory | TerminalProviderFactory | FullProviderFactory;

/**
 * Provider registry map type
 */
export type ProviderMap = Record<string, ProviderFactory>;

/**
 * Terminal session with PTY (pseudo-terminal) support for interactive use
 */
export interface InteractiveTerminalSession extends TerminalSession {
  /** Terminal columns */
  cols: number;
  /** Terminal rows */
  rows: number;
  /** Data stream handler */
  onData?: (data: Uint8Array) => void;
  /** Exit handler */
  onExit?: (exitCode: number) => void;
  /** Write data to this terminal session */
  write(data: Uint8Array | string): Promise<void>;
  /** Resize this terminal session */
  resize(cols: number, rows: number): Promise<void>;
  /** Kill this terminal session */
  kill(): Promise<void>;
}

/**
 * Terminal creation options
 */
export interface TerminalCreateOptions {
  /** Command to run (defaults to shell) */
  command?: string;
  /** Terminal columns */
  cols?: number;
  /** Terminal rows */
  rows?: number;
  /** Environment variables */
  env?: Record<string, string>;
}
