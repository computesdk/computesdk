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

// Re-export shared types from @computesdk/client (canonical source)
export {
  type Runtime,
  type SandboxStatus,
  type RunCommandOptions,
  type CreateSandboxOptions,
  type FileEntry,
  type SandboxFileSystem,
  CommandExitError,
  isCommandExitError,
} from '@computesdk/client';

// Import ProviderSandboxInfo and re-export as SandboxInfo for backwards compatibility
import type { ProviderSandboxInfo } from '@computesdk/client';

/**
 * Information about a sandbox (provider-agnostic)
 * @see ProviderSandboxInfo in @computesdk/client for the canonical definition
 */
export type SandboxInfo = ProviderSandboxInfo;

// Import for use within this file
import type { CodeResult, CommandResult, Runtime, SandboxFileSystem, RunCommandOptions } from '@computesdk/client';

// Forward declaration to avoid circular dependency with provider.ts
interface Provider<TSandbox = any> {
  readonly name: string;
  readonly sandbox: any;
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

  // ============================================================================
  // Enhanced Features (Optional - available on gateway provider's Sandbox)
  // ============================================================================

  /**
   * Create an interactive terminal (PTY or exec mode)
   * @optional Available when using gateway provider
   */
  createTerminal?(options?: {
    shell?: string;
    pty?: boolean;
    encoding?: 'utf8' | 'binary';
  }): Promise<any>;

  /**
   * Create a file system watcher
   * @optional Available when using gateway provider
   */
  createWatcher?(path: string, options?: {
    recursive?: boolean;
    includeContent?: boolean;
  }): Promise<any>;

  /**
   * Send a signal to a process
   * @optional Available when using gateway provider
   */
  sendSignal?(pid: number, signal: string): Promise<void>;
}

// ============================================================================
// Typed Variants
// ============================================================================

/**
 * Extract the sandbox type from a provider using generic inference
 */
type ExtractProviderSandboxType<TProvider> = TProvider extends Provider<infer TSandbox> ? TSandbox : any;

/**
 * Typed provider sandbox interface that preserves the provider's native instance type
 */
export interface TypedProviderSandbox<TProvider extends Provider> extends Omit<ProviderSandbox<ExtractProviderSandboxType<TProvider>>, 'getProvider'> {
  /** Get the provider instance that created this sandbox with proper typing */
  getProvider(): TProvider;
  /** Get the native provider sandbox instance with proper typing */
  getInstance(): ExtractProviderSandboxType<TProvider>;
}
