/**
 * Compute Singleton - Main API Orchestrator
 * 
 * Provides the unified compute.* API and delegates to specialized managers
 */

import type { ComputeAPI, CreateSandboxParams, CreateSandboxParamsWithOptionalProvider, ComputeConfig, Sandbox, Provider, Runtime } from './types';
import { SandboxManager } from './sandbox';

/**
 * Request structure for compute operations
 */
export interface ComputeRequest {
  /** Type of operation to perform */
  action: 'execute' | 'create' | 'destroy' | 'getInfo';
  /** Code to execute (for execute action) */
  code?: string;
  /** Runtime environment */
  runtime?: Runtime;
  /** Sandbox ID (for operations on existing sandboxes) */
  sandboxId?: string;
  /** Additional options */
  options?: Record<string, any>;
}

/**
 * Response structure for compute operations
 */
export interface ComputeResponse {
  /** Whether the operation was successful */
  success: boolean;
  /** Error message if operation failed */
  error?: string;
  /** Sandbox ID involved in the operation */
  sandboxId: string;
  /** Provider that handled the operation */
  provider: string;
  /** Execution result (for execute action) */
  result?: {
    stdout: string;
    stderr: string;
    exitCode: number;
    executionTime: number;
  };
  /** Sandbox info (for getInfo action) */
  info?: {
    id: string;
    provider: string;
    runtime: Runtime;
    status: string;
    createdAt: string;
    timeout: number;
  };
}

/**
 * Parameters for handleComputeRequest
 */
export interface HandleComputeRequestParams {
  /** The compute request to handle */
  request: ComputeRequest;
  /** Provider to use for the operation */
  provider: Provider;
}

/**
 * Compute singleton implementation - orchestrates all compute operations
 */
