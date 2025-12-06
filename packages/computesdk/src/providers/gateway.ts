/**
 * Gateway Provider
 *
 * Built-in provider that communicates with the ComputeSDK gateway for sandbox lifecycle
 * and uses ClientSandbox for all sandbox operations.
 *
 * This enables zero-config usage where users don't need provider-specific packages.
 *
 * Architecture:
 * - Lifecycle operations (create/destroy) → Gateway API
 * - Sandbox operations (runCode, filesystem, terminals, etc.) → ClientSandbox
 * - ClientSandbox talks directly to the compute daemon running in the sandbox
 */

import { Sandbox as ClientSandbox } from '@computesdk/client';
import { createProvider } from '../factory';
import { waitForComputeReady } from '../compute-daemon/lifecycle';
import type { Runtime, ExecutionResult, SandboxInfo, FileEntry } from '../types';

/**
 * Internal sandbox state - holds the full Sandbox (from client) and gateway metadata
 *
 * The `client` is the full Sandbox from @computesdk/client with all features:
 * - terminals, watchers, signals
 * - runCode, runCommand, filesystem
 */
interface GatewaySandboxInternal {
  client: ClientSandbox;
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
 * zero-config gateway mode functionality with full ClientSandbox capabilities.
 */
export const gateway = createProvider<GatewaySandboxInternal, GatewayConfig>({
  name: 'gateway',
  methods: {
    sandbox: {
      /**
       * Create sandbox via gateway, then initialize ClientSandbox
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

        // Create ClientSandbox connected to the sandbox
        const client = new ClientSandbox({
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
       * Get sandbox by ID via gateway, then initialize ClientSandbox
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

        // Create ClientSandbox connected to the sandbox
        const client = new ClientSandbox({
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

        // Note: We don't initialize ClientSandbox for list results
        // Use getById to get a fully functional sandbox
        return data.data.map((item: any) => ({
          sandbox: {
            client: null as unknown as ClientSandbox, // Not initialized for list
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
       * Run code via ClientSandbox
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
       * Run command via ClientSandbox
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
       * Filesystem operations via ClientSandbox
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
       * Get the internal gateway sandbox state
       *
       * For gateway provider, this returns an object with:
       * - `client`: The full Sandbox from @computesdk/client (with terminals, watchers, signals)
       * - `sandboxId`, `url`, `backendProvider`, `metadata`
       *
       * @example
       * ```typescript
       * const sandbox = await compute.sandbox.create();
       * const instance = sandbox.getInstance();
       *
       * // Access the full Sandbox with all features
       * const terminal = await instance.client.createTerminal();
       * const watcher = await instance.client.createWatcher('/home');
       * ```
       */
      getInstance: (sandbox: GatewaySandboxInternal): GatewaySandboxInternal => {
        return sandbox;
      }
    }
  }
});

// Re-export Sandbox type from client for users who want to work with it
export { Sandbox } from '@computesdk/client';
