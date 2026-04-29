/**
 * Declaw Provider
 *
 * Wraps `@declaw/sdk` to expose the ComputeSDK provider interface.
 */

import { Sandbox as DeclawSandbox } from '@declaw/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from '@computesdk/provider';

export interface DeclawConfig {
  /** Declaw API key. Falls back to `DECLAW_API_KEY` env var. */
  apiKey?: string;
  /** API domain, e.g. `api.declaw.ai`. Falls back to `DECLAW_DOMAIN` env var. */
  domain?: string;
  /** Default create-time timeout in milliseconds. */
  timeout?: number;
}

export const declaw = defineProvider<DeclawSandbox, DeclawConfig>({
  name: 'declaw',
  methods: {
    sandbox: {
      create: async (config: DeclawConfig, options?: CreateSandboxOptions) => {
        const apiKey =
          config.apiKey ||
          (typeof process !== 'undefined' && process.env?.DECLAW_API_KEY) ||
          '';
        if (!apiKey) {
          throw new Error(`Missing Declaw API key. Provide 'apiKey' in config or set DECLAW_API_KEY.`);
        }
        if (!apiKey.startsWith('dcl_')) {
          throw new Error(`Invalid Declaw API key format. Keys should start with 'dcl_'.`);
        }

        const domain =
          config.domain ||
          (typeof process !== 'undefined' && process.env?.DECLAW_DOMAIN) ||
          undefined;

        const {
          timeout: requestedTimeoutMs,
          envs,
          name: _name,
          metadata,
          templateId,
          namespace: _namespace,
          directory: _directory,
          ...providerOptions
        } = options || {};

        const ttMs = requestedTimeoutMs ?? config.timeout ?? 300_000;
        const timeoutSec = Math.max(1, Math.ceil(ttMs / 1000));
        const template = templateId || 'node';

        try {
          const sandbox = await DeclawSandbox.create({
            template, timeout: timeoutSec, apiKey, domain, metadata, envs, ...providerOptions,
          });
          const sandboxId = (sandbox as any).sandboxId ?? (sandbox as any).sandbox_id;
          if (!sandboxId) throw new Error('Declaw create() returned sandbox without an ID');
          return { sandbox, sandboxId };
        } catch (error) {
          if (error instanceof Error) {
            const msg = error.message.toLowerCase();
            if (msg.includes('unauthorized') || msg.includes('api key') || msg.includes('401')) {
              throw new Error(`Declaw authentication failed. Check your DECLAW_API_KEY.`);
            }
            if (msg.includes('402') || msg.includes('insufficient balance')) {
              throw new Error(`Declaw wallet balance is insufficient. Top up at https://declaw.ai/`);
            }
            if (msg.includes('429') || msg.includes('concurrent') || msg.includes('rate limit')) {
              throw new Error(`Declaw concurrency/rate limit reached: ${error.message}`);
            }
          }
          throw new Error(`Failed to create Declaw sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: DeclawConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.DECLAW_API_KEY!;
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        try {
          const sandbox = await DeclawSandbox.connect(sandboxId, { apiKey, domain });
          return { sandbox, sandboxId };
        } catch { return null; }
      },

      list: async (config: DeclawConfig) => {
        const apiKey = config.apiKey || process.env.DECLAW_API_KEY!;
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        try {
          const result = await DeclawSandbox.list({ apiKey, domain });
          const infos = Array.isArray(result) ? result : result?.sandboxes ?? [];
          const out: Array<{ sandbox: DeclawSandbox; sandboxId: string }> = [];
          for (const info of infos) {
            const id = (info as any).sandboxId ?? (info as any).sandbox_id;
            if (!id) continue;
            try {
              const sandbox = await DeclawSandbox.connect(id, { apiKey, domain });
              out.push({ sandbox, sandboxId: id });
            } catch { /* skip */ }
          }
          return out;
        } catch { return []; }
      },

      destroy: async (config: DeclawConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.DECLAW_API_KEY!;
        const domain = config.domain || process.env.DECLAW_DOMAIN;
        try {
          const sandbox = await DeclawSandbox.connect(sandboxId, { apiKey, domain });
          await sandbox.kill();
        } catch { /* idempotent */ }
      },

      runCommand: async (sandbox: DeclawSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        let fullCommand = command;
        if (options?.env && Object.keys(options.env).length > 0) {
          const envPrefix = Object.entries(options.env).map(([k, v]) => `${k}="${escapeShellArg(v)}"`).join(' ');
          fullCommand = `${envPrefix} ${fullCommand}`;
        }
        if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
        if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;

        try {
          const result = await sandbox.commands.run(fullCommand);
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: Date.now() - startTime };
        } catch (error) {
          const wrapped: any = (error as any)?.result;
          if (wrapped) return { stdout: wrapped.stdout || '', stderr: wrapped.stderr || '', exitCode: wrapped.exitCode ?? 1, durationMs: Date.now() - startTime };
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (sandbox: DeclawSandbox): Promise<SandboxInfo> => {
        const id = (sandbox as any).sandboxId ?? (sandbox as any).sandbox_id ?? 'declaw-unknown';
        return { id, provider: 'declaw', status: 'running', createdAt: new Date(), timeout: 300_000, metadata: { declawSandboxId: id } };
      },

      getUrl: async (sandbox: DeclawSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          const host = (sandbox as any).getHost(options.port);
          const protocol = options.protocol || 'https';
          return `${protocol}://${host}`;
        } catch (error) {
          throw new Error(`Failed to get Declaw host for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      filesystem: {
        readFile: async (sandbox: DeclawSandbox, path: string): Promise<string> => (sandbox as any).files.read(path),
        writeFile: async (sandbox: DeclawSandbox, path: string, content: string): Promise<void> => { await (sandbox as any).files.write(path, content); },
        mkdir: async (sandbox: DeclawSandbox, path: string): Promise<void> => { await (sandbox as any).files.makeDir(path); },
        readdir: async (sandbox: DeclawSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await (sandbox as any).files.list(path);
          return entries.map((entry: any) => ({
            name: entry.name,
            type: entry.isDir || entry.isDirectory || entry.type === 'directory' ? 'directory' as const : 'file' as const,
            size: entry.size ?? 0,
            modified: new Date(entry.lastModified ?? entry.modified ?? Date.now()),
          }));
        },
        exists: async (sandbox: DeclawSandbox, path: string): Promise<boolean> => (sandbox as any).files.exists(path),
        remove: async (sandbox: DeclawSandbox, path: string): Promise<void> => { await (sandbox as any).files.remove(path); },
      },
    },
  },
});
