/**
 * Compute Singleton - Main API Orchestrator
 *
 * Provides the unified compute.* API and delegates to specialized managers
 */

import type { ComputeAPI, CreateSandboxParams, CreateSandboxParamsWithOptionalProvider, ComputeConfig, Sandbox, Provider, TypedSandbox, TypedComputeAPI, ComputeEnhancedSandbox, TypedEnhancedSandbox } from './types';
import { authorizeApiKey, type AuthorizationResponse } from './auth/license';
import { installComputeDaemon } from './compute-daemon/installer';
import { wrapWithComputeClient } from './sandbox/wrapper';

/**
 * Compute singleton implementation - orchestrates all compute operations
 */
class ComputeManager implements ComputeAPI {
  private config: ComputeConfig | null = null;
  private computeAuth: { apiKey?: string; accessToken?: string } = {};

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
    const accessToken = config.accessToken || config.jwt; // Support both accessToken and deprecated jwt
    this.config = {
      provider: actualProvider,
      defaultProvider: actualProvider,
      apiKey: config.apiKey,
      accessToken: accessToken
    };

    // Store compute auth credentials
    this.computeAuth = {
      apiKey: config.apiKey,
      accessToken: accessToken
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
   * Get the default provider, throwing if not configured
   */
  private getDefaultProvider(): Provider {
    const provider = this.config?.defaultProvider || this.config?.provider;
    if (!provider) {
      throw new Error(
        'No default provider configured. Either call compute.setConfig({ defaultProvider }) or pass provider explicitly.'
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
      * // With default provider (both forms work)
      * compute.setConfig({ defaultProvider: e2b({ apiKey: 'your-key' }) })
      * const sandbox1 = await compute.sandbox.create({})
      * const sandbox2 = await compute.sandbox.create()
     * ```
     */
    create: async (params?: CreateSandboxParams | CreateSandboxParamsWithOptionalProvider): Promise<Sandbox | ComputeEnhancedSandbox> => {
      const provider = params && 'provider' in params && params.provider ? params.provider : this.getDefaultProvider();
      const options = params?.options;
      const sandbox = await provider.sandbox.create(options);

      // Install compute daemon and wrap with ComputeClient if auth is configured
      if (this.computeAuth.apiKey || this.computeAuth.accessToken) {
        // Get access token from API key if needed
        let authResponse: AuthorizationResponse | null = null;
        let accessToken = this.computeAuth.accessToken;

        if (this.computeAuth.apiKey && !accessToken) {
          authResponse = await authorizeApiKey(this.computeAuth.apiKey);
          accessToken = authResponse.access_token;
        }

        // Install compute daemon in the sandbox
        await installComputeDaemon(sandbox, accessToken);

        // Wrap with ComputeClient if we have authorization info
        // This adds features like createTerminal(), createWatcher(), startSignals()
        if (authResponse) {
          return await wrapWithComputeClient(sandbox, authResponse);
        } else if (accessToken) {
          // If we only have access token (no API key), we still need sandbox_url and preview_url
          // For now, we'll use default URLs - this could be improved
          const defaultAuthResponse: AuthorizationResponse = {
            access_token: accessToken,
            sandbox_url: 'https://sandbox.computesdk.com',
            preview_url: 'https://preview.computesdk.com'
          };
          return await wrapWithComputeClient(sandbox, defaultAuthResponse);
        }
      }

      return sandbox;
    },

    /**
     * Get an existing sandbox by ID from a provider (or default provider if configured)
     */
    getById: async (providerOrSandboxId: Provider | string, sandboxId?: string): Promise<Sandbox | null> => {
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
 * // With API key (automatically gets access token from license server)
 * const compute = createCompute({
 *   defaultProvider: e2b({ apiKey: 'your-key' }),
 *   apiKey: 'computesdk_live_...' // Returns enhanced sandboxes
 * });
 *
 * // Or with direct access token
 * const compute2 = createCompute({
 *   defaultProvider: e2b({ apiKey: 'your-key' }),
 *   accessToken: 'your-access-token' // Returns enhanced sandboxes
 * });
 *
 * const sandbox = await compute.sandbox.create();
 * const instance = sandbox.getInstance(); // ✅ Properly typed E2B Sandbox!
 * await sandbox.createTerminal(); // ✅ Enhanced sandbox features!
 * ```
 */
export function createCompute<TProvider extends Provider>(
  config: ComputeConfig<TProvider> & { apiKey: string }
): TypedComputeAPI<TProvider, true>;
export function createCompute<TProvider extends Provider>(
  config: ComputeConfig<TProvider> & { accessToken: string }
): TypedComputeAPI<TProvider, true>;
export function createCompute<TProvider extends Provider>(
  config: ComputeConfig<TProvider> & { jwt: string }
): TypedComputeAPI<TProvider, true>;
export function createCompute<TProvider extends Provider>(
  config: ComputeConfig<TProvider>
): TypedComputeAPI<TProvider, false>;
export function createCompute<TProvider extends Provider>(
  config: ComputeConfig<TProvider>
): TypedComputeAPI<TProvider, boolean> {
  const manager = new ComputeManager();

  // Set config directly without calling the public setConfig method
  const actualProvider = config.defaultProvider || config.provider!;
  const accessToken = config.accessToken || config.jwt; // Support both accessToken and deprecated jwt
  manager['config'] = {
    provider: actualProvider,
    defaultProvider: actualProvider,
    apiKey: config.apiKey,
    accessToken: accessToken
  };
  manager['computeAuth'] = {
    apiKey: config.apiKey,
    accessToken: accessToken
  };

  const isEnhanced = !!(config.apiKey || config.accessToken || config.jwt);

  return {
    setConfig: <T extends Provider>(cfg: ComputeConfig<T>) => createCompute(cfg),
    getConfig: () => manager.getConfig(),
    clearConfig: () => manager.clearConfig(),

    sandbox: {
      create: async (params?: Omit<CreateSandboxParamsWithOptionalProvider, 'provider'>) => {
        const sandbox = await manager.sandbox.create(params);
        // If API key/JWT is configured, the sandbox will be enhanced with ComputeClient features
        // Cast to the appropriate type based on whether it's enhanced or not
        if (isEnhanced) {
          return sandbox as TypedEnhancedSandbox<TProvider>;
        }
        return sandbox as TypedSandbox<TProvider>;
      },

      getById: async (sandboxId: string) => {
        const sandbox = await manager.sandbox.getById(sandboxId);
        if (!sandbox) return null;
        // Type depends on whether auth is configured
        if (isEnhanced) {
          return sandbox as TypedEnhancedSandbox<TProvider>;
        }
        return sandbox as TypedSandbox<TProvider>;
      },

      list: async () => {
        const sandboxes = await manager.sandbox.list();
        // Type depends on whether auth is configured
        if (isEnhanced) {
          return sandboxes as TypedEnhancedSandbox<TProvider>[];
        }
        return sandboxes as TypedSandbox<TProvider>[];
      },

      destroy: async (sandboxId: string) => {
        return await manager.sandbox.destroy(sandboxId);
      }
    }
  } as TypedComputeAPI<TProvider, typeof isEnhanced>;
}



