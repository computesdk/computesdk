/**
 * ComputeSDK Core
 * 
 * Clean Provider/Sandbox separation architecture with extensible compute.* API
 */

// Export all types
export * from './types';

// Export compute singleton - the main API
export { compute, createCompute } from './compute';

// Export request handler for web framework integration
export { handleComputeRequest } from './request-handler';

// Export compute request/response types
export type {
  ComputeRequest,
  ComputeResponse,
  HandleComputeRequestParams
} from './request-handler';



// Export provider factory for creating custom providers
export { createProvider, createBackgroundCommand } from './factory';
export type { ProviderConfig, SandboxMethods } from './factory';

// Export error handling utilities (explicitly for clarity)
export { CommandExitError, isCommandExitError } from './types/sandbox';

// Test suite is available separately via @computesdk/test-utils package
