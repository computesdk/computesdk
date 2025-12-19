/**
 * Gateway Provider
 *
 * Built-in provider that communicates with the ComputeSDK gateway for sandbox lifecycle
 * and uses ClientSandbox (from @computesdk/client) for all sandbox operations.
 *
 * Architecture:
 * - Lifecycle operations (create/destroy) → Gateway API
 * - Sandbox operations → ClientSandbox directly
 */

import { Sandbox as ClientSandbox } from '@computesdk/client';
import { createProvider, type BaseProviderConfig } from '../factory';
import { waitForComputeReady } from '../compute-daemon/lifecycle';
import type { Runtime, SandboxInfo } from '../types';
import { calculateBackoff } from '../utils';

/**
 * Gateway provider configuration
 */
export interface GatewayConfig extends BaseProviderConfig {
  /** Gateway URL (default: https://gateway.computesdk.com) */
  gatewayUrl?: string;
  /** ComputeSDK API key for authentication */
  apiKey: string;
  /** Backend provider name (e2b, railway, etc.) */
  provider: string;
  /** Provider-specific headers to pass through to gateway */
  providerHeaders?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  requestTimeout?: number;
  /** Maximum retry attempts for transient failures (default: 3) */
  maxRetries?: number;
  /** Initial retry delay in milliseconds (default: 1000) */
  retryDelay?: number;
  /** HTTP status codes that should trigger a retry (default: [408, 429, 502, 503, 504]) */
  retryableStatuses?: number[];
}

const DEFAULT_GATEWAY_URL = 'https://gateway.computesdk.com';
const DEFAULT_REQUEST_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000;
const DEFAULT_RETRYABLE_STATUSES = [408, 429, 502, 503, 504];

// Track if we've already warned about missing tokens to avoid spam
let hasWarnedAboutMissingToken = false;

/**
 * Custom error class for gateway-specific errors with enhanced context
 */
export class GatewayError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly provider?: string,
    public readonly sandboxId?: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * Helper to call gateway API with timeout, retry logic, and better error handling
 * 
 * Error handling strategy:
 * - 404 (Not Found): Returns { success: false } without throwing - allows callers to handle missing resources gracefully
 * - Other HTTP errors: Throws GatewayError with detailed context - indicates actual API problems
 * - Network errors: Throws GatewayError after retries exhausted
 */
async function gatewayFetch<T>(
  url: string,
  config: GatewayConfig,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T }> {
  const timeout = config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelay = config.retryDelay ?? DEFAULT_RETRY_DELAY;
  const retryableStatuses = config.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();
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
          ...(config.providerHeaders || {}),
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      // Debug logging
      if (process.env.COMPUTESDK_DEBUG) {
        console.log(`[Gateway] ${options.method || 'GET'} ${url} - ${response.status} (${duration}ms)`);
      }

      if (!response.ok) {
        if (response.status === 404) {
          return { success: false };
        }

        const errorText = await response.text().catch(() => response.statusText);
        const requestId = response.headers.get('x-request-id');

        // Check if this error is retryable
        const isRetryable = retryableStatuses.includes(response.status);
        const shouldRetry = isRetryable && attempt < maxRetries;

        if (shouldRetry) {
          const delay = calculateBackoff(attempt, retryDelay);

          if (process.env.COMPUTESDK_DEBUG) {
            console.log(`[Gateway] Retry ${attempt + 1}/${maxRetries} after ${delay.toFixed(0)}ms (status: ${response.status})...`);
          }

          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Build helpful error message
        let errorMessage = `Gateway API error: ${errorText}`;
        if (response.status === 401) {
          errorMessage = `Invalid ComputeSDK API key.\n\nCheck your COMPUTESDK_API_KEY environment variable.\nGet your key at: https://computesdk.com/dashboard`;
        } else if (response.status === 403) {
          errorMessage = `Access forbidden. Your API key may not have permission to use provider "${config.provider}".\n\nVisit https://computesdk.com/dashboard to check your plan.`;
        } else if (response.status === 429) {
          errorMessage = `Rate limit exceeded. Please try again in a moment.\n\nIf this persists, visit https://computesdk.com/dashboard to upgrade your plan.`;
        } else if (response.status >= 500) {
          errorMessage = `Gateway server error (${response.status}). This is temporary - please try again.\n\nIf this persists, check status at https://status.computesdk.com`;
        }

        throw new GatewayError(
          errorMessage,
          response.status,
          config.provider,
          undefined,
          requestId || undefined
        );
      }

      return response.json();
    } catch (error) {
      clearTimeout(timeoutId);

      // If it's already a GatewayError, just rethrow
      if (error instanceof GatewayError) {
        lastError = error;
        throw error;
      }

      // Handle timeout errors
      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = new GatewayError(
          `Request timed out after ${timeout}ms.\n\nThe gateway may be experiencing high load or network issues.\nCheck your connection and try again.`,
          408,
          config.provider
        );

        // Retry on timeout if attempts remain
        if (attempt < maxRetries) {
          const delay = calculateBackoff(attempt, retryDelay);

          if (process.env.COMPUTESDK_DEBUG) {
            console.log(`[Gateway] Retry ${attempt + 1}/${maxRetries} after ${delay.toFixed(0)}ms (timeout)...`);
          }

          await new Promise(resolve => setTimeout(resolve, delay));
          lastError = timeoutError;
          continue;
        }

        throw timeoutError;
      }

      // Handle network errors
      const networkError = new GatewayError(
        `Failed to connect to gateway: ${error instanceof Error ? error.message : String(error)}\n\nCheck your internet connection and gateway URL.`,
        0,
        config.provider
      );

      // Retry on network error if attempts remain
      if (attempt < maxRetries) {
        const delay = calculateBackoff(attempt, retryDelay);

        if (process.env.COMPUTESDK_DEBUG) {
          console.log(`[Gateway] Retry ${attempt + 1}/${maxRetries} after ${delay.toFixed(0)}ms (network error)...`);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
        lastError = networkError;
        continue;
      }

      throw networkError;
    }
  }

  // If we get here, all retries failed
  throw lastError || new Error('Max retries exceeded');
}

