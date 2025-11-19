/**
 * Compute Singleton - Main API Orchestrator
 *
 * Provides the unified compute.* API and delegates to specialized managers
 */

import { ComputeClient } from '@computesdk/client';
import type { ComputeAPI, CreateSandboxParams, CreateSandboxParamsWithOptionalProvider, ComputeConfig, Sandbox, Provider, TypedSandbox, TypedComputeAPI, ComputeEnhancedSandbox, TypedEnhancedSandbox } from './types';

/**
 * Authorization response from license server
 */
interface AuthorizationResponse {
  access_token: string;
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
      throw new Error('No access token received from license server');
    }

    if (!data.sandbox_url) {
      throw new Error('No sandbox_url received from license server');
    }

    if (!data.preview_url) {
      throw new Error('No preview_url received from license server');
    }

    return {
      access_token: data.access_token,
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
  config?: { apiKey?: string; accessToken?: string }
): Promise<AuthorizationResponse | null> {
  try {
    console.log('Installing and starting compute CLI in sandbox...');

    // Get access token and URLs from API key if provided
    let authResponse: AuthorizationResponse | null = null;
    let accessToken = config?.accessToken;

    if (config?.apiKey && !accessToken) {
      console.log('Authorizing API key and getting access token...');
      authResponse = await authorizeApiKey(config.apiKey);
      accessToken = authResponse.access_token;
    }

    // Build install command with authentication
    let installCommand = 'curl -fsSL https://computesdk.com/install.sh | sh';

    if (accessToken) {
      installCommand = `curl -fsSL https://computesdk.com/install.sh | sh -s -- --access-token ${accessToken}`;
    }

    // Run the install script (it will handle installation and starting compute)
    const result = await sandbox.runCommand('sh', ['-c', installCommand]);

    if (result.exitCode !== 0) {
      throw new Error(`Failed to install and start compute CLI: ${result.stderr}`);
    }

    console.log('Compute CLI installed successfully');

    return authResponse;
  } catch (error) {
    throw new Error(`Failed to install compute CLI in sandbox: ${error}`);
  }
}

/**
 * Wait for compute CLI to be ready by polling the health endpoint
 */
async function waitForComputeReady(client: ComputeClient, maxRetries = 10, delayMs = 1000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await client.health();
      console.log('Compute CLI is ready');
      return;
    } catch (error) {
      if (i === maxRetries - 1) {
        throw new Error(`Compute CLI failed to start after ${maxRetries} attempts: ${error}`);
      }
      console.log(`Waiting for compute CLI to start... (attempt ${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

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

  /**
   * Wrap a provider sandbox with ComputeClient while preserving the original sandbox
   * This adds powerful features like WebSocket terminals, file watchers, and signals
   */
  private async wrapWithComputeClient(originalSandbox: Sandbox, authResponse: AuthorizationResponse): Promise<ComputeEnhancedSandbox> {
    const client = new ComputeClient({
      sandboxUrl: authResponse.sandbox_url,
      sandboxId: originalSandbox.sandboxId,
      provider: originalSandbox.provider,
      token: authResponse.access_token
    });

    // Wait for compute CLI to be ready before returning
    await waitForComputeReady(client);

    // Store the original sandbox for getInstance() and getProvider() calls
    // We create a proxy-like object that delegates most calls to ComputeClient
    // but preserves access to the original provider sandbox
    const wrappedSandbox = Object.assign(client, {
      __originalSandbox: originalSandbox,

      // Override getInstance to return the original provider's instance
      getInstance: () => originalSandbox.getInstance(),

      // Override getProvider to return the original provider
      getProvider: () => originalSandbox.getProvider()
    });

    return wrappedSandbox as ComputeEnhancedSandbox;
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

      // Install compute CLI in the sandbox with auth credentials if available
      const authResponse = await installComputeInSandbox(sandbox, this.computeAuth);

      // Wrap with ComputeClient if we have authorization info
      // This adds features like createTerminal(), createWatcher(), startSignals()
      const finalSandbox = authResponse
        ? await this.wrapWithComputeClient(sandbox, authResponse)
        : sandbox;

      return finalSandbox;
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



