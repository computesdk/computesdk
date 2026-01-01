/**
 * @computesdk/provider - Provider Framework
 * 
 * Build custom sandbox providers for ComputeSDK.
 * This package provides the factory and types needed to create providers.
 */

// Export factory
export { defineProvider } from './factory';
export type { 
  ProviderConfig, 
  SandboxMethods, 
  TemplateMethods, 
  SnapshotMethods, 
  BaseProviderConfig, 
  ProviderMode 
} from './factory';

// Export direct mode compute API
export { createCompute } from './compute';
export type { CreateComputeConfig, ComputeAPI } from './compute';

// Export utilities
export { calculateBackoff, escapeShellArg } from './utils';

// Export all types
export type * from './types';
