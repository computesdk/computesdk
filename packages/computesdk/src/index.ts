/**
 * ComputeSDK - User-facing SDK
 *
 * Provides the universal Sandbox class and compute API for executing code in remote sandboxes.
 *
 * Zero-Config Mode (Gateway):
 *   Set COMPUTESDK_API_KEY and provider credentials (e.g., E2B_API_KEY)
 *   No explicit configuration needed - auto-detects from environment
 *
 * Explicit Mode (Gateway with inline config):
 *   compute({ provider: 'e2b', apiKey: '...', e2b: { apiKey: '...' } })
 *   Always uses gateway mode, returns new instance
 *
 * Direct Mode (Provider SDKs):
 *   Use @computesdk/provider's createCompute() with provider packages
 *   Bypasses gateway, talks directly to provider APIs
 */

// ============================================================================
// Universal Sandbox Interface & Types  
// ============================================================================

// Export universal Sandbox interface and supporting types
// These are the canonical type definitions that all providers should use
//
// Note: The interface is renamed from "Sandbox" to "SandboxInterface" on export
// to avoid collision with the gateway Sandbox class below. Use "SandboxInterface"
// when writing provider-agnostic code that accepts any sandbox implementation.
export type {
  Sandbox as SandboxInterface,
  Runtime,
  CodeResult,
  CommandResult,
  SandboxInfo,
  FileEntry,
  RunCommandOptions,
  SandboxFileSystem,
  CreateSandboxOptions
} from './types/universal-sandbox';

// ============================================================================
// Sandbox Client - Gateway Implementation
// ============================================================================

// Export gateway Sandbox class (implements the SandboxInterface above)
//
// Usage guide:
// - import { Sandbox } from 'computesdk'           → Gateway Sandbox class (for runtime use)
// - import type { SandboxInterface } from 'computesdk'  → Universal interface (for type annotations)
//
// Use the class when working with gateway sandboxes specifically.
// Use the interface when writing functions that accept any sandbox (gateway, e2b, modal, etc.)
export { Sandbox, Sandbox as GatewaySandbox } from './client';

// Export client-specific types
export type { SandboxStatus, ProviderSandboxInfo } from './client/types';
export { CommandExitError, isCommandExitError } from './client/types';

// Re-export commonly used client utilities
export { 
  TerminalInstance,
  FileWatcher,
  SignalService,
  encodeBinaryMessage,
  decodeBinaryMessage,
  MessageType
} from './client';

// ============================================================================
// Compute API - Gateway HTTP Implementation
// ============================================================================

// Export compute singleton/callable - the main API
// Works as both: compute.sandbox.create() and compute({...}).sandbox.create()
export { compute } from './compute';

// ============================================================================
// Provider Configuration & Detection
// ============================================================================

// Export auto-detection utilities
export {
  isGatewayModeEnabled,
  detectProvider,
  getProviderHeaders,
  autoConfigureCompute
} from './auto-detect';

// Export provider configuration utilities
export {
  GATEWAY_URL,
  PROVIDER_PRIORITY,
  PROVIDER_ENV_VARS,
} from './constants';

export {
  PROVIDER_AUTH,
  PROVIDER_NAMES,
  PROVIDER_HEADERS,
  PROVIDER_ENV_MAP,
  PROVIDER_DASHBOARD_URLS,
  type ProviderName,
  isValidProvider,
  buildProviderHeaders,
  getProviderConfigFromEnv,
  isProviderAuthComplete,
  getMissingEnvVars,
} from './provider-config';

// ============================================================================
// Note: Provider Framework
// ============================================================================

// For building custom providers, use @computesdk/provider
// import { defineProvider } from '@computesdk/provider';
