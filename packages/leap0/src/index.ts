/**
 * Leap0 Provider - Factory-based Implementation
 */

import { Leap0Client, Leap0NotFoundError } from 'leap0';
import type { Sandbox as Leap0Sandbox } from 'leap0';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, InstanceInfo, CreateInstanceOptions, FileEntry, RunCommandOptions } from 'computesdk';

export interface Leap0Config {
  /** Leap0 API key - if not provided, will use LEAP0_API_KEY environment variable */
  apiKey?: string;
  /** Base URL for the Leap0 API (default: https://api.leap0.dev) */
  baseUrl?: string;
  /** Sandbox domain for URL generation (default: sandbox.leap0.dev) */
  sandboxDomain?: string;
  /** Client timeout in seconds */
  timeout?: number;
  /** Default template name to use when creating sandboxes (e.g. 'system/debian:bookworm') */
  template?: string;
}

const sandboxToClient = new Map<string, Leap0Client>();

function validateSandboxId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('Leap0 sandbox ID must be a non-empty string.');
  }
  // Native lifecycle methods interpolate a raw path segment. Reject routing
  // syntax (including encoded forms), not undocumented ID/name alphabets.
  let decoded = id;
  for (;;) {
    if (/[/\\?#\u0000-\u001f\u007f]/.test(decoded) || decoded === '.' || decoded === '..') {
      throw new Error('Leap0 sandbox ID must be a route-safe reference.');
    }
    const next = decoded.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (next === decoded) break;
    decoded = next;
  }
}

function createLeap0Client(config: Leap0Config): Leap0Client {
  const apiKey = config.apiKey ?? (typeof process !== 'undefined' && process.env?.LEAP0_API_KEY) ?? '';
  if (!apiKey) {
    throw new Error(
      `Missing Leap0 API key. Provide 'apiKey' in config or set LEAP0_API_KEY environment variable.`,
    );
  }
  return new Leap0Client({
    apiKey,
    baseUrl: config.baseUrl,
    sandboxDomain: config.sandboxDomain,
    timeout: config.timeout,
  });
}

