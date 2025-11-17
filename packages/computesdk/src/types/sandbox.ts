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
 * Type mapping for provider names to their sandbox types
 * Manually defined for known providers since declaration merging isn't working reliably
 */
export interface ProviderSandboxTypeMap {
  e2b: any; // We can't import the E2B type directly, but we'll handle it differently
  vercel: any;
  daytona: any;
}

/**
 * Utility type to extract the native instance type from a provider
 * Uses provider name and manual type inference
 */
export type ExtractSandboxInstanceType<TProvider extends Provider> = 
  TProvider extends { readonly name: 'e2b' }
    ? any // For now, let's just try to make the runtime casting work
    : TProvider extends { readonly name: 'vercel' }
      ? any
      : TProvider extends { readonly name: 'daytona' }
        ? any
        : any;

/**
 * Supported runtime environments
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
}

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
  /** Process ID for background jobs (if applicable) */
  pid?: number;
  /** Whether this command is running in background */
  isBackground?: boolean;
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
export interface Sandbox<TSandbox = any> {
  /** Unique identifier for the sandbox */
  readonly sandboxId: string;
  /** Provider that created this sandbox */
  readonly provider: string;

  /** Execute code in the sandbox */
  runCode(code: string, runtime?: Runtime): Promise<ExecutionResult>;
  /** Execute shell commands */
  runCommand(command: string, args?: string[], options?: RunCommandOptions): Promise<ExecutionResult>;
  /** Get information about the sandbox */
  getInfo(): Promise<SandboxInfo>;
  /** Get URL for accessing the sandbox on a specific port */
  getUrl(options: { port: number; protocol?: string }): Promise<string>;
  /** Get the provider instance that created this sandbox */
  getProvider(): import('./provider').Provider<TSandbox>;
  /** Get the native provider sandbox instance with proper typing */
  getInstance(): TSandbox;
  /** Kill the sandbox */
  kill(): Promise<void>;
  /** Destroy the sandbox and clean up resources */
  destroy(): Promise<void>;

  /** File system operations */
  readonly filesystem: SandboxFileSystem;
}

/**
 * Extract the sandbox type from a provider
 */
type ExtractProviderSandboxType<TProvider extends Provider> = TProvider extends { readonly __sandboxType: infer TSandbox } ? TSandbox : any;

/**
 * Typed sandbox interface that preserves the provider's native instance type
 */
export interface TypedSandbox<TProvider extends Provider> extends Omit<Sandbox<ExtractProviderSandboxType<TProvider>>, 'getProvider'> {
  /** Get the provider instance that created this sandbox with proper typing */
  getProvider(): TProvider;
  /** Get the native provider sandbox instance with proper typing */
  getInstance(): ExtractProviderSandboxType<TProvider>;
}

/**
 * Enhanced sandbox type that includes ComputeClient features
 *
 * When a sandbox is created with an API key/JWT, it gets wrapped with ComputeClient
 * which adds powerful features like WebSocket terminals, file watchers, and signals.
 *
 * @example
 * ```typescript
 * const sandbox = await compute.sandbox.create();
 *
 * // ComputeClient features (only available when API key is configured)
 * const terminal = await sandbox.createTerminal();
 * const watcher = await sandbox.createWatcher('/home/project');
 * const signals = await sandbox.startSignals();
 *
 * // Original sandbox features still work
 * await sandbox.runCommand('ls');
 * const instance = sandbox.getInstance();
 * ```
 */
export type ComputeEnhancedSandbox<TSandbox = any> = Sandbox<TSandbox> & {
  /** The original provider sandbox instance */
  __originalSandbox: Sandbox<TSandbox>;

  // ComputeClient enhanced features
  /** Create a persistent terminal session with WebSocket integration */
  createTerminal(shell?: string, encoding?: 'raw' | 'base64'): Promise<import('@computesdk/client').Terminal>;
  /** Create a file watcher with real-time change notifications */
  createWatcher(path: string, options?: {
    includeContent?: boolean;
    ignored?: string[];
    encoding?: 'raw' | 'base64';
  }): Promise<import('@computesdk/client').FileWatcher>;
  /** Start the signal service for port and error monitoring */
  startSignals(): Promise<import('@computesdk/client').SignalService>;
  /** Execute a one-off command without creating a persistent terminal */
  execute(options: { command: string; shell?: string }): Promise<any>;
  /** List all active terminals */
  listTerminals(): Promise<any[]>;
  /** Get terminal by ID */
  getTerminal(id: string): Promise<any>;
  /** List all active file watchers */
  listWatchers(): Promise<any>;
  /** Get file watcher by ID */
  getWatcher(id: string): Promise<any>;
  /** Get signal service status */
  getSignalStatus(): Promise<any>;
  /** Create a session token (requires access token) */
  createSessionToken(options?: { description?: string; expiresIn?: number }): Promise<any>;
  /** List all session tokens (requires access token) */
  listSessionTokens(): Promise<any>;
  /** Get session token details (requires access token) */
  getSessionToken(tokenId: string): Promise<any>;
  /** Revoke a session token (requires access token) */
  revokeSessionToken(tokenId: string): Promise<void>;
  /** Create a magic link for browser authentication (requires access token) */
  createMagicLink(options?: { redirectUrl?: string }): Promise<any>;
  /** Check authentication status */
  getAuthStatus(): Promise<any>;
  /** Get authentication information */
  getAuthInfo(): Promise<any>;
  /** Set authentication token manually */
  setToken(token: string): void;
  /** Get current authentication token */
  getToken(): string | null;
  /** Get current sandbox URL */
  getSandboxUrl(): string;
  /** Disconnect WebSocket connection */
  disconnect(): Promise<void>;
}

/**
 * Typed enhanced sandbox that preserves both provider typing and ComputeClient features
 */
export type TypedEnhancedSandbox<TProvider extends Provider> =
  ComputeEnhancedSandbox<ExtractProviderSandboxType<TProvider>> &
  Omit<TypedSandbox<TProvider>, keyof Sandbox>;