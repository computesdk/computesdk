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
 * Base config for compute factories - includes common fields plus all provider-specific configs
 */
export interface ComputeConfig {
  /** ComputeSDK API key for gateway authentication */
  apiKey?: string;
  /** Gateway URL override */
  gatewayUrl?: string;

  /** Provider-specific configurations (same as ExplicitComputeConfig) */
  e2b?: { apiKey?: string; projectId?: string; templateId?: string };
  modal?: { tokenId?: string; tokenSecret?: string };
  railway?: { apiToken?: string; projectId?: string; environmentId?: string };
  daytona?: { apiKey?: string };
  vercel?: { oidcToken?: string; token?: string; teamId?: string; projectId?: string };
  runloop?: { apiKey?: string };
  cloudflare?: { apiToken?: string; accountId?: string };
  codesandbox?: { apiKey?: string };
  blaxel?: { apiKey?: string; workspace?: string };
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
export function defineCompute<TConfig extends ComputeConfig>(
  factoryConfig: ComputeFactoryConfig
): (config: TConfig) => CallableCompute {
  return (config: TConfig) => {
    const explicitConfig: ExplicitComputeConfig = {
      provider: factoryConfig.provider,
      apiKey: config.apiKey,
      gatewayUrl: config.gatewayUrl,
      e2b: config.e2b,
      modal: config.modal,
      railway: config.railway,
      daytona: config.daytona,
      vercel: config.vercel,
      runloop: config.runloop,
      cloudflare: config.cloudflare,
      codesandbox: config.codesandbox,
      blaxel: config.blaxel,
    };

    compute.setConfig(explicitConfig);
    return compute;
  };
}
