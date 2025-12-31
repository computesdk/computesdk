/**
 * @computesdk/provider - Provider Framework
 * 
 * Build custom sandbox providers for ComputeSDK.
 * This package provides the factory and types needed to create providers.
 */

// Export factories
export { defineProvider } from './factory';
export type { 
  ProviderConfig, 
  SandboxMethods, 
  TemplateMethods, 
  SnapshotMethods
} from './factory';

export { defineInfraProvider } from './infra-factory';
export type {
  InfraProviderConfig,
  InfraProviderMethods,
  InfraProvider,
  DaemonConfig
} from './infra-factory';

export { defineGatewayProvider } from './gateway-factory';
export type {
  GatewayProviderConfig,
  GatewayConfig
} from './gateway-factory';

// Export direct mode compute API
export { createCompute } from './compute';
export type { CreateComputeConfig, ComputeAPI } from './compute';

// Export utilities
export { calculateBackoff, escapeShellArg } from './utils';

// Export all types
export type * from './types';
