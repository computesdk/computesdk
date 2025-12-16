/**
 * Compute Singleton - Main API Orchestrator
 *
 * Provides the unified compute.* API and delegates to specialized managers
 */

import type { ComputeAPI, CreateSandboxParams, CreateSandboxParamsWithOptionalProvider, ComputeConfig, ProviderSandbox, Provider, TypedProviderSandbox, TypedComputeAPI } from './types';
import { autoConfigureCompute } from './auto-detect';

/**
 * Compute singleton implementation - orchestrates all compute operations
 */
class ComputeManager implements ComputeAPI {
  private config: ComputeConfig | null = null;
  private autoConfigured = false;

  /**
   * Set default configuration with generic type preservation
   */
  setConfig<TProvider extends Provider>(config: ComputeConfig<TProvider>): void {
    // Validate that at least one provider is specified
    if (!config.defaultProvider && !config.provider) {
      throw new Error('Either defaultProvider or provider must be specified in setConfig');
    }

    // Handle backwards compatibility: if both are provided, defaultProvider takes precedence
    if (config.defaultProvider && config.provider) {
      console.warn('Both defaultProvider and provider specified in setConfig. Using defaultProvider. The provider key is deprecated, please use defaultProvider instead.');
    }

    // Normalize config to always have both fields for internal use (backward compatibility)
    const actualProvider = config.defaultProvider || config.provider!;
    this.config = {
      provider: actualProvider,
      defaultProvider: actualProvider,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): ComputeConfig | null {
    return this.config;
  }

  /**
   * Clear current configuration
   */
  clearConfig(): void {
    this.config = null;
  }

  /**
   * Lazy auto-configure from environment if not explicitly configured
   */
  private ensureConfigured(): void {
    // Skip if already configured
    if (this.config) return;

    // Skip if already tried auto-detection
    if (this.autoConfigured) return;

    this.autoConfigured = true;

    // Try auto-detection from environment
    const provider = autoConfigureCompute();
    if (provider) {
      this.config = {
        provider,
        defaultProvider: provider,
      };
    }
  }

  /**
   * Get the default provider, throwing if not configured
   */
  private getDefaultProvider(): Provider {
    // Try auto-configuration first
    this.ensureConfigured();

    const provider = this.config?.defaultProvider || this.config?.provider;
    if (!provider) {
      throw new Error(
        'No default provider configured.\n\n' +
        'Options:\n' +
        '1. Zero-config mode: Set COMPUTESDK_API_KEY and provider credentials (e.g., E2B_API_KEY)\n' +
        '2. Explicit mode: Call compute.setConfig({ defaultProvider }) or pass provider to create()\n\n' +
        'Docs: https://computesdk.com/docs/quickstart'
      );
    }
    return provider;
  }


  sandbox = {
    /**
     * Create a sandbox from a provider (or default provider if configured)
     *
     * @example
     * ```typescript
     * import { e2b } from '@computesdk/e2b'
     * import { compute } from 'computesdk'
     *
     * // With explicit provider
     * const sandbox = await compute.sandbox.create({
     *   provider: e2b({ apiKey: 'your-key' })
     * })
     *
      * // With default provider
      * compute.setConfig({ defaultProvider: e2b({ apiKey: 'your-key' }) })
      * const sandbox = await compute.sandbox.create()
     * ```
     */
    create: async (params?: CreateSandboxParams | CreateSandboxParamsWithOptionalProvider): Promise<ProviderSandbox> => {
      const provider = params && 'provider' in params && params.provider ? params.provider : this.getDefaultProvider();
      const options = params?.options;
      return await provider.sandbox.create(options);
    },

    /**
     * Get an existing sandbox by ID from a provider (or default provider if configured)
     */
    getById: async (providerOrSandboxId: Provider | string, sandboxId?: string): Promise<ProviderSandbox | null> => {
      if (typeof providerOrSandboxId === 'string') {
        // Called with just sandboxId, use default provider
        const provider = this.getDefaultProvider();
        return await provider.sandbox.getById(providerOrSandboxId);
      } else {
        // Called with provider and sandboxId
        if (!sandboxId) {
          throw new Error('sandboxId is required when provider is specified');
        }
        return await providerOrSandboxId.sandbox.getById(sandboxId);
      }
    },

    /**
     * List all active sandboxes from a provider (or default provider if configured)
     */
    list: async (provider?: Provider): Promise<ProviderSandbox[]> => {
      const actualProvider = provider || this.getDefaultProvider();
      return await actualProvider.sandbox.list();
    },

    /**
     * Destroy a sandbox via a provider (or default provider if configured)
     */
    destroy: async (providerOrSandboxId: Provider | string, sandboxId?: string): Promise<void> => {
      if (typeof providerOrSandboxId === 'string') {
        // Called with just sandboxId, use default provider
        const provider = this.getDefaultProvider();
        return await provider.sandbox.destroy(providerOrSandboxId);
      } else {
        // Called with provider and sandboxId
        if (!sandboxId) {
          throw new Error('sandboxId is required when provider is specified');
        }
        return await providerOrSandboxId.sandbox.destroy(sandboxId);
      }
    }
  };
}

/**
 * Singleton instance - the main API (untyped)
 */
export const compute: ComputeAPI = new ComputeManager();


/**
 * Create a compute instance with proper typing
 *
 * @example
 * ```typescript
 * import { e2b } from '@computesdk/e2b'
 * import { createCompute } from 'computesdk'
 *
 * // Zero-config mode (auto-detects from environment)
 * const compute = createCompute();
 * const sandbox = await compute.sandbox.create();
 *
 * // Explicit mode
 * const compute2 = createCompute({
 *   defaultProvider: e2b({ apiKey: 'your-key' }),
 * });
 *
 * const sandbox2 = await compute2.sandbox.create();
 * const instance = sandbox2.getInstance(); // ✅ Properly typed!
 * ```
 */
// Zero-config mode (no arguments)
export function createCompute(): ComputeAPI;
// Explicit mode with provider
export function createCompute<TProvider extends Provider>(
  config: ComputeConfig<TProvider>
): TypedComputeAPI<TProvider>;
// Implementation
export function createCompute<TProvider extends Provider>(
  config?: ComputeConfig<TProvider>
): TypedComputeAPI<TProvider> | ComputeAPI {
  const manager = new ComputeManager();

  // Zero-config mode: No config provided, will auto-detect on first use
  if (!config) {
    return manager as ComputeAPI;
  }

  // Explicit mode: Set config directly
  const actualProvider = config.defaultProvider || config.provider!;
  manager['config'] = {
    provider: actualProvider,
    defaultProvider: actualProvider,
  };

  return {
    setConfig: <T extends Provider>(cfg: ComputeConfig<T>) => createCompute(cfg),
    getConfig: () => manager.getConfig(),
    clearConfig: () => manager.clearConfig(),

    sandbox: {
      create: async (params?: Omit<CreateSandboxParamsWithOptionalProvider, 'provider'>) => {
        const sandbox = await manager.sandbox.create(params);
        return sandbox as TypedProviderSandbox<TProvider>;
      },

      getById: async (sandboxId: string) => {
        const sandbox = await manager.sandbox.getById(sandboxId);
        if (!sandbox) return null;
        return sandbox as TypedProviderSandbox<TProvider>;
      },

      list: async () => {
        const sandboxes = await manager.sandbox.list();
        return sandboxes as TypedProviderSandbox<TProvider>[];
      },

      destroy: async (sandboxId: string) => {
        return await manager.sandbox.destroy(sandboxId);
      }
    }
  } as TypedComputeAPI<TProvider>;
}
