/**
 * Compute API - Gateway HTTP Implementation
 *
 * Provides the unified compute.* API using direct HTTP calls to the gateway.
 * The `compute` export works as both a singleton and a callable function:
 *
 * - Singleton: `compute.sandbox.create()` (auto-detects from env vars)
 * - Callable: `compute({ provider: 'e2b', ... }).sandbox.create()` (explicit config)
 */

import { Sandbox } from './client';
import { autoConfigureCompute } from './auto-detect';
import { createConfigFromExplicit } from './explicit-config';
import { waitForComputeReady } from './compute-daemon/lifecycle';
import { GATEWAY_URL } from './constants';
import type { ProviderName } from './provider-config';

/**
 * Gateway configuration
 */
interface GatewayConfig {
  apiKey: string;
  gatewayUrl: string;
  provider: string;
  providerHeaders: Record<string, string>;
}

/**
 * Explicit compute configuration for callable mode
 */
export interface ExplicitComputeConfig {
  /** Provider name to use */
  provider: ProviderName;
  /** 
   * ComputeSDK API key (required for gateway mode)
   * @deprecated Use `computesdkApiKey` for clarity
   */
  apiKey?: string;
  /** ComputeSDK API key (required for gateway mode) */
  computesdkApiKey?: string;
  /** Optional gateway URL override */
  gatewayUrl?: string;

  /** Provider-specific configurations */
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
 * Options for creating a sandbox via the gateway
 * 
 * Note: Runtime is determined by the provider, not specified at creation time.
 * Use sandbox.runCode(code, runtime) to specify which runtime to use for execution.
 */
export interface CreateSandboxOptions {
  timeout?: number;
  templateId?: string;
  metadata?: Record<string, any>;
  envs?: Record<string, string>;
  name?: string;
  namespace?: string;
}

/**
 * Options for finding or creating a named sandbox
 */
export interface FindOrCreateSandboxOptions extends CreateSandboxOptions {
  name: string;
  namespace?: string;
}

/**
 * Options for finding a named sandbox
 */
export interface FindSandboxOptions {
  name: string;
  namespace?: string;
}

/**
 * Options for extending sandbox timeout
 */
export interface ExtendTimeoutOptions {
  duration?: number;
}

/**
 * Helper to call gateway API with retry logic
 */
async function gatewayFetch<T>(
  url: string,
  config: GatewayConfig,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T }> {
  const timeout = 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-ComputeSDK-API-Key': config.apiKey,
        'X-Provider': config.provider,
        ...config.providerHeaders,
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 404) {
        return { success: false };
      }

      const errorText = await response.text().catch(() => response.statusText);
      
      // Build helpful error message
      let errorMessage = `Gateway API error: ${errorText}`;
      if (response.status === 401) {
        errorMessage = `Invalid ComputeSDK API key. Check your COMPUTESDK_API_KEY environment variable.`;
      } else if (response.status === 403) {
        errorMessage = `Access forbidden. Your API key may not have permission to use provider "${config.provider}".`;
      }

      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    
    throw error;
  }
}

/**
 * Poll gateway until sandbox status becomes "ready" or timeout
 * Uses same exponential backoff pattern as waitForComputeReady
 *
 * This handles the case where a sandbox is being created by another concurrent
 * request and the gateway returns status: "creating". We poll until it's ready.
 */
async function waitForSandboxStatus(
  config: GatewayConfig,
  endpoint: string,
  body: object,
  options: { maxWaitMs?: number } = {}
): Promise<{ success: boolean; data?: any }> {
  const maxWaitMs = options.maxWaitMs ?? 60000; // 1 minute default (matches gateway timeout)
  const initialDelayMs = 500;
  const maxDelayMs = 2000;
  const backoffFactor = 1.5;

  const startTime = Date.now();
  let currentDelay = initialDelayMs;

  while (Date.now() - startTime < maxWaitMs) {
    const result = await gatewayFetch<any>(endpoint, config, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!result.success || !result.data) {
      return result; // Not found or error
    }

    if (result.data.status !== 'creating') {
      return result; // Ready or legacy (no status field)
    }

    // Still creating - wait and retry
    if (process.env.COMPUTESDK_DEBUG) {
      console.log(`[Compute] Sandbox still creating, waiting ${currentDelay}ms...`);
    }

    await new Promise(resolve => setTimeout(resolve, currentDelay));
    currentDelay = Math.min(currentDelay * backoffFactor, maxDelayMs);
  }

  throw new Error(
    `Sandbox is still being created after ${maxWaitMs}ms. ` +
    `This may indicate the sandbox failed to start. Check your provider dashboard.`
  );
}

