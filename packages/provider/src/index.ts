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
  InstanceMethods,
  InstanceLifecycleResult,
  TemplateMethods,
  SnapshotMethods
} from './factory';
/** @deprecated Use {@link InstanceMethods}. */
export type { SandboxMethods } from './factory';

export { defineInfraProvider } from './infra-factory';
export type {
  InfraProviderConfig,
  InfraProviderMethods,
  InfraProvider,
  DaemonConfig
} from './infra-factory';

// Export config gate for providers whose vendor SDK holds process-global state
export { createConfigGate, createConfigStamp } from './config-gate';
export type { ConfigGate, ConfigStamp, InstallConfig } from './config-gate';

// Export egress router setup
export {
  setupInstanceEgress,
  readInstanceEgress,
  EGRESS_SHIM_DIR,
  /** @deprecated Use {@link setupInstanceEgress}. */
  setupSandboxEgress,
  /** @deprecated Use {@link readInstanceEgress}. */
  readSandboxEgress,
} from './egress';

// Export direct mode compute API
export { createCompute } from './compute';
export type { CreateComputeConfig, ComputeAPI } from './compute';

// Export browser provider factory
export { defineBrowserProvider } from './browser-factory';
export type {
  BrowserProviderConfig,
  BrowserSessionMethods,
  BrowserProfileMethods,
  BrowserExtensionMethods,
  BrowserPoolMethods,
  BrowserLogMethods,
  BrowserRecordingMethods,
  BrowserPageMethods,
} from './browser-factory';

// Export utilities
export { calculateBackoff, escapeShellArg } from './utils';

// Export the process-API streaming helper for providers that stream natively
export {
  streamCommandViaProcess,
  TIMEOUT_EXIT_CODE,
  START_FAILURE_EXIT_CODE
} from './stream-process';
export type { StreamedProcess } from './stream-process';

// Export all types
export type * from './types';
