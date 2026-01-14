/**
 * Core Types - Types for provider framework
 * 
 * Re-exports universal types from computesdk and adds provider-specific types
 */

// Import and re-export universal types from computesdk (grandmother package)
export type {
  SandboxInterface,
  Runtime,
  CodeResult,
  CommandResult,
  SandboxInfo,
  FileEntry,
  RunCommandOptions,
  SandboxFileSystem,
  CreateSandboxOptions,
} from 'computesdk';

// Provider-specific types (defined in this package)
// Includes: Provider, ProviderSandbox, TypedProviderSandbox, and all manager interfaces
export * from './provider';