/**
 * Compute singleton implementation
 */
class ComputeManager {
  private config: GatewayConfig | null = null;
  private autoConfigured = false;

  /**
   * Lazy auto-configure from environment if not explicitly configured
   */
  private ensureConfigured(): void {
    if (this.config) return;
    if (this.autoConfigured) return;

    const config = autoConfigureCompute();
    this.autoConfigured = true;

    if (config) {
      this.config = config;
    }
  }

  /**
   * Get gateway config, throwing if not configured
   */
  private getGatewayConfig(): GatewayConfig {
    this.ensureConfigured();

    if (!this.config) {
      throw new Error(
        'No ComputeSDK configuration found.\n\n' +
        'Options:\n' +
        '1. Zero-config: Set COMPUTESDK_API_KEY and provider credentials (e.g., E2B_API_KEY)\n' +
        '2. Explicit: Call compute.setConfig({ provider: "e2b", computesdkApiKey: "...", e2b: { apiKey: "..." } })\n' +
        '3. Use provider directly: import { e2b } from \'@computesdk/e2b\'\n\n' +
        'Docs: https://computesdk.com/docs/quickstart'
      );
    }

    return this.config;
  }

  /**
   * Explicitly configure the compute singleton
   * 
   * @example
   * ```typescript
   * import { compute } from 'computesdk';
   * 
   * compute.setConfig({
   *   provider: 'e2b',
   *   apiKey: 'computesdk_xxx',
   *   e2b: { apiKey: 'e2b_xxx' }
   * });
   * 
   * const sandbox = await compute.sandbox.create();
   * ```
   */
  setConfig(config: ExplicitComputeConfig): void {
    const gatewayConfig = createConfigFromExplicit(config);
    this.config = gatewayConfig;
    this.autoConfigured = false;
  }

