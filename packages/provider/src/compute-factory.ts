/**
 * Compute Factory
 *
 * Creates compute instance factories for infrastructure providers.
 * Allows providers like Railway to feel like first-class citizens while
 * routing through the gateway.
 */

import { compute, type CallableCompute, type ExplicitComputeConfig, type ProviderName } from 'computesdk';

/**
 * Compute factory configuration
 */
export interface ComputeFactoryConfig {
  /** Provider name (must match gateway provider name) */
  provider: ProviderName;
}

/**
 * Base config for compute factories.
 * Omits 'provider' since that's set by the factory, not the user.
 */
export type ComputeConfig = Omit<ExplicitComputeConfig, 'provider'>;

/**
 * Create a compute instance factory for infrastructure providers
 *
 * This allows infrastructure providers like Railway to have their own
 * packages while routing through the gateway. Returns a function that
 * creates pre-configured compute instances.
 *
 * **Note:** This configures the global `compute` singleton. The returned
 * instance shares global state - calling this multiple times with different
 * configs will override previous configurations. This is intentional as
 * the compute singleton is designed to be configured once per application.
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
export function defineCompute<TConfig extends ComputeConfig>(
  factoryConfig: ComputeFactoryConfig
): (config: TConfig) => CallableCompute {
  return (config: TConfig) => {
    compute.setConfig({
      ...config,
      provider: factoryConfig.provider,
    });
    return compute;
  };
}
