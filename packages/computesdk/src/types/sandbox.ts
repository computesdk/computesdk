/**
 * Sandbox Types
 *
 * Types related to sandbox execution, filesystem, terminal operations
 *
 * Key types:
 * - Sandbox: The full-featured sandbox from @computesdk/client (terminals, watchers, signals)
 * - ProviderSandbox: Base interface that provider implementations return (e2b, railway, etc.)
 */

// Re-export the full Sandbox from @computesdk/client
// This is THE Sandbox that users interact with
export { Sandbox, type SandboxConfig } from '@computesdk/client';

// Re-export execution result types from @computesdk/client
// These are the canonical types for code and command execution
export {
  type CodeResult,
  type CommandResult,
  type CodeLanguage,
  type CodeRunOptions,
  type CommandRunOptions,
} from '@computesdk/client';

// Import for use within this file
import type { CodeResult, CommandResult } from '@computesdk/client';

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
  e2b: any;
  vercel: any;
  daytona: any;
}

/**
 * Utility type to extract the native instance type from a provider
 * Uses provider name and manual type inference
 */
export type ExtractSandboxInstanceType<TProvider extends Provider> =
  TProvider extends { readonly name: 'e2b' }
    ? any
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
  /** Working directory for the command */
  cwd?: string;
}

/**
 * Result of code execution (legacy - use CodeResult for new code)
 * @deprecated Use CodeResult for sandbox.run.code() results
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

// CodeResult, CommandResult, CodeLanguage, CodeRunOptions, CommandRunOptions
// are now re-exported from @computesdk/client above

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

// ============================================================================
// Provider Sandbox - Base interface for provider implementations
// ============================================================================

/**
 * Provider sandbox interface - what external providers (e2b, railway, etc.) return
 *
 * This is the base interface that all provider sandboxes must implement.
 * The gateway provider returns the full Sandbox from @computesdk/client which
 * extends this with ComputeClient features (terminals, watchers, signals).
 *
 * @example Provider implementation
 * ```typescript
 * // In @computesdk/e2b
 * const e2bProvider = createProvider<E2BSandbox, E2BConfig>({
 *   name: 'e2b',
 *   methods: {
 *     sandbox: {
 *       create: async (config, options) => {
 *         const sandbox = await E2BSandbox.create({ ... });
 *         return { sandbox, sandboxId: sandbox.id };
 *       },
 *       // ... other methods
 *     }
 *   }
 * });
 * ```
 */
export interface ProviderSandbox<TSandbox = any> {
  /** Unique identifier for the sandbox */
  readonly sandboxId: string;
  /** Provider that created this sandbox */
  readonly provider: string;

  /** Execute code in the sandbox */
  runCode(code: string, runtime?: Runtime): Promise<CodeResult>;
  /** Execute shell commands */
  runCommand(
    commandOrArray: string | [string, ...string[]],
    argsOrOptions?: string[] | RunCommandOptions,
    maybeOptions?: RunCommandOptions
  ): Promise<CommandResult>;
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

// ============================================================================
// Typed Variants
// ============================================================================

/**
 * Extract the sandbox type from a provider
 */
type ExtractProviderSandboxType<TProvider extends Provider> = TProvider extends { readonly __sandboxType: infer TSandbox } ? TSandbox : any;

/**
 * Typed provider sandbox interface that preserves the provider's native instance type
 */
export interface TypedProviderSandbox<TProvider extends Provider> extends Omit<ProviderSandbox<ExtractProviderSandboxType<TProvider>>, 'getProvider'> {
  /** Get the provider instance that created this sandbox with proper typing */
  getProvider(): TProvider;
  /** Get the native provider sandbox instance with proper typing */
  getInstance(): ExtractProviderSandboxType<TProvider>;
}

/**
 * Typed sandbox interface - alias for TypedProviderSandbox for backwards compatibility
 * @deprecated Use TypedProviderSandbox for provider sandboxes, or Sandbox for gateway sandboxes
 */
export type TypedSandbox<TProvider extends Provider> = TypedProviderSandbox<TProvider>;
