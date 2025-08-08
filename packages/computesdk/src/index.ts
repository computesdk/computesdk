/**
 * ComputeSDK Core
 * 
 * Clean Provider/Sandbox separation architecture with extensible compute.* API
 */

// Export all types
export * from './types';

// Export compute singleton - the main API
export { compute } from './compute';

// Export managers for advanced usage and testing
export { SandboxManager } from './sandbox';