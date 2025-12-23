/**
 * Compute Singleton - Main API Orchestrator
 *
 * Provides the unified compute.* API and delegates to specialized managers.
 * The `compute` export works as both a singleton and a callable function:
 *
 * - Singleton: `compute.sandbox.create()` (auto-detects from env vars)
 * - Callable: `compute({ provider: 'e2b', ... }).sandbox.create()` (explicit config, uses gateway)
 */

import type { ComputeAPI, CreateSandboxParams, CreateSandboxParamsWithOptionalProvider, ComputeConfig, ProviderSandbox, Provider, TypedProviderSandbox, TypedComputeAPI, ExplicitComputeConfig, CallableCompute, FindOrCreateSandboxOptions, FindSandboxOptions, ExtendTimeoutOptions } from './types';
import { autoConfigureCompute } from './auto-detect';
import { createProviderFromConfig } from './explicit-config';

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

    // Try auto-detection from environment
    const provider = autoConfigureCompute();
    
    // Mark as configured after detection completes (success or failure)
    // This prevents retry loops but allows exceptions to propagate
    this.autoConfigured = true;

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
    },

    /**
     * Find existing or create new sandbox by (namespace, name)
     *
     * @example
     * ```typescript
     * // Find or create sandbox for a user's project
     * const sandbox = await compute.sandbox.findOrCreate({
     *   name: 'my-app',
     *   namespace: 'user-123',
     *   timeout: 1800000
     * });
     * ```
     */
    findOrCreate: async (options: FindOrCreateSandboxOptions): Promise<ProviderSandbox> => {
      const provider = this.getDefaultProvider();
      
      if (!provider.sandbox.findOrCreate) {
        throw new Error(
          `Provider '${provider.name}' does not support findOrCreate.\n` +
          `This feature requires gateway provider with named sandbox support.`
        );
      }
      
      return await provider.sandbox.findOrCreate(options);
    },

    /**
     * Find existing sandbox by (namespace, name) without creating
     *
     * @example
     * ```typescript
     * // Find existing sandbox
     * const sandbox = await compute.sandbox.find({
     *   name: 'my-app',
     *   namespace: 'user-123'
     * });
     * 
     * if (sandbox) {
     *   console.log('Found sandbox:', sandbox.sandboxId);
     * }
     * ```
     */
    find: async (options: FindSandboxOptions): Promise<ProviderSandbox | null> => {
      const provider = this.getDefaultProvider();
      
      if (!provider.sandbox.find) {
        throw new Error(
          `Provider '${provider.name}' does not support find.\n` +
          `This feature requires gateway provider with named sandbox support.`
        );
      }
      
      return await provider.sandbox.find(options);
    },

    /**
     * Extend sandbox timeout/expiration
     *
     * @example
     * ```typescript
     * // Extend timeout by 15 minutes (default)
     * await compute.sandbox.extendTimeout('sandbox-123');
     * 
     * // Extend timeout by custom duration
     * await compute.sandbox.extendTimeout('sandbox-123', {
     *   duration: 1800000 // 30 minutes
     * });
     * ```
     */
    extendTimeout: async (sandboxId: string, options?: ExtendTimeoutOptions): Promise<void> => {
      const provider = this.getDefaultProvider();
      
      if (!provider.sandbox.extendTimeout) {
        throw new Error(
          `Provider '${provider.name}' does not support extendTimeout.\n` +
          `This feature requires gateway provider with timeout extension support.`
        );
      }
      
      return await provider.sandbox.extendTimeout(sandboxId, options);
    }
  };
}

/**
 * Singleton instance for property access (internal)
 */
const singletonInstance = new ComputeManager();

/**
 * Factory function for explicit configuration
 * Creates a new compute instance using the gateway provider
 */
function computeFactory(config: ExplicitComputeConfig): ComputeAPI {
  const provider = createProviderFromConfig(config);
  return createCompute({ provider });
}

/**
 * Callable compute - works as both singleton and factory function
 *
 * @example
 * ```typescript
 * import { compute } from 'computesdk';
 *
 * // Singleton mode (auto-detects from env vars)
 * const sandbox1 = await compute.sandbox.create();
 *
 * // Callable mode (explicit config, uses gateway)
 * const sandbox2 = await compute({
 *   provider: 'e2b',
 *   apiKey: 'computesdk_xxx',
 *   e2b: { apiKey: 'e2b_xxx' }
 * }).sandbox.create();
 * ```
 */
export const compute: CallableCompute = new Proxy(
  computeFactory as CallableCompute,
  {
    get(_target, prop, _receiver) {
      // Delegate property access to singleton instance
      const singleton = singletonInstance as unknown as Record<string | symbol, unknown>;
      const value = singleton[prop];
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(singletonInstance);
      }
      return value;
    },
    apply(_target, _thisArg, args) {
      // Handle function call: compute({...})
      return computeFactory(args[0] as ExplicitComputeConfig);
    }
  }
);


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

  const api: TypedComputeAPI<TProvider> = {
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
      },

      findOrCreate: async (options: FindOrCreateSandboxOptions) => {
        const sandbox = await manager.sandbox.findOrCreate(options);
        return sandbox as TypedProviderSandbox<TProvider>;
      },

      find: async (options: FindSandboxOptions) => {
        const sandbox = await manager.sandbox.find(options);
        if (!sandbox) return null;
        return sandbox as TypedProviderSandbox<TProvider>;
      },

      extendTimeout: async (sandboxId: string, options?: ExtendTimeoutOptions) => {
        return await manager.sandbox.extendTimeout(sandboxId, options);
      }
    }
  };
  return api;
}
