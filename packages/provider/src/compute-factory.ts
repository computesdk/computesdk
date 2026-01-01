/**
 * Compute Factory
 * 
 * Creates compute instance factories for infrastructure providers.
 * Allows providers like Railway to feel like first-class citizens while
 * routing through the gateway.
 */

import { compute } from 'computesdk';

/**
 * Compute factory configuration
 */
export interface ComputeFactoryConfig {
  /** Provider name (must match gateway provider name) */
  provider: string;
}

/**
 * Base config for compute factories
 */
export interface ComputeConfig {
  /** ComputeSDK API key for gateway authentication */
  apiKey?: string;
  /** Gateway URL override */
  gatewayUrl?: string;
}

/**
 * Create a compute instance factory for infrastructure providers
 * 
 * This allows infrastructure providers like Railway to have their own
 * packages while routing through the gateway. Returns a function that
 * creates pre-configured compute instances.
 * 
 * @example
 * ```typescript
 * // Define Railway compute factory
 * export const railway = defineCompute<RailwayConfig>({
 *   provider: 'railway'
 * });
 * 
 * // User code:
 * import { railway } from '@computesdk/railway';
 * 
 * const compute = railway({
 *   apiKey: 'railway_xxx',
 *   projectId: 'project_xxx',
 *   environmentId: 'env_xxx'
 * });
 * 
 * // Full compute API available
 * const sandbox = await compute.sandbox.create();
 * await sandbox.runCode('console.log("hello")');
 * ```
 */
export function defineCompute<TConfig = any>(
  factoryConfig: ComputeFactoryConfig
): (config: TConfig) => typeof compute {
  return (config: TConfig) => {
    // Configure compute with provider-specific settings
    // Type assertion needed here since we accept generic TConfig but setConfig expects ExplicitComputeConfig
    compute.setConfig({
      provider: factoryConfig.provider,
      apiKey: (config as any).apiKey || '',
      gatewayUrl: (config as any).gatewayUrl,
      [factoryConfig.provider]: config,
    } as any);
    
    // Return the configured compute instance
    return compute;
  };
}
