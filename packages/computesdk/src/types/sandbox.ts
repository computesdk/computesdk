/**
 * Sandbox Types
 * 
 * Types related to sandbox execution, filesystem, terminal operations
 */

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
 * Terminal session information
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
  /** Terminal columns */
  cols: number;
  /** Terminal rows */
  rows: number;
  /** Write data to this terminal session */
  write(data: Uint8Array | string): Promise<void>;
  /** Resize this terminal session */
  resize(cols: number, rows: number): Promise<void>;
  /** Kill this terminal session */
  kill(): Promise<void>;
  /** Data stream handler */
  onData?: (data: Uint8Array) => void;
  /** Exit handler */
  onExit?: (exitCode: number) => void;
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
  /** Data stream handler */
  onData?: (data: Uint8Array) => void;
  /** Exit handler */
  onExit?: (exitCode: number) => void;
}

/**
 * Terminal operations interface for managing terminal sessions in a sandbox
 */
export interface SandboxTerminal {
  /** Create a new interactive terminal session */
  create(options?: TerminalCreateOptions): Promise<TerminalSession>;
  /** Get existing terminal session by ID */
  getById(terminalId: string): Promise<TerminalSession | null>;
  /** List active terminal sessions */
  list(): Promise<TerminalSession[]>;
  /** Destroy a terminal session */
  destroy(terminalId: string): Promise<void>;
}

/**
 * Factory method definitions for sandbox management operations
 * Used by createProvider() to generate ProviderSandboxManager implementations
 */
export interface SandboxManagerMethods<TSandbox = any, TConfig = any> {
  /** Create a new sandbox */
  create: (config: TConfig, options?: CreateSandboxOptions) => Promise<{ sandbox: TSandbox; sandboxId: string }>;
  /** Get an existing sandbox by ID */
  getById: (config: TConfig, sandboxId: string) => Promise<{ sandbox: TSandbox; sandboxId: string } | null>;
  /** List all active sandboxes */
  list: (config: TConfig) => Promise<Array<{ sandbox: TSandbox; sandboxId: string }>>;
  /** Destroy a sandbox */
  destroy: (config: TConfig, sandboxId: string) => Promise<void>;
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
  /** Kill the sandbox */
  kill(): Promise<void>;
  /** Destroy the sandbox and clean up resources */
  destroy(): Promise<void>;

  /** File system operations */
  readonly filesystem: SandboxFileSystem;
  /** Terminal operations */
  readonly terminal: SandboxTerminal;
}