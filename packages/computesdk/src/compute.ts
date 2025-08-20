/**
 * Compute Singleton - Main API Orchestrator
 * 
 * Provides the unified compute.* API and delegates to specialized managers
 */

import type { ComputeAPI, CreateSandboxParams, CreateSandboxParamsWithOptionalProvider, ComputeConfig, Sandbox, Provider } from './types';

/**
 * Compute singleton implementation - orchestrates all compute operations
 */
class ComputeManager implements ComputeAPI {
  private config: ComputeConfig | null = null;

  /**
   * Set default configuration
   */
  setConfig(config: ComputeConfig): void {
    this.config = config;
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
   * Get the default provider, throwing if not configured
   */
  private getDefaultProvider(): Provider {
    if (!this.config?.provider) {
      throw new Error(
        'No default provider configured. Either call compute.setConfig({ provider }) or pass provider explicitly.'
      );
    }
    return this.config.provider;
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
     * // With default provider (both forms work)
     * compute.setConfig({ provider: e2b({ apiKey: 'your-key' }) })
     * const sandbox1 = await compute.sandbox.create({})
     * const sandbox2 = await compute.sandbox.create()
     * ```
     */
    create: async (params?: CreateSandboxParams | CreateSandboxParamsWithOptionalProvider): Promise<Sandbox> => {
      const provider = params && 'provider' in params && params.provider ? params.provider : this.getDefaultProvider();
      const options = params?.options;
      return await provider.sandbox.create(options);
    },

    /**
     * Get an existing sandbox by ID from a provider (or default provider if configured)
     */
    getById: async (providerOrSandboxId: Provider | string, sandboxIdOrOptions?: string | { domain?: string }, options?: { domain?: string }): Promise<Sandbox | null> => {
      if (typeof providerOrSandboxId === 'string') {
        // Called with just sandboxId and options: getById(sandboxId, { domain })
        const provider = this.getDefaultProvider();
        const opts = typeof sandboxIdOrOptions === 'object' ? sandboxIdOrOptions : options;
        return await provider.sandbox.getById(providerOrSandboxId, opts);
      } else {
        // Called with provider, sandboxId, and options: getById(provider, sandboxId, { domain })
        if (typeof sandboxIdOrOptions !== 'string') {
          throw new Error('sandboxId must be a string when provider is specified');
        }
        return await providerOrSandboxId.sandbox.getById(sandboxIdOrOptions, options);
      }
    },

    /**
     * List all active sandboxes from a provider (or default provider if configured)
     */
    list: async (provider?: Provider): Promise<Sandbox[]> => {
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

  // Future: compute.blob.*, compute.database.*, compute.git.* will be added here
  // blob = new BlobManager();
  // database = new DatabaseManager();  
  // git = new GitManager();


}

/**
 * Singleton instance - the main API
 */
export const compute: ComputeAPI = new ComputeManager();

