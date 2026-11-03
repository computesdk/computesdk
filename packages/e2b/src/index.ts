/**
 * E2B Provider - Factory-based Implementation
 */

import { Sandbox as E2BSandbox, Volume as E2BVolume, type SnapshotInfo } from 'e2b';
import { defineProvider, escapeShellArg, resolveVolumeRef, isUnifiedVolumeMounts, withVolumeSettle } from '@computesdk/provider';

import type { CommandResult, InstanceInfo, CreateInstanceOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

type E2BExecutionResult = { stdout?: string; stderr?: string; exitCode?: number };
type E2BFileEntry = {
  name: string;
  isDir?: boolean;
  isDirectory?: boolean;
  size?: number;
  lastModified?: string | number | Date;
};
type E2BSnapshotResult = string | { id?: string; templateId?: string };
type SnapshotCapableE2BSandbox = E2BSandbox & {
  createSnapshot: (options?: { name?: string }) => Promise<E2BSnapshotResult>;
};
type E2BSandboxStatics = typeof E2BSandbox & {
  listTemplates?: (options: { apiKey?: string }) => Promise<unknown[]>;
  deleteTemplate?: (snapshotId: string, options: { apiKey?: string }) => Promise<unknown>;
};

function isSnapshotId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export interface E2BConfig {
  /** E2B API key - if not provided, will fallback to E2B_API_KEY environment variable */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

export const e2b = defineProvider<E2BSandbox, E2BConfig>({
  name: 'e2b',
  methods: {
    instances: {
      create: async (config: E2BConfig, options?: CreateInstanceOptions) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.E2B_API_KEY) || '';

        if (!apiKey) {
          throw new Error(`Missing E2B API key. Provide 'apiKey' in config or set E2B_API_KEY environment variable.`);
        }

        if (!apiKey.startsWith('e2b_')) {
          throw new Error(`Invalid E2B API key format. E2B API keys should start with 'e2b_'.`);
        }

        const timeout = options?.timeout ?? config.timeout ?? 300000;

        try {
          let sandbox: E2BSandbox;
          let sandboxId: string;

          const {
            timeout: _timeout, envs, name: _name, metadata, templateId, snapshotId,
            sandboxId: _sandboxId, namespace: _namespace, directory: _directory,
            volumes, ...providerOptions
          } = options || {};

          // `volumes` only counts as unified VolumeMount[] when every entry
          // carries `volume`; a provider-native volumes spec stays in
          // providerOptions and reaches the wire untouched.
          const unifiedVolumes = isUnifiedVolumeMounts(volumes) ? volumes : undefined;
          if (volumes !== undefined && !unifiedVolumes) (providerOptions as any).volumes = volumes;

          const createOpts: Record<string, any> = {
            apiKey, timeoutMs: timeout, envs, metadata, ...providerOptions,
            // Unified mounts → e2b's [{name, path}] wire shape.
            ...(unifiedVolumes && {
              volumeMounts: unifiedVolumes.map((m: any) => ({
                name: resolveVolumeRef(m.volume).name ?? resolveVolumeRef(m.volume).id,
                path: m.mountPath,
              })),
            }),
          };

          const templateOrSnapshot = templateId || snapshotId;
          if (templateOrSnapshot) {
            sandbox = await E2BSandbox.create(templateOrSnapshot, createOpts);
          } else {
            sandbox = await E2BSandbox.create(createOpts);
          }
          if (!sandbox.sandboxId) throw new Error('E2B create() returned sandbox without an ID');
          sandboxId = sandbox.sandboxId;

          return { instance: sandbox, instanceId: sandboxId };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key')) {
              throw new Error(`E2B authentication failed. Please check your E2B_API_KEY environment variable.`);
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(`E2B quota exceeded. Please check your usage at https://e2b.dev/`);
            }
          }
          throw new Error(`Failed to create E2B sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: E2BConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        try {
          const sandbox = await E2BSandbox.connect(sandboxId, { apiKey });
          return { instance: sandbox, instanceId: sandboxId };
        } catch { return null; }
      },

      list: async (config: E2BConfig) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        try {
          const paginator = E2BSandbox.list({ apiKey });
          const items = await paginator.nextItems();
          return items.map((sandbox) => {
            const listedSandbox = sandbox as unknown as E2BSandbox & { id?: string; sandboxId?: string };
            const sandboxId = listedSandbox.id || listedSandbox.sandboxId || 'e2b-unknown';
            return { instance: listedSandbox, instanceId: sandboxId };
          });
        } catch { return []; }
      },

      destroy: async (config: E2BConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        try {
          const sandbox = await E2BSandbox.connect(sandboxId, { apiKey });
          await sandbox.kill();
        } catch { /* already destroyed */ }
      },

      runCommand: async (sandbox: E2BSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          let fullCommand = command;
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env).map(([k, v]) => `${k}="${escapeShellArg(String(v))}"`).join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }
          if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          const execution = await sandbox.commands.run(fullCommand, { timeoutMs: options?.timeout });
          return { stdout: execution.stdout, stderr: execution.stderr, exitCode: execution.exitCode, durationMs: Date.now() - startTime };
        } catch (error) {
          const result = (error as { result?: E2BExecutionResult })?.result;
          if (result) return { stdout: result.stdout || '', stderr: result.stderr || '', exitCode: result.exitCode || 1, durationMs: Date.now() - startTime };
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (sandbox: E2BSandbox): Promise<InstanceInfo> => ({
        id: sandbox.sandboxId || 'e2b-unknown',
        provider: 'e2b',
        status: 'running',
        createdAt: new Date(),
        timeout: 300000,
        metadata: { e2bSessionId: sandbox.sandboxId }
      }),

      getUrl: async (sandbox: E2BSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          const host = sandbox.getHost(options.port);
          const protocol = options.protocol || 'https';
          return `${protocol}://${host}`;
        } catch (error) {
          throw new Error(`Failed to get E2B host for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      filesystem: {
        readFile: async (sandbox: E2BSandbox, path: string): Promise<string> => sandbox.files.read(path),
        writeFile: async (sandbox: E2BSandbox, path: string, content: string): Promise<void> => { await sandbox.files.write(path, content); },
        mkdir: async (sandbox: E2BSandbox, path: string): Promise<void> => { await sandbox.files.makeDir(path); },
        readdir: async (sandbox: E2BSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await sandbox.files.list(path);
          return entries.map((entry: E2BFileEntry) => ({
            name: entry.name,
            type: (entry.isDir || entry.isDirectory) ? 'directory' as const : 'file' as const,
            size: entry.size || 0,
            modified: new Date(entry.lastModified || Date.now())
          }));
        },
        exists: async (sandbox: E2BSandbox, path: string): Promise<boolean> => sandbox.files.exists(path),
        remove: async (sandbox: E2BSandbox, path: string): Promise<void> => { await sandbox.files.remove(path); }
      },

      getInstance: (sandbox: E2BSandbox): E2BSandbox => sandbox,
    },

    snapshot: {
      create: async (config: E2BConfig, sandboxId: string, options?: { name?: string }) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        try {
          const sandbox = await E2BSandbox.connect(sandboxId, { apiKey });
          const snapshotSandbox = sandbox as SnapshotCapableE2BSandbox;
          const snapshotResult = await snapshotSandbox.createSnapshot({ name: options?.name });
          const snapshotId = snapshotResult.snapshotId;
          return { id: snapshotId, provider: 'e2b', createdAt: new Date(), metadata: { name: options?.name } };
        } catch (error) {
          throw new Error(`Failed to create E2B snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      list: async (config: E2BConfig, options) => {
        const limit = options?.limit;
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
          throw new Error('Snapshot limit must be a non-negative integer.');
        }
        if (limit === 0) return [];
        const paginator = E2BSandbox.listSnapshots({
          apiKey: config.apiKey || process.env.E2B_API_KEY,
          ...(options?.sandboxId !== undefined && { sandboxId: options.sandboxId }),
        });
        const snapshots: SnapshotInfo[] = [];
        while (paginator.hasNext && (limit === undefined || snapshots.length < limit)) {
          const page = await paginator.nextItems();
          if (!Array.isArray(page)) throw new Error('Invalid E2B snapshot list response.');
          // Validate the entire fetched page before exposing any cleanup IDs.
          for (const snapshot of page) {
            if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot) ||
                !isSnapshotId(snapshot.snapshotId)) {
              throw new Error('Invalid E2B snapshot list response.');
            }
          }
          snapshots.push(...page);
        }
        // Native SnapshotInfo has no creation timestamp; preserve its fields
        // and expose the ID used by the shared snapshot cleanup API.
        return (limit === undefined ? snapshots : snapshots.slice(0, limit)).map(snapshot => ({
          ...snapshot, id: snapshot.snapshotId, provider: 'e2b',
        }));
      },
      delete: async (config: E2BConfig, snapshotId: string) => {
        if (!isSnapshotId(snapshotId)) throw new Error('E2B snapshot ID must be a non-empty string.');
        // Native false means not found (already deleted); other failures throw.
        const deleted = await E2BSandbox.deleteSnapshot(snapshotId, { apiKey: config.apiKey || process.env.E2B_API_KEY });
        if (typeof deleted !== 'boolean') throw new Error('Invalid E2B snapshot delete response.');
      }
    },

    template: {
      create: async (_config: E2BConfig, _options: { name: string }) => {
        throw new Error('To create a template in E2B, create a snapshot from a running sandbox using snapshot.create(), or use the E2B CLI to build from a Dockerfile.');
      },
      list: async (config: E2BConfig) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        const e2bStatic = E2BSandbox as E2BSandboxStatics;
        if (typeof e2bStatic.listTemplates !== 'function') {
          throw new Error('E2B template.list is not implemented by this adapter for the installed SDK.');
        }
        const templates = await e2bStatic.listTemplates({ apiKey });
        if (!Array.isArray(templates)) throw new Error('Invalid E2B template list response.');
        return templates;
      },
      delete: async (config: E2BConfig, templateId: string) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        const e2bStatic = E2BSandbox as E2BSandboxStatics;
        if (typeof e2bStatic.deleteTemplate !== 'function') {
          throw new Error('E2B template.delete is not implemented by this adapter for the installed SDK.');
        }
        await e2bStatic.deleteTemplate(templateId, { apiKey });
      }
    },

    volume: {
      create: async (config: E2BConfig, options) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        const v = await E2BVolume.create(options.name, { apiKey });
        return { id: v.volumeId, name: v.name, native: v };
      },
      get: async (config: E2BConfig, id: string) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        try {
          const info = await E2BVolume.getInfo(id, { apiKey });
          return info ? { id, name: (info as any).name, native: info } : null;
        } catch { return null; }
      },
      list: async (config: E2BConfig) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        const volumes = await E2BVolume.list({ apiKey });
        return (volumes ?? []).map((v: any) => ({ id: v.volumeId ?? v.id, name: v.name, native: v }));
      },
      delete: async (config: E2BConfig, id: string) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        await withVolumeSettle(() => E2BVolume.destroy(id, { apiKey }));
      },
    }
  }
});

export type { Sandbox as E2BSandbox } from 'e2b';