class ComputeManager implements ComputeAPI {
  private sandboxManager = new SandboxManager();
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
     * // With default provider
     * compute.setConfig({ provider: e2b({ apiKey: 'your-key' }) })
     * const sandbox = await compute.sandbox.create({})
     * ```
     */
    create: async (params: CreateSandboxParams | CreateSandboxParamsWithOptionalProvider): Promise<Sandbox> => {
      const provider = 'provider' in params && params.provider ? params.provider : this.getDefaultProvider();
      const options = params.options;
      return await this.sandboxManager.create(provider, options);
    },

    /**
     * Get an existing sandbox by ID from a provider (or default provider if configured)
     */
    getById: async (providerOrSandboxId: Provider | string, sandboxId?: string): Promise<Sandbox | null> => {
      if (typeof providerOrSandboxId === 'string') {
        // Called with just sandboxId, use default provider
        const provider = this.getDefaultProvider();
        return await this.sandboxManager.getById(provider, providerOrSandboxId);
      } else {
        // Called with provider and sandboxId
        if (!sandboxId) {
          throw new Error('sandboxId is required when provider is specified');
        }
        return await this.sandboxManager.getById(providerOrSandboxId, sandboxId);
      }
    },

    /**
     * List all active sandboxes from a provider (or default provider if configured)
     */
    list: async (provider?: Provider): Promise<Sandbox[]> => {
      const actualProvider = provider || this.getDefaultProvider();
      return await this.sandboxManager.list(actualProvider);
    },

    /**
     * Destroy a sandbox via a provider (or default provider if configured)
     */
    destroy: async (providerOrSandboxId: Provider | string, sandboxId?: string): Promise<void> => {
      if (typeof providerOrSandboxId === 'string') {
        // Called with just sandboxId, use default provider
        const provider = this.getDefaultProvider();
        return await this.sandboxManager.destroy(provider, providerOrSandboxId);
      } else {
        // Called with provider and sandboxId
        if (!sandboxId) {
          throw new Error('sandboxId is required when provider is specified');
        }
        return await this.sandboxManager.destroy(providerOrSandboxId, sandboxId);
      }
    }
  };

  // Future: compute.blob.*, compute.database.*, compute.git.* will be added here
  // blob = new BlobManager();
  // database = new DatabaseManager();  
  // git = new GitManager();

  /**
   * Get the sandbox manager (useful for testing)
   */
  getSandboxManager(): SandboxManager {
    return this.sandboxManager;
  }
}

/**
 * Singleton instance - the main API
 */
export const compute: ComputeAPI = new ComputeManager();

/**
 * Handle a compute request - unified API for web frameworks
 * 
 * This function provides a simple way to handle compute requests in web frameworks
 * like Next.js, Nuxt, SvelteKit, Astro, etc.
 * 
 * @example
 * ```typescript
 * import { handleComputeRequest } from 'computesdk';
 * import { e2b } from '@computesdk/e2b';
 * 
 * export async function POST(request: Request) {
 *   const computeRequest = await request.json();
 *   const response = await handleComputeRequest({
 *     request: computeRequest,
 *     provider: e2b({ apiKey: process.env.E2B_API_KEY })
 *   });
 *   
 *   return new Response(JSON.stringify(response), {
 *     status: response.success ? 200 : 500,
 *     headers: { 'Content-Type': 'application/json' }
 *   });
 * }
 * ```
 */
export async function handleComputeRequest(params: HandleComputeRequestParams): Promise<ComputeResponse> {
  const { request, provider } = params;
  
  try {
    switch (request.action) {
      case 'execute': {
        if (!request.code) {
          return {
            success: false,
            error: 'Code is required for execute action',
            sandboxId: '',
            provider: provider.name
          };
        }

        // Create or reuse sandbox
        let sandbox: Sandbox;
        if (request.sandboxId) {
          const existingSandbox = await compute.sandbox.getById(provider, request.sandboxId);
          if (!existingSandbox) {
            return {
              success: false,
              error: `Sandbox with ID ${request.sandboxId} not found`,
              sandboxId: request.sandboxId,
              provider: provider.name
            };
          }
          sandbox = existingSandbox;
        } else {
          sandbox = await compute.sandbox.create({
            provider,
            options: {
              runtime: request.runtime || 'python',
              ...request.options
            }
          });
        }

        // Execute the code
        const result = await sandbox.runCode(request.code, request.runtime);
        
        return {
          success: true,
          sandboxId: sandbox.sandboxId,
          provider: provider.name,
          result: {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            executionTime: result.executionTime
          }
        };
      }

      case 'create': {
        const sandbox = await compute.sandbox.create({
          provider,
          options: {
            runtime: request.runtime || 'python',
            ...request.options
          }
        });

        return {
          success: true,
          sandboxId: sandbox.sandboxId,
          provider: provider.name
        };
      }

      case 'destroy': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for destroy action',
            sandboxId: '',
            provider: provider.name
          };
        }

        await compute.sandbox.destroy(provider, request.sandboxId);
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name
        };
      }

      case 'getInfo': {
        if (!request.sandboxId) {
          return {
            success: false,
            error: 'Sandbox ID is required for getInfo action',
            sandboxId: '',
            provider: provider.name
          };
        }

        const sandbox = await compute.sandbox.getById(provider, request.sandboxId);
        if (!sandbox) {
          return {
            success: false,
            error: `Sandbox with ID ${request.sandboxId} not found`,
            sandboxId: request.sandboxId,
            provider: provider.name
          };
        }

        const info = await sandbox.getInfo();
        
        return {
          success: true,
          sandboxId: request.sandboxId,
          provider: provider.name,
          info: {
            id: info.id,
            provider: info.provider,
            runtime: info.runtime,
            status: info.status,
            createdAt: info.createdAt.toISOString(),
            timeout: info.timeout
          }
        };
      }

      default:
        return {
          success: false,
          error: `Unknown action: ${(request as any).action}`,
          sandboxId: '',
          provider: provider.name
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      sandboxId: request.sandboxId || '',
      provider: provider.name
    };
  }
}