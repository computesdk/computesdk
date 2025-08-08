/**
 * ComputeSDK Core
 * 
 * Clean Provider/Sandbox separation architecture with extensible compute.* API
 */

// Export all types
export * from './types';

// Export compute singleton - the main API
export { compute, handleComputeRequest } from './compute';

// Export compute request/response types
export type { 
  ComputeRequest, 
  ComputeResponse, 
  HandleComputeRequestParams 
} from './compute';

// Export managers for advanced usage and testing
export { SandboxManager } from './sandbox';

// Export provider factory for creating custom providers
export { createProvider } from './factory';
export type { ProviderConfig, SandboxMethods } from './factory';
export type { SandboxManagerMethods } from './types';

// Test suite is available separately via @computesdk/test-utils package