  sandbox = {
    /**
     * Create a new sandbox
     */
    create: async (options?: CreateSandboxOptions): Promise<Sandbox> => {
      const config = this.getGatewayConfig();

      const result = await gatewayFetch<{
        sandboxId: string;
        url: string;
        token: string;
        provider: string;
        metadata?: Record<string, unknown>;
        name?: string;
        namespace?: string;
      }>(`${config.gatewayUrl}/v1/sandboxes`, config, {
        method: 'POST',
        body: JSON.stringify(options || {}),
      });

      if (!result.success || !result.data) {
        throw new Error(`Gateway returned invalid response`);
      }

      const { sandboxId, url, token, provider, metadata, name, namespace } = result.data;

      const sandbox = new Sandbox({
        sandboxUrl: url,
        sandboxId,
        provider,
        token: token || config.apiKey,
        metadata: {
          ...metadata,
          ...(name && { name }),
          ...(namespace && { namespace }),
        },
        WebSocket: globalThis.WebSocket,
        destroyHandler: async () => {
          await gatewayFetch(`${config.gatewayUrl}/v1/sandboxes/${sandboxId}`, config, {
            method: 'DELETE',
          });
        },
      });

      await waitForComputeReady(sandbox);

      return sandbox;
    },

    /**
     * Get an existing sandbox by ID
     */
    getById: async (sandboxId: string): Promise<Sandbox | null> => {
      const config = this.getGatewayConfig();

      const result = await gatewayFetch<{
        url: string;
        token: string;
        provider: string;
        metadata?: Record<string, unknown>;
      }>(`${config.gatewayUrl}/v1/sandboxes/${sandboxId}`, config);

      if (!result.success || !result.data) {
        return null;
      }

      const { url, token, provider, metadata } = result.data;

      const sandbox = new Sandbox({
        sandboxUrl: url,
        sandboxId,
        provider,
        token: token || config.apiKey,
        metadata,
        WebSocket: globalThis.WebSocket,
        destroyHandler: async () => {
          await gatewayFetch(`${config.gatewayUrl}/v1/sandboxes/${sandboxId}`, config, {
            method: 'DELETE',
          });
        },
      });

      await waitForComputeReady(sandbox);

      return sandbox;
    },

    /**
     * List all active sandboxes
     */
    list: async (): Promise<Sandbox[]> => {
      throw new Error(
        'The gateway does not support listing sandboxes. Use getById() with a known sandbox ID instead.'
      );
    },

    /**
     * Destroy a sandbox
     */
    destroy: async (sandboxId: string): Promise<void> => {
      const config = this.getGatewayConfig();

      await gatewayFetch(`${config.gatewayUrl}/v1/sandboxes/${sandboxId}`, config, {
        method: 'DELETE',
      });
    },

    /**
     * Find existing or create new sandbox by (namespace, name)
     */
    findOrCreate: async (options: FindOrCreateSandboxOptions): Promise<Sandbox> => {
      const config = this.getGatewayConfig();

      const { name, namespace, ...restOptions } = options;

      // Use polling to handle concurrent creation (status: "creating")
      const result = await waitForSandboxStatus(
        config,
        `${config.gatewayUrl}/v1/sandboxes/find-or-create`,
        {
          namespace: namespace || 'default',
          name,
          ...restOptions,
        }
      );

      if (!result.success || !result.data) {
        throw new Error(`Gateway returned invalid response`);
      }

      const { sandboxId, url, token, provider, metadata } = result.data;

      const sandbox = new Sandbox({
        sandboxUrl: url,
        sandboxId,
        provider,
        token: token || config.apiKey,
        metadata: {
          ...metadata,
          name: result.data.name,
          namespace: result.data.namespace,
        },
        WebSocket: globalThis.WebSocket,
        destroyHandler: async () => {
          await gatewayFetch(`${config.gatewayUrl}/v1/sandboxes/${sandboxId}`, config, {
            method: 'DELETE',
          });
        },
      });

      await waitForComputeReady(sandbox);

      return sandbox;
    },

    /**
     * Find existing sandbox by (namespace, name) without creating
     */
    find: async (options: FindSandboxOptions): Promise<Sandbox | null> => {
      const config = this.getGatewayConfig();

      // Use polling to handle concurrent creation (status: "creating")
      const result = await waitForSandboxStatus(
        config,
        `${config.gatewayUrl}/v1/sandboxes/find`,
        {
          namespace: options.namespace || 'default',
          name: options.name,
        }
      );

      if (!result.success || !result.data) {
        return null;
      }

      const { sandboxId, url, token, provider, metadata, name, namespace } = result.data;

      const sandbox = new Sandbox({
        sandboxUrl: url,
        sandboxId,
        provider,
        token: token || config.apiKey,
        metadata: {
          ...metadata,
          name,
          namespace,
        },
        WebSocket: globalThis.WebSocket,
        destroyHandler: async () => {
          await gatewayFetch(`${config.gatewayUrl}/v1/sandboxes/${sandboxId}`, config, {
            method: 'DELETE',
          });
        },
      });

      await waitForComputeReady(sandbox);

      return sandbox;
    },

    /**
     * Extend sandbox timeout/expiration
     */
    extendTimeout: async (sandboxId: string, options?: ExtendTimeoutOptions): Promise<void> => {
      const config = this.getGatewayConfig();
      const duration = options?.duration ?? 900000; // Default to 15 minutes

      await gatewayFetch(`${config.gatewayUrl}/v1/sandboxes/${sandboxId}/extend`, config, {
        method: 'POST',
        body: JSON.stringify({ duration }),
      });
    },
  };
}

/**
 * Singleton instance
 */
const singletonInstance = new ComputeManager();

/**
 * Factory function for explicit configuration
 */
function computeFactory(config: ExplicitComputeConfig): ComputeManager {
  const gatewayConfig = createConfigFromExplicit(config);
  const manager = new ComputeManager();
  manager['config'] = gatewayConfig;
  return manager;
}

/**
 * Callable compute interface - dual nature as both singleton and factory
 * 
 * This interface represents the compute export's two modes:
 * 1. As a ComputeManager singleton (accessed via properties like compute.sandbox)
 * 2. As a factory function (called with config to create new instances)
 */
export interface CallableCompute extends ComputeManager {
  /** Create a new compute instance with explicit configuration */
  (config: ExplicitComputeConfig): ComputeManager;
  /** Explicitly configure the singleton */
  setConfig(config: ExplicitComputeConfig): void;
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
 * // Callable mode (explicit config)
 * const sandbox2 = await compute({
 *   provider: 'e2b',
 *   apiKey: 'computesdk_xxx',
 *   e2b: { apiKey: 'e2b_xxx' }
 * }).sandbox.create();
 * ```
 */
export const compute: CallableCompute = new Proxy(
  computeFactory as any,
  {
    get(_target, prop, _receiver) {
      const singleton = singletonInstance as any;
      const value = singleton[prop];
      if (typeof value === 'function') {
        return value.bind(singletonInstance);
      }
      return value;
    },
    apply(_target, _thisArg, args) {
      return computeFactory(args[0] as ExplicitComputeConfig);
    }
  }
);
