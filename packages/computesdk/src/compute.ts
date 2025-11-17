/**
 * Compute Singleton - Main API Orchestrator
 *
 * Provides the unified compute.* API and delegates to specialized managers
 */

import { ComputeClient } from '@computesdk/client';
import type { ComputeAPI, CreateSandboxParams, CreateSandboxParamsWithOptionalProvider, ComputeConfig, Sandbox, Provider, TypedSandbox, TypedComputeAPI } from './types';

/**
 * Authorization response from license server
 */
interface AuthorizationResponse {
  jwt: string;
  sandbox_url: string;
  preview_url: string;
}

/**
 * Authorize license key and get JWT token + URLs from license server
 */
async function authorizeApiKey(apiKey: string): Promise<AuthorizationResponse> {
  try {
    const response = await fetch('https://preview.computesdk.com/__api/license/authorize', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key: apiKey,
        increment_usage: 1
      })
    });

    if (!response.ok) {
      throw new Error(`License authorization failed: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.access_token) {
      throw new Error('No JWT token received from license server');
    }

    if (!data.sandbox_url) {
      throw new Error('No sandbox_url received from license server');
    }

    if (!data.preview_url) {
      throw new Error('No preview_url received from license server');
    }

    return {
      jwt: data.access_token,
      sandbox_url: data.sandbox_url,
      preview_url: data.preview_url
    };
  } catch (error) {
    throw new Error(`Failed to authorize API key: ${error}`);
  }
}

/**
 * Install and start compute CLI inside a sandbox
 */
async function installComputeInSandbox(
  sandbox: Sandbox,
  config?: { apiKey?: string; jwt?: string }
): Promise<AuthorizationResponse | null> {
  try {
    console.log('Installing and starting compute CLI in sandbox...');

    // Get JWT token and URLs from API key if provided
    let authResponse: AuthorizationResponse | null = null;
    let jwt = config?.jwt;

    if (config?.apiKey && !jwt) {
      console.log('Authorizing API key and getting JWT token...');
      authResponse = await authorizeApiKey(config.apiKey);
      jwt = authResponse.jwt;
    }

    // Build install command with authentication
    let installCommand = 'curl -fsSL https://computesdk.com/install.sh | sh';

    if (jwt) {
      installCommand = `curl -fsSL https://computesdk.com/install.sh | sh -s -- --access-token ${jwt}`;
    }

    // Run the install script (it will handle installation and starting compute)
    const result = await sandbox.runCommand('sh', ['-c', installCommand]);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to install and start compute CLI: ${result.stderr}`);
    }

    console.log('Compute CLI installed and started successfully');

    return authResponse;
  } catch (error) {
    throw new Error(`Failed to install compute CLI in sandbox: ${error}`);
  }
}

/**
 * Compute singleton implementation - orchestrates all compute operations
 */
class ComputeManager implements ComputeAPI {
  private config: ComputeConfig | null = null;
  private typedState: {
    isTyped: boolean;
    provider: Provider | null;
  } = { isTyped: false, provider: null };
  private computeAuth: { apiKey?: string; jwt?: string } = {};

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
      apiKey: config.apiKey,
      jwt: config.jwt
    };

    // Store compute auth credentials
    this.computeAuth = {
      apiKey: config.apiKey,
      jwt: config.jwt
    };

    // Store typed state for type-aware operations
    this.typedState = {
      isTyped: true,
      provider: actualProvider
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
    create: async (params?: CreateSandboxParams | CreateSandboxParamsWithOptionalProvider): Promise<Sandbox> => {
      const provider = params && 'provider' in params && params.provider ? params.provider : this.getDefaultProvider();
      const options = params?.options;
      const sandbox = await provider.sandbox.create(options);

      // Install compute CLI in the sandbox with auth credentials if available
      const authResponse = await installComputeInSandbox(sandbox, this.computeAuth);

      // If we have authorization info, use ComputeClient instead of provider sandbox
      let finalSandbox: Sandbox = sandbox;
      if (authResponse) {
        finalSandbox = new ComputeClient({
          sandboxUrl: authResponse.sandbox_url,
          sandboxId: sandbox.sandboxId,
          provider: sandbox.provider,
          token: authResponse.jwt
        }) as Sandbox;
      }

      // If we have typed state and no explicit provider passed, cast to typed sandbox
      // This enables proper type inference for getInstance() when using default provider
      if (this.typedState.isTyped && (!params || !('provider' in params && params.provider))) {
        return finalSandbox as TypedSandbox<any>;
      }

      return finalSandbox;
    },

    /**
     * Get an existing sandbox by ID from a provider (or default provider if configured)
     */
    getById: async (providerOrSandboxId: Provider | string, sandboxId?: string): Promise<Sandbox | null> => {
      if (typeof providerOrSandboxId === 'string') {
        // Called with just sandboxId, use default provider
        const provider = this.getDefaultProvider();
        const sandbox = await provider.sandbox.getById(providerOrSandboxId);
        
        // If we have typed state, cast to typed sandbox for proper getInstance() typing
        if (this.typedState.isTyped && sandbox) {
          return sandbox as TypedSandbox<any>;
        }
        
        return sandbox;
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
      const sandboxes = await actualProvider.sandbox.list();
      
      // If we have typed state and no explicit provider passed, cast to typed sandboxes
      if (this.typedState.isTyped && !provider) {
        return sandboxes as TypedSandbox<any>[];
      }
      
      return sandboxes;
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
 * const compute = createCompute({
 *   defaultProvider: e2b({ apiKey: 'your-key' }),
 * });
 * 
 * const sandbox = await compute.sandbox.create();
 * const instance = sandbox.getInstance(); // ✅ Properly typed E2B Sandbox!
 * ```
 */
export function createCompute<TProvider extends Provider>(config: ComputeConfig<TProvider>): TypedComputeAPI<TProvider> {
  const manager = new ComputeManager();

  // Set config directly without calling the public setConfig method
  const actualProvider = config.defaultProvider || config.provider!;
  manager['config'] = {
    provider: actualProvider,
    defaultProvider: actualProvider,
    apiKey: config.apiKey,
    jwt: config.jwt
  };
  manager['typedState'] = {
    isTyped: true,
    provider: actualProvider
  };
  manager['computeAuth'] = {
    apiKey: config.apiKey,
    jwt: config.jwt
  };

  return {
    setConfig: <T extends Provider>(cfg: ComputeConfig<T>) => createCompute(cfg),
    getConfig: () => manager.getConfig(),
    clearConfig: () => manager.clearConfig(),

    sandbox: {
      create: async (params?: Omit<CreateSandboxParamsWithOptionalProvider, 'provider'>) => {
        const sandbox = await manager.sandbox.create(params);
        // The sandbox should now have the correct getInstance typing from the generic Sandbox<TSandbox>
        return sandbox as TypedSandbox<TProvider>;
      },

      getById: async (sandboxId: string) => {
        const sandbox = await manager.sandbox.getById(sandboxId);
        return sandbox ? sandbox as TypedSandbox<TProvider> : null;
      },

      list: async () => {
        const sandboxes = await manager.sandbox.list();
        return sandboxes as TypedSandbox<TProvider>[];
      },

      destroy: async (sandboxId: string) => {
        return await manager.sandbox.destroy(sandboxId);
      }
    }
  } as TypedComputeAPI<TProvider>;
}



