/**
 * Universal Sandbox Interface
 * 
 * The canonical interface for all ComputeSDK sandboxes.
 * 
 * Core methods (required):
 * - runCode, runCommand, getInfo, getUrl, destroy, filesystem
 * 
 * Advanced features (optional):
 * - terminal, server, watcher, auth, env, etc.
 * 
 * Providers can implement as much or as little as makes sense for their platform.
 * The gateway Sandbox class implements the full specification.
 * 
 * **Note on naming:** This interface is named "Sandbox" in this file for clarity,
 * but is exported as "SandboxInterface" from the main computesdk package to avoid
 * collision with the gateway Sandbox class. The rename happens at export time in
 * src/index.ts. Providers using @computesdk/provider will only see "SandboxInterface".
 * 
 * @example Minimal implementation
 * ```typescript
 * class MinimalSandbox implements Pick<Sandbox, 'sandboxId' | 'provider' | 'runCode' | 'runCommand' | 'getInfo' | 'getUrl' | 'destroy' | 'filesystem'> {
 *   // Just implement core methods
 * }
 * ```
 * 
 * @example Full implementation
 * ```typescript
 * class FullSandbox implements Sandbox {
 *   // Implement everything - core + advanced features
 * }
 * ```
 */

/**
 * Supported runtime environments
 */
export type Runtime = 'node' | 'python' | 'deno' | 'bun';

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
  /** Runtime environment in the sandbox */
  runtime: Runtime;
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
  runtime?: Runtime;
  timeout?: number;
  templateId?: string;
  metadata?: Record<string, any>;
  envs?: Record<string, string>;
  name?: string;
  namespace?: string;
  // Allow provider-specific properties (e.g., sandboxId, domain for E2B)
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
  
  /** Provider name (e2b, railway, modal, gateway, etc.) */
  readonly provider: string;
  
  /** Execute code in the sandbox */
  runCode(code: string, runtime?: Runtime): Promise<CodeResult>;
  
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
  
  // ============================================================================
  // Advanced Features (Optional - Providers implement if supported)
  // ============================================================================
  
  /**
   * Terminal management (interactive PTY and exec modes)
   * Available in: gateway, e2b (potentially)
   */
  readonly terminal?: any; // Terminal type from client
  
  /**
   * Code and command execution namespace
   * Available in: gateway
   */
  readonly run?: any; // Run type from client
  
  /**
   * Managed server operations
   * Available in: gateway
   */
  readonly server?: any; // Server type from client
  
  /**
   * File watcher with real-time change events
   * Available in: gateway
   */
  readonly watcher?: any; // Watcher type from client
  
  /**
   * Session token management
   * Available in: gateway
   */
  readonly sessionToken?: any; // SessionToken type from client
  
  /**
   * Magic link authentication
   * Available in: gateway
   */
  readonly magicLink?: any; // MagicLink type from client
  
  /**
   * Signal service for port/error events
   * Available in: gateway
   */
  readonly signal?: any; // Signal type from client
  
  /**
   * File operations namespace
   * Available in: gateway
   */
  readonly file?: any; // File type from client
  
  /**
   * Environment variable management
   * Available in: gateway
   */
  readonly env?: any; // Env type from client
  
  /**
   * Authentication operations
   * Available in: gateway
   */
  readonly auth?: any; // Auth type from client
  
  /**
   * Child sandbox management
   * Available in: gateway
   */
  readonly child?: any; // Child type from client
}
