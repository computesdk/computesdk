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
import { createProvider } from '../factory';
import { waitForComputeReady } from '../compute-daemon/lifecycle';
import type { Runtime, SandboxInfo } from '../types';

/**
 * Gateway provider configuration
 */
export interface GatewayConfig {
  /** Gateway URL (default: https://gateway.computesdk.com) */
  gatewayUrl?: string;
  /** ComputeSDK API key for authentication */
  apiKey: string;
  /** Backend provider name (e2b, railway, etc.) */
  provider: string;
  /** Provider-specific headers to pass through to gateway */
  providerHeaders?: Record<string, string>;
}

const DEFAULT_GATEWAY_URL = 'https://gateway.computesdk.com';

/**
 * Helper to call gateway API and unwrap response
 */
async function gatewayFetch<T>(
  url: string,
  config: GatewayConfig,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: T }> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-ComputeSDK-API-Key': config.apiKey,
      'X-Provider': config.provider,
      ...(config.providerHeaders || {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return { success: false };
    }
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Gateway error (${response.status}): ${errorText}`);
  }

  return response.json();
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
          provider: string;
          metadata?: Record<string, unknown>;
        }>(`${gatewayUrl}/sandbox`, config, {
          method: 'POST',
          body: JSON.stringify(options || {}),
        });

        if (!result.success || !result.data) {
          throw new Error(`Gateway returned invalid response: ${JSON.stringify(result)}`);
        }

        const { sandboxId, url, provider, metadata } = result.data;

        const sandbox = new ClientSandbox({
          sandboxUrl: url,
          sandboxId,
          provider,
          token: config.apiKey,
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
          provider: string;
          metadata?: Record<string, unknown>;
        }>(`${gatewayUrl}/sandbox/${sandboxId}`, config);

        if (!result.success || !result.data) {
          return null;
        }

        const { url, provider, metadata } = result.data;

        const sandbox = new ClientSandbox({
          sandboxUrl: url,
          sandboxId,
          provider,
          token: config.apiKey,
          metadata,
          WebSocket: globalThis.WebSocket,
        });

        await waitForComputeReady(sandbox);

        return { sandbox, sandboxId };
      },

      list: async (config) => {
        const gatewayUrl = config.gatewayUrl || DEFAULT_GATEWAY_URL;

        const result = await gatewayFetch<Array<{
          sandboxId: string;
          url: string;
          provider: string;
          metadata?: Record<string, unknown>;
        }>>(`${gatewayUrl}/sandbox`, config);

        if (!result.success || !Array.isArray(result.data)) {
          return [];
        }

        // Note: ClientSandbox not fully initialized for list results
        // Use getById to get a fully functional sandbox
        return result.data.map((item) => ({
          sandbox: new ClientSandbox({
            sandboxUrl: item.url,
            sandboxId: item.sandboxId,
            provider: item.provider,
            token: config.apiKey,
            metadata: item.metadata,
          }),
          sandboxId: item.sandboxId,
        }));
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
