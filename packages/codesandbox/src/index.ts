/**
 * Codesandbox Provider - Factory-based Implementation
 */

import { CodeSandbox } from '@codesandbox/sdk';
import type { Sandbox as CodesandboxSandbox } from '@codesandbox/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

type HibernateCapableSandbox = CodesandboxSandbox & { hibernate: () => Promise<void>; };

export interface CodesandboxConfig {
  /** CodeSandbox API key - if not provided, will fallback to CSB_API_KEY environment variable */
  apiKey?: string;
  /** Template to use for new sandboxes */
  templateId?: string;
  /** Default runtime environment (e.g. 'node', 'python') */
  runtime?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

export const codesandbox = defineProvider<CodesandboxSandbox, CodesandboxConfig, any, any>({
  name: 'codesandbox',
  methods: {
    sandbox: {
      create: async (config: CodesandboxConfig, options?: CreateSandboxOptions) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';
        if (!apiKey) {
          throw new Error(`Missing CodeSandbox API key. Provide 'apiKey' in config or set CSB_API_KEY environment variable.`);
        }
        const sdk = new CodeSandbox(apiKey);
        try {
          let sandbox: CodesandboxSandbox;
          let sandboxId: string;
          if (options?.snapshotId) {
            sandbox = await sdk.sandboxes.resume(options.snapshotId);
            sandboxId = options.snapshotId;
          } else {
            const {
              timeout: _timeout, envs, name: _name, metadata: _metadata,
              templateId: optTemplateId, snapshotId: _snapshotId, sandboxId: _sandboxId,
              namespace: _namespace, directory: _directory, ...providerOptions
            } = options || {};
            const createOptions: any = { ...providerOptions };
            const templateId = optTemplateId || config.templateId;
            if (templateId) createOptions.id = templateId;
            if (envs && Object.keys(envs).length > 0) createOptions.envVars = envs;
            sandbox = await sdk.sandboxes.create(createOptions);
            sandboxId = sandbox.id;
          }
          return { sandbox, sandboxId };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key')) {
              throw new Error(`CodeSandbox authentication failed. Please check your CSB_API_KEY environment variable.`);
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(`CodeSandbox quota exceeded. Please check your usage at https://codesandbox.io/dashboard`);
            }
          }
          throw new Error(`Failed to create CodeSandbox sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: CodesandboxConfig, sandboxId: string) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';
        if (!apiKey) throw new Error(`Missing CodeSandbox API key.`);
        const sdk = new CodeSandbox(apiKey);
        try {
          const sandbox = await sdk.sandboxes.resume(sandboxId);
          return { sandbox, sandboxId };
        } catch { return null; }
      },

      list: async (_config: CodesandboxConfig) => {
        throw new Error(`CodeSandbox provider does not support listing sandboxes.`);
      },

      destroy: async (config: CodesandboxConfig, sandboxId: string) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';
        if (!apiKey) throw new Error(`Missing CodeSandbox API key.`);
        const sdk = new CodeSandbox(apiKey);
        try { await sdk.sandboxes.shutdown(sandboxId); } catch { /* ignore */ }
        try {
          await sdk.sandboxes.delete(sandboxId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('not found') && !message.includes('404')) {
            throw new Error(`Failed to delete CodeSandbox sandbox "${sandboxId}": ${message}`);
          }
        }
      },

      runCommand: async (sandbox: CodesandboxSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          const client = await sandbox.connect();
          let fullCommand = command;
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env).map(([k, v]) => `${k}="${escapeShellArg(v)}"`).join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }
          if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          const output = await client.commands.run(fullCommand);
          return { stdout: output, stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (sandbox: CodesandboxSandbox): Promise<SandboxInfo> => ({
        id: sandbox.id,
        provider: 'codesandbox',
        status: 'running',
        createdAt: new Date(),
        timeout: 300000,
        metadata: { cluster: sandbox.cluster, bootupType: sandbox.bootupType, isUpToDate: sandbox.isUpToDate }
      }),

      getUrl: async (sandbox: CodesandboxSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        const protocol = options.protocol || 'https';
        return `${protocol}://${sandbox.id}.${sandbox.cluster}.csb.app:${options.port}`;
      },

      filesystem: {
        readFile: async (sandbox: CodesandboxSandbox, path: string): Promise<string> => {
          const client = await sandbox.connect();
          return client.fs.readTextFile(path);
        },
        writeFile: async (sandbox: CodesandboxSandbox, path: string, content: string): Promise<void> => {
          const client = await sandbox.connect();
          await client.fs.writeTextFile(path, content);
        },
        mkdir: async (sandbox: CodesandboxSandbox, path: string): Promise<void> => {
          const client = await sandbox.connect();
          await client.commands.run(`mkdir -p "${path}"`);
        },
        readdir: async (sandbox: CodesandboxSandbox, path: string): Promise<FileEntry[]> => {
          const client = await sandbox.connect();
          const entries = await client.fs.readdir(path);
          return entries.map((entry: any) => ({
            name: entry.name,
            type: entry.isDirectory ? 'directory' as const : 'file' as const,
            size: entry.size || 0,
            modified: entry.lastModified ? new Date(entry.lastModified) : new Date()
          }));
        },
        exists: async (sandbox: CodesandboxSandbox, path: string): Promise<boolean> => {
          const client = await sandbox.connect();
          try { await client.commands.run(`ls "${path}"`); return true; } catch { return false; }
        },
        remove: async (sandbox: CodesandboxSandbox, path: string): Promise<void> => {
          const client = await sandbox.connect();
          await client.fs.remove(path);
        }
      },

      getInstance: (sandbox: CodesandboxSandbox): CodesandboxSandbox => sandbox,
    },

    snapshot: {
      create: async (config: CodesandboxConfig, sandboxId: string, options?: { name?: string }) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';
        if (!apiKey) throw new Error(`Missing CodeSandbox API key.`);
        const sdk = new CodeSandbox(apiKey);
        try {
          const sandbox = await sdk.sandboxes.resume(sandboxId);
          await (sandbox as HibernateCapableSandbox).hibernate();
          return { id: sandbox.id, provider: 'codesandbox', createdAt: new Date(), metadata: { name: options?.name, bootupType: sandbox.bootupType } };
        } catch (error) {
          throw new Error(`Failed to create CodeSandbox snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      list: async (_config: CodesandboxConfig) => { throw new Error(`CodeSandbox provider does not support listing snapshots.`); },
      delete: async (config: CodesandboxConfig, snapshotId: string) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';
        if (!apiKey) throw new Error(`Missing CodeSandbox API key.`);
        const sdk = new CodeSandbox(apiKey);
        try { await sdk.sandboxes.shutdown(snapshotId); } catch { /* ignore */ }
      }
    },

    template: {
      create: async (_config: CodesandboxConfig, _options: { name: string }) => {
        throw new Error(`CodeSandbox templates must be created via the dashboard.`);
      },
      list: async (_config: CodesandboxConfig) => { throw new Error(`CodeSandbox provider does not support listing templates via API.`); },
      delete: async (_config: CodesandboxConfig, _templateId: string) => { throw new Error(`CodeSandbox templates must be deleted via the dashboard.`); }
    }
  }
});