/**
 * Gateway Provider factory
 *
 * Uses ClientSandbox directly as the sandbox type - no wrapper needed.
 */
export const gateway = createProvider<ClientSandbox, GatewayConfig>({
  name: 'gateway',
  methods: {
    sandbox: {
      create: async (config, options) => {
        const gatewayUrl = config.gatewayUrl || DEFAULT_GATEWAY_URL;

        const result = await gatewayFetch<{
          sandboxId: string;
          url: string;
          token: string;
          provider: string;
          metadata?: Record<string, unknown>;
        }>(`${gatewayUrl}/sandbox`, config, {
          method: 'POST',
          body: JSON.stringify(options || {}),
        });

        if (!result.success || !result.data) {
          throw new Error(`Gateway returned invalid response: ${JSON.stringify(result)}`);
        }

        const { sandboxId, url, token, provider, metadata } = result.data;

        // Debug logging
        if (process.env.COMPUTESDK_DEBUG) {
          console.log(`[Gateway] Sandbox created:`, {
            sandboxId,
            url,
            hasToken: !!token,
            tokenPrefix: token ? token.substring(0, 10) + '...' : 'none',
            provider,
          });
        }

        // Warn if token is missing (indicates gateway may be running old version)
        // Only warn once to avoid log spam
        if (!token && !hasWarnedAboutMissingToken) {
          hasWarnedAboutMissingToken = true;
          console.warn(
            `[Gateway] No token received from gateway for sandbox ${sandboxId}. ` +
            `Falling back to API key for authentication. ` +
            `This may indicate the gateway is running an outdated version. ` +
            `Check gateway deployment at ${config.gatewayUrl || DEFAULT_GATEWAY_URL}`
          );
        }

        const sandbox = new ClientSandbox({
          sandboxUrl: url,
          sandboxId,
          provider,
          token: token || config.apiKey, // Use token from gateway, fallback to API key
          metadata,
          WebSocket: globalThis.WebSocket,
        });

        await waitForComputeReady(sandbox);

        return { sandbox, sandboxId };
      },

      getById: async (config, sandboxId) => {
        const gatewayUrl = config.gatewayUrl || DEFAULT_GATEWAY_URL;

        const result = await gatewayFetch<{
          url: string;
          token: string;
          provider: string;
          metadata?: Record<string, unknown>;
        }>(`${gatewayUrl}/sandbox/${sandboxId}`, config);

        if (!result.success || !result.data) {
          return null;
        }

        const { url, token, provider, metadata } = result.data;

        // Warn if token is missing on reconnection
        // Only warn once to avoid log spam
        if (!token && !hasWarnedAboutMissingToken) {
          hasWarnedAboutMissingToken = true;
          console.warn(
            `[Gateway] No token received when reconnecting to sandbox ${sandboxId}. ` +
            `Falling back to API key for authentication. ` +
            `This may indicate the gateway is running an outdated version.`
          );
        }

        const sandbox = new ClientSandbox({
          sandboxUrl: url,
          sandboxId,
          provider,
          token: token || config.apiKey, // Use token from gateway, fallback to API key
          metadata,
          WebSocket: globalThis.WebSocket,
        });

        await waitForComputeReady(sandbox);

        return { sandbox, sandboxId };
      },

      list: async () => {
        throw new Error(
          'Gateway provider does not support listing sandboxes. Use getById() with a known sandbox ID instead.'
        );
      },

      destroy: async (config, sandboxId) => {
        const gatewayUrl = config.gatewayUrl || DEFAULT_GATEWAY_URL;

        await gatewayFetch(`${gatewayUrl}/sandbox/${sandboxId}`, config, {
          method: 'DELETE',
        });
      },

      // All operations delegate directly to ClientSandbox
      runCode: async (sandbox, code, runtime) => sandbox.runCode(code, runtime),
      runCommand: async (sandbox, command, args) => sandbox.runCommand(command, args),
      getUrl: async (sandbox, options) => sandbox.getUrl(options),

      getInfo: async (sandbox): Promise<SandboxInfo> => {
        const info = await sandbox.getInfo();
        return {
          id: info.id,
          provider: info.provider,
          runtime: info.runtime as Runtime,
          status: info.status,
          createdAt: info.createdAt,
          timeout: info.timeout,
          metadata: info.metadata || {},
        };
      },

      // Filesystem delegates directly to ClientSandbox
      filesystem: {
        readFile: async (sandbox, path) => sandbox.filesystem.readFile(path),
        writeFile: async (sandbox, path, content) => sandbox.filesystem.writeFile(path, content),
        mkdir: async (sandbox, path) => sandbox.filesystem.mkdir(path),
        readdir: async (sandbox, path) => sandbox.filesystem.readdir(path),
        exists: async (sandbox, path) => sandbox.filesystem.exists(path),
        remove: async (sandbox, path) => sandbox.filesystem.remove(path),
      },

      // getInstance returns the ClientSandbox directly
      getInstance: (sandbox) => sandbox,
    },
  },
});

// Re-export Sandbox type for users who want direct client access
export { Sandbox } from '@computesdk/client';
