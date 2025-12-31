/**
 * Compute Factory
 * 
 * Creates compute instance factories for infrastructure providers.
 * Allows providers like Railway to feel like first-class citizens while
 * routing through the gateway.
 */

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
 * Import compute singleton from computesdk
 * This is a regular import, not dynamic, since compute packages
 * explicitly depend on computesdk
 */
function getComputeSingleton(): any {
  try {
    // Use require to avoid issues with ESM/CJS interop
    // The compute package will bundle this properly
    const computeModule = require('computesdk');
    return computeModule.compute;
  } catch (error) {
    throw new Error(
      'Failed to import compute singleton from "computesdk" package. ' +
      'Make sure "computesdk" is installed: npm install computesdk'
    );
  }
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
export function defineCompute<TConfig extends ComputeConfig = ComputeConfig>(
  factoryConfig: ComputeFactoryConfig
): (config: TConfig) => any {
  return (config: TConfig) => {
    const compute = getComputeSingleton();
    
    // Configure compute with provider-specific settings
    compute.setConfig({
      provider: factoryConfig.provider,
      apiKey: config.apiKey,
      gatewayUrl: config.gatewayUrl,
      [factoryConfig.provider]: config,
    });
    
    // Return the configured compute instance
    return compute;
  };
}
