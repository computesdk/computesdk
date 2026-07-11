/**
 * Leap0 Provider - Factory-based Implementation
 */

import { Leap0Client } from 'leap0';
import type { Sandbox as Leap0Sandbox } from 'leap0';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions, CreateTemplateOptions } from 'computesdk';

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
    sandbox: {
      create: async (config: Leap0Config, options?: CreateSandboxOptions) => {
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
        sandboxToClient.set(sandbox.id, client);
        return { sandbox, sandboxId: sandbox.id };
      },

      getById: async (config: Leap0Config, sandboxId: string) => {
        try {
          const client = createLeap0Client(config);
          const sandbox = await client.sandboxes.get(sandboxId);
          sandboxToClient.set(sandboxId, client);
          return { sandbox, sandboxId: sandbox.id };
        } catch {
          return null;
        }
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
        return sandboxes.map((s) => ({ sandbox: s, sandboxId: s.id }));
      },

      destroy: async (_config: Leap0Config, sandboxId: string) => {
        try {
          const client = sandboxToClient.get(sandboxId) ?? createLeap0Client(_config);
          await client.sandboxes.delete(sandboxId);
        } catch {
          // already destroyed
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

      getInfo: async (sandbox: Leap0Sandbox): Promise<SandboxInfo> => ({
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

    template: {
      create: async (config: Leap0Config, options: CreateTemplateOptions) => {
        const client = createLeap0Client(config);

        try {
          // Mode 1: Capture from a running sandbox
          if (options.from) {
            const snapshot = await client.sandboxes.createSnapshot(options.from, {
              name: options.name,
            });
            return {
              id: snapshot.id,
              provider: 'leap0',
              name: options.name,
              createdAt: new Date(snapshot.createdAt),
              metadata: { ...options.metadata, source: 'capture', sandboxId: options.from, templateId: snapshot.templateId, snapshot },
            };
          }

          // Mode 2: Build from spec (base image as container image URI)
          const uri = options.baseImage || (options.dockerfile
            ? (options.dockerfile.split('\n').find((l) => l.toUpperCase().startsWith('FROM ')) || '').replace(/^FROM\s+/i, '').trim() || 'ubuntu:22.04'
            : 'ubuntu:22.04');

          if (!uri) {
            throw new Error('Leap0 template build requires a baseImage or dockerfile with a FROM instruction.');
          }

          const template = await client.templates.create({
            name: options.name,
            uri,
          });
          return {
            id: template.id,
            provider: 'leap0',
            name: options.name,
            createdAt: new Date(template.createdAt),
            metadata: { ...options.metadata, source: 'build', digest: template.digest, template },
          };
        } catch (error) {
          throw new Error(`Failed to create Leap0 template: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      list: async (config: Leap0Config) => {
        const client = createLeap0Client(config);
        try {
          const response = await client.snapshots.list();
          const items = (response as any).items || response || [];
          return (Array.isArray(items) ? items : []).map((s: Record<string, any>) => ({
            id: s.id || s.name || 'unknown',
            provider: 'leap0',
            name: s.name || s.id || 'unnamed',
            createdAt: s.createdAt ? new Date(s.createdAt) : new Date(),
            metadata: s,
          }));
        } catch {
          return [];
        }
      },

      delete: async (config: Leap0Config, templateId: string) => {
        const client = createLeap0Client(config);
        try {
          await client.snapshots.delete(templateId);
        } catch {
          try {
            await client.templates.delete(templateId);
          } catch {
            /* already deleted */
          }
        }
      },
    },
  },
});

export const leap0 = (config: Leap0Config = {}) => _provider(config);
export type { Leap0Sandbox };
