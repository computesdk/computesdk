/**
 * ComputeSDK Core
 * 
 * Clean Provider/Sandbox separation architecture with extensible compute.* API
 * 
 * Zero-Config Mode (Gateway):
 *   Set COMPUTESDK_API_KEY and provider credentials (e.g., E2B_API_KEY)
 *   No explicit configuration needed - auto-detects from environment
 * 
 * Explicit Mode:
 *   Call compute.setConfig({ defaultProvider }) or use createCompute()
 */

// Export all types
export * from './types';

// Export compute singleton - the main API
export { compute, createCompute } from './compute';

// Export gateway provider - built-in provider for gateway mode
export { gateway, type GatewayConfig } from './providers/gateway';

// Export auto-detection utilities (for advanced usage)
export {
  isGatewayModeEnabled,
  detectProvider,
  getProviderHeaders,
  autoConfigureCompute
} from './auto-detect';

// Export constants
export { GATEWAY_URL, PROVIDER_PRIORITY, PROVIDER_ENV_VARS, type ProviderName } from './constants';

// Export request handler for web framework integration
export { handleComputeRequest } from './request-handler';

// Export compute request/response types
export type {
  ComputeRequest,
  ComputeResponse,
  HandleComputeRequestParams
} from './request-handler';

// Export provider factory for creating custom providers
export { createProvider } from './factory';
export type { ProviderConfig, SandboxMethods, TemplateMethods, SnapshotMethods } from './factory';

// Export error handling utilities (explicitly for clarity)
export { CommandExitError, isCommandExitError } from './types/sandbox';

// Test suite is available separately via @computesdk/test-utils package
