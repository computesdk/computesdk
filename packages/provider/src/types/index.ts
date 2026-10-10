/**
 * Core Types - Types for provider framework
 * 
 * Re-exports universal types from computesdk and adds provider-specific types
 */

// Import and re-export universal types from computesdk (grandmother package)
export type {
  InstanceInterface,
  ComputeKind,
  CodeResult,
  CommandResult,
  InstanceInfo,
  FileEntry,
  RunCommandOptions,
  StartProcessOptions,
  ProcessStatus,
  ProcessHandle,
  InstanceFileSystem,
  CreateInstanceOptions,
  InstanceResourceOptions,
  InstanceEgressOptions,
  InstanceEgressInfo,
  RunloopLaunchParameters,
  VercelSandboxResources,
} from 'computesdk';

// Deprecated Sandbox* aliases for backwards compatibility
export type {
  SandboxInterface,
  SandboxInfo,
  SandboxFileSystem,
  CreateSandboxOptions,
  SandboxResourceOptions,
  SandboxEgressOptions,
  SandboxEgressInfo,
} from 'computesdk';

// Provider-specific types (defined in this package)
// Includes: Provider, ProviderInstance, TypedProviderInstance, and all manager interfaces
export * from './provider';

// Re-export storage types explicitly for clarity
export type {
  StorageObject,
  UploadOptions,
  DownloadResult,
  ListOptions,
  ListResult,
  StorageProvider,
} from './provider';

// Browser provider types
export * from './browser';
