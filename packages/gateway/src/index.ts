/**
 * @computesdk/gateway - Infrastructure Provider Implementations
 * 
 * Infrastructure-only providers for the ComputeSDK gateway server.
 * These providers handle resource provisioning but don't include native sandbox capabilities.
 * The gateway server installs the ComputeSDK daemon to add sandbox features.
 */

// Export Railway infrastructure provider
export { railway } from './railway.js';
export type { RailwayConfig, RailwayInstance } from './railway.js';

// Re-export infrastructure provider types from @computesdk/provider
export type { InfraProvider, DaemonConfig } from '@computesdk/provider';
