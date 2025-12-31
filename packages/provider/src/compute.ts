/**
 * Direct Mode Compute API
 * 
 * Use this when you want to use providers directly without the gateway.
 * This is the "mother" talking directly to "children" providers.
 */

import type { Provider } from './types';

/**
 * Configuration for creating a compute instance with a provider
 */
export interface CreateComputeConfig<TInstance = any> {
  /** The provider instance to use */
  defaultProvider?: Provider<TInstance>;
  /** Legacy alias for defaultProvider */
  provider?: Provider<TInstance>;
}

/**
 * Compute API for direct provider usage
 */
export interface ComputeAPI<TInstance = any> {
  /** Sandbox management methods */
  sandbox: Provider<TInstance>['sandbox'];
  /** Get current configuration */
  getConfig(): CreateComputeConfig<TInstance> | null;
  /** Update configuration and return new compute instance */
  setConfig<TNewInstance = any>(config: CreateComputeConfig<TNewInstance>): ComputeAPI<TNewInstance>;
  /** Clear configuration */
  clearConfig(): void;
}

/**
 * Create a compute instance with a provider for direct mode
 * 
 * @example
 * ```typescript
 * import { createCompute } from '@computesdk/provider';
 * import { e2bProvider } from '@computesdk/e2b';
 * 
 * const provider = e2bProvider({ apiKey: 'your-key' });
 * const compute = createCompute({ defaultProvider: provider });
 * 
 * const sandbox = await compute.sandbox.create();
 * ```
 */
export function createCompute<TInstance = any>(
  config: CreateComputeConfig<TInstance>
): ComputeAPI<TInstance> {
  const provider = config.defaultProvider || config.provider;
  
  if (!provider) {
    throw new Error(
      'createCompute requires a provider for direct mode. ' +
      'Pass a provider via the defaultProvider or provider config property. ' +
      'For gateway mode, do not use createCompute; use the compute singleton from computesdk instead.'
    );
  }

  let currentConfig: CreateComputeConfig<TInstance> | null = config;

  return {
    sandbox: provider.sandbox,
    
    getConfig() {
      return currentConfig;
    },
    
    setConfig<TNewInstance = any>(newConfig: CreateComputeConfig<TNewInstance>): ComputeAPI<TNewInstance> {
      return createCompute(newConfig);
    },
    
    clearConfig() {
      currentConfig = null;
    }
  };
}
