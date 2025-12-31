/**
 * Client Types
 *
 * Types specific to the gateway Sandbox client implementation.
 * Core universal types are imported from ../types/universal-sandbox
 */

// Import universal types
import type {
  Runtime as UniversalRuntime,
  CodeResult,
  CommandResult,
  SandboxInfo,
  FileEntry as UniversalFileEntry,
  RunCommandOptions as UniversalRunCommandOptions,
  SandboxFileSystem as UniversalSandboxFileSystem,
  CreateSandboxOptions as UniversalCreateSandboxOptions,
} from '../types/universal-sandbox';

// Re-export universal types for backward compatibility
export type {
  CodeResult,
  CommandResult,
  SandboxInfo,
  UniversalRuntime as Runtime,
  UniversalFileEntry as FileEntry,
  UniversalRunCommandOptions as RunCommandOptions,
  UniversalSandboxFileSystem as SandboxFileSystem,
  UniversalCreateSandboxOptions as CreateSandboxOptions,
};

/**
 * Sandbox status types (client-specific, more limited than universal)
 */
export type SandboxStatus = 'running' | 'stopped' | 'error';

/**
 * Provider-agnostic sandbox info (alias for SandboxInfo for backward compatibility)
 */
export interface ProviderSandboxInfo {
  /** Unique identifier for the sandbox */
  id: string;
  /** Provider hosting the sandbox */
  provider: string;
  /** Runtime environment in the sandbox */
  runtime: UniversalRuntime;
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