const _provider = defineProvider<Leap0Sandbox, Leap0Config>({
  name: 'leap0',
  methods: {
    instances: {
      create: async (config: Leap0Config, options?: CreateInstanceOptions) => {
        const client = createLeap0Client(config);

        const {
          timeout: _timeout, envs, templateId, snapshotId,
          name: _name, metadata: _metadata, namespace: _namespace, directory: _directory,
          ...providerOptions
        } = options || {};

        // Map universal templateId/snapshotId to Leap0's templateName, with config.template as fallback
        const templateName = templateId || snapshotId || config.template;

        const sandbox = await client.sandboxes.create({
          templateName,
          timeout: _timeout ? Math.ceil(_timeout / 60000) : undefined,
          envVars: envs,
          ...providerOptions,
        });
        validateSandboxId(sandbox?.id);
        sandboxToClient.set(sandbox.id, client);
        return { instance: sandbox, instanceId: sandbox.id };
      },

      getById: async (config: Leap0Config, sandboxId: string) => {
        validateSandboxId(sandboxId);
        const client = createLeap0Client(config);
        let sandbox: Leap0Sandbox;
        try {
          // Native get performs only the resource GET and local hydration.
          sandbox = await client.sandboxes.get(sandboxId);
        } catch (error) {
          if (error instanceof Leap0NotFoundError) return null;
          throw error;
        }
        validateSandboxId(sandbox?.id);
        sandboxToClient.set(sandbox.id, client);
        return { instance: sandbox, instanceId: sandbox.id };
      },

      list: async (config: Leap0Config) => {
        const client = createLeap0Client(config);
        const response = await client.sandboxes.list();
        const results = await Promise.allSettled(
          response.items.map((item) => client.sandboxes.get(item.id)),
        );
        const sandboxes: Leap0Sandbox[] = [];
        for (const result of results) {
          if (result.status === 'fulfilled') {
            sandboxToClient.set(result.value.id, client);
            sandboxes.push(result.value);
          }
        }
        return sandboxes.map((s) => ({ instance: s, instanceId: s.id }));
      },

      destroy: async (_config: Leap0Config, sandboxId: string) => {
        validateSandboxId(sandboxId);
        const client = sandboxToClient.get(sandboxId) ?? createLeap0Client(_config);
        try {
          await client.sandboxes.delete(sandboxId);
        } catch (error) {
          // This native method sends only the resource DELETE; its void
          // acknowledgement is valid. Unclassified failures must remain visible.
          if (!(error instanceof Leap0NotFoundError)) throw error;
        }
        sandboxToClient.delete(sandboxId);
      },

      runCommand: async (sandbox: Leap0Sandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          let fullCommand = command;
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env).map(([k, v]) => {
              if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k)) {
                throw new Error(`Invalid environment variable name: ${k}`);
              }
              return `${k}="${escapeShellArg(String(v))}"`;
            }).join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }
          if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;

          const execParams: { command: string; timeout?: number } = { command: fullCommand };
          if (options?.timeout) execParams.timeout = Math.ceil(options.timeout / 1000);
          const result = await sandbox.process.execute(execParams);
          return { stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.exitCode, durationMs: Date.now() - startTime };
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (sandbox: Leap0Sandbox): Promise<InstanceInfo> => ({
        id: sandbox.id,
        provider: 'leap0',
        status: 'running',
        createdAt: sandbox.createdAt ? new Date(sandbox.createdAt) : new Date(),
        timeout: sandbox.timeout ? sandbox.timeout * 60000 : 300000,
        metadata: { templateId: sandbox.templateId },
      }),

      getUrl: async (sandbox: Leap0Sandbox, urlOptions: { port: number; protocol?: string }): Promise<string> => {
        const client = sandboxToClient.get(sandbox.id);
        if (!client) {
          throw new Error(`Cannot get URL for sandbox ${sandbox.id}: no active Leap0 client`);
        }
        const protocol = urlOptions.protocol || 'https';
        if (protocol === 'wss' || protocol === 'ws') {
          return client.sandboxes.websocketUrl(sandbox.id, '/', urlOptions.port);
        }
        const url = client.sandboxes.invokeUrl(sandbox.id, '/', urlOptions.port);
        // Replace the protocol if it differs from the default https
        if (protocol !== 'https') {
          return url.replace(/^https?:\/\//, `${protocol}://`);
        }
        return url;
      },

      filesystem: {
        readFile: async (sandbox: Leap0Sandbox, path: string): Promise<string> =>
          sandbox.filesystem.readFile(path),

        writeFile: async (sandbox: Leap0Sandbox, path: string, content: string): Promise<void> => {
          await sandbox.filesystem.writeFile(path, content);
        },

        mkdir: async (sandbox: Leap0Sandbox, path: string): Promise<void> => {
          await sandbox.filesystem.mkdir(path);
        },

        readdir: async (sandbox: Leap0Sandbox, path: string): Promise<FileEntry[]> => {
          const result = await sandbox.filesystem.ls(path);
          return (result.items || []).map((item: any) => ({
            name: item.name,
            type: item.type === 'directory' ? 'directory' as const : 'file' as const,
            size: item.size || 0,
            modified: item.modified ? new Date(item.modified) : new Date(),
          }));
        },

        exists: async (sandbox: Leap0Sandbox, path: string): Promise<boolean> =>
          sandbox.filesystem.exists(path),

        remove: async (sandbox: Leap0Sandbox, path: string): Promise<void> => {
          await sandbox.filesystem.delete({ path, recursive: true });
        },
      },

      getInstance: (sandbox: Leap0Sandbox): Leap0Sandbox => sandbox,
    },
  },
});

export const leap0 = (config: Leap0Config = {}) => _provider(config);
export type { Leap0Sandbox };
