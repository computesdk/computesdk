/**
 * Leap0 Provider - Factory-based Implementation
 */

import { Leap0Client } from 'leap0';
import type { Sandbox as Leap0Sandbox } from 'leap0';
import { defineProvider } from '@computesdk/provider';
import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from 'computesdk';

export interface Leap0Config {
  apiKey?: string;
  baseUrl?: string;
  sandboxDomain?: string;
  timeout?: number;
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
        const sandbox = await client.sandboxes.create({
          templateName: config.template,
          timeout: options?.timeout ? Math.ceil(options.timeout / 60000) : undefined,
          envVars: options?.envs,
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
          const execParams: { command: string; cwd?: string; env?: Record<string, string>; timeout?: number } = { command };
          if (options?.cwd) execParams.cwd = options.cwd;
          if (options?.env && Object.keys(options.env).length > 0) execParams.env = options.env;
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
        return client.sandboxes.invokeUrl(sandbox.id, '/', urlOptions.port);
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
