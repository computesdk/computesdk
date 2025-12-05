/**
 * Gateway Provider
 *
 * Built-in provider that communicates with the ComputeSDK gateway for sandbox lifecycle
 * and uses ComputeClient for all sandbox operations.
 *
 * This enables zero-config usage where users don't need provider-specific packages.
 *
 * Architecture:
 * - Lifecycle operations (create/destroy) → Gateway API
 * - Sandbox operations (runCode, filesystem, terminals, etc.) → ComputeClient
 * - ComputeClient talks directly to the compute daemon running in the sandbox
 */

import { ComputeClient } from '@computesdk/client';
import { createProvider } from '../factory';
import { waitForComputeReady } from '../compute-daemon/lifecycle';
import type { Runtime, ExecutionResult, SandboxInfo, FileEntry } from '../types';

/**
 * Internal sandbox state - holds ComputeClient and gateway metadata
 */
interface GatewaySandboxInternal {
  client: ComputeClient;
  sandboxId: string;
  url: string;
  backendProvider: string;
  metadata?: Record<string, unknown>;
}

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
 * Gateway Provider factory
 *
 * This provider is built into computesdk (not a separate package) and provides
 * zero-config gateway mode functionality with full ComputeClient capabilities.
 */
export const gateway = createProvider<GatewaySandboxInternal, GatewayConfig>({
  name: 'gateway',
  methods: {
    sandbox: {
      /**
       * Create sandbox via gateway, then initialize ComputeClient
       */
      create: async (config, options) => {
        const gatewayUrl = config.gatewayUrl || DEFAULT_GATEWAY_URL;

        // Create sandbox via gateway API
        const response = await fetch(`${gatewayUrl}/sandbox`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ComputeSDK-API-Key': config.apiKey,
            'X-Provider': config.provider,
            ...(config.providerHeaders || {})
          },
          body: JSON.stringify(options || {})
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => response.statusText);
          throw new Error(`Gateway error (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        if (!data.success || !data.data) {
          throw new Error(`Gateway returned invalid response: ${JSON.stringify(data)}`);
        }

        const sandboxId = data.data.sandboxId;
        const sandboxUrl = data.data.url;
        const backendProvider = data.data.provider;

        // Create ComputeClient connected to the sandbox
        const client = new ComputeClient({
          sandboxUrl: sandboxUrl,
          sandboxId: sandboxId,
          provider: backendProvider,
          token: config.apiKey,
          WebSocket: globalThis.WebSocket
        });

        // Wait for compute daemon to be ready
        await waitForComputeReady(client);

        const sandbox: GatewaySandboxInternal = {
          client,
          sandboxId,
          url: sandboxUrl,
          backendProvider,
          metadata: data.data.metadata
        };

        return { sandbox, sandboxId };
      },

      /**
       * Get sandbox by ID via gateway, then initialize ComputeClient
       */
      getById: async (config, sandboxId) => {
        const gatewayUrl = config.gatewayUrl || DEFAULT_GATEWAY_URL;

        const response = await fetch(`${gatewayUrl}/sandbox/${sandboxId}`, {
          headers: {
            'X-ComputeSDK-API-Key': config.apiKey,
            'X-Provider': config.provider,
            ...(config.providerHeaders || {})
          }
        });

        if (response.status === 404) {
          return null;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => response.statusText);
          throw new Error(`Gateway error (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        if (!data.success || !data.data) {
          return null;
        }

        const sandboxUrl = data.data.url;
        const backendProvider = data.data.provider;

        // Create ComputeClient connected to the sandbox
        const client = new ComputeClient({
          sandboxUrl: sandboxUrl,
          sandboxId: sandboxId,
          provider: backendProvider,
          token: config.apiKey,
          WebSocket: globalThis.WebSocket
        });

        // Wait for compute daemon to be ready
        await waitForComputeReady(client);

        const sandbox: GatewaySandboxInternal = {
          client,
          sandboxId,
          url: sandboxUrl,
          backendProvider,
          metadata: data.data.metadata
        };

        return { sandbox, sandboxId };
      },

      /**
       * List sandboxes via gateway
       */
      list: async (config) => {
        const gatewayUrl = config.gatewayUrl || DEFAULT_GATEWAY_URL;

        const response = await fetch(`${gatewayUrl}/sandbox`, {
          headers: {
            'X-ComputeSDK-API-Key': config.apiKey,
            'X-Provider': config.provider,
            ...(config.providerHeaders || {})
          }
        });

        if (!response.ok) {
          return [];
        }

        const data = await response.json();

        if (!data.success || !Array.isArray(data.data)) {
          return [];
        }

        // Note: We don't initialize ComputeClient for list results
        // Use getById to get a fully functional sandbox
        return data.data.map((item: any) => ({
          sandbox: {
            client: null as unknown as ComputeClient, // Not initialized for list
            sandboxId: item.sandboxId,
            url: item.url,
            backendProvider: item.provider,
            metadata: item.metadata
          } as GatewaySandboxInternal,
          sandboxId: item.sandboxId
        }));
      },

      /**
       * Destroy sandbox via gateway
       */
      destroy: async (config, sandboxId) => {
        const gatewayUrl = config.gatewayUrl || DEFAULT_GATEWAY_URL;

        const response = await fetch(`${gatewayUrl}/sandbox/${sandboxId}`, {
          method: 'DELETE',
          headers: {
            'X-ComputeSDK-API-Key': config.apiKey,
            'X-Provider': config.provider,
            ...(config.providerHeaders || {})
          }
        });

        if (!response.ok && response.status !== 404) {
          const errorText = await response.text().catch(() => response.statusText);
          throw new Error(`Gateway error (${response.status}): ${errorText}`);
        }
      },

      /**
       * Run code via ComputeClient
       */
      runCode: async (sandbox: GatewaySandboxInternal, code: string, runtime?: Runtime): Promise<ExecutionResult> => {
        const result = await sandbox.client.runCode(code, runtime);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          executionTime: result.executionTime,
          sandboxId: sandbox.sandboxId,
          provider: sandbox.backendProvider
        };
      },

      /**
       * Run command via ComputeClient
       */
      runCommand: async (sandbox: GatewaySandboxInternal, command: string, args?: string[]): Promise<ExecutionResult> => {
        const result = await sandbox.client.runCommand(command, args);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          executionTime: result.executionTime,
          sandboxId: sandbox.sandboxId,
          provider: sandbox.backendProvider
        };
      },

      /**
       * Get sandbox info
       */
      getInfo: async (sandbox: GatewaySandboxInternal): Promise<SandboxInfo> => {
        return {
          id: sandbox.sandboxId,
          provider: sandbox.backendProvider,
          runtime: 'node' as Runtime,
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: sandbox.metadata || {}
        };
      },

      /**
       * Get sandbox URL
       */
      getUrl: async (sandbox: GatewaySandboxInternal, options: { port: number; protocol?: string }) => {
        return sandbox.client.getUrl(options);
      },

      /**
       * Filesystem operations via ComputeClient
       */
      filesystem: {
        readFile: async (sandbox: GatewaySandboxInternal, path: string): Promise<string> => {
          return await sandbox.client.filesystem.readFile(path);
        },

        writeFile: async (sandbox: GatewaySandboxInternal, path: string, content: string): Promise<void> => {
          await sandbox.client.filesystem.writeFile(path, content);
        },

        mkdir: async (sandbox: GatewaySandboxInternal, path: string): Promise<void> => {
          await sandbox.client.filesystem.mkdir(path);
        },

        readdir: async (sandbox: GatewaySandboxInternal, path: string): Promise<FileEntry[]> => {
          return await sandbox.client.filesystem.readdir(path);
        },

        exists: async (sandbox: GatewaySandboxInternal, path: string): Promise<boolean> => {
          return await sandbox.client.filesystem.exists(path);
        },

        remove: async (sandbox: GatewaySandboxInternal, path: string): Promise<void> => {
          await sandbox.client.filesystem.remove(path);
        }
      },

      /**
       * Get the underlying ComputeClient instance
       * For gateway provider, this returns the ComputeClient that communicates with the sandbox
       */
      getInstance: (sandbox: GatewaySandboxInternal): GatewaySandboxInternal => {
        // Return the full internal state - the factory expects TSandbox -> TSandbox
        // Users can access sandbox.client for the ComputeClient directly
        return sandbox;
      }
    }
  }
});

// Re-export ComputeClient type for users who want to work with it
export type { ComputeClient } from '@computesdk/client';
