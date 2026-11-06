/**
 * E2B Provider - Factory-based Implementation
 */

import { Sandbox as E2BSandbox, Volume as E2BVolume } from 'e2b';
import { defineProvider, resolveVolumeRef, isUnifiedVolumeMounts, withVolumeSettle } from '@computesdk/provider';

import type { CommandResult, InstanceInfo, CreateInstanceOptions, FileEntry, RunCommandOptions, StartProcessOptions } from '@computesdk/provider';
import { runE2BCommand, startE2BProcess } from './process';

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

/** Drains a paginator from the e2b SDK (`hasNext` / `nextItems`). */
async function drain<T>(paginator: { hasNext: boolean; nextItems: () => Promise<T[]> }): Promise<T[]> {
  const items: T[] = [];
  while (paginator.hasNext) items.push(...await paginator.nextItems());
  return items;
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

      runCommand: (sandbox: E2BSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> =>
        runE2BCommand(sandbox, command, options),

      // envd streams output, takes stdin and signals processes itself.
      streamCommand: (sandbox: E2BSandbox, command: string, options: RunCommandOptions): Promise<CommandResult> =>
        runE2BCommand(sandbox, command, options),

      startProcess: (sandbox: E2BSandbox, command: string, options: StartProcessOptions) =>
        startE2BProcess(sandbox, command, options),

      getInfo: async (sandbox: E2BSandbox): Promise<InstanceInfo> => {
        const info = await sandbox.getInfo();
        return {
          id: info.sandboxId,
          provider: 'e2b',
          status: info.state === 'paused' ? 'stopped' : 'running',
          createdAt: info.startedAt,
          timeout: Math.max(0, info.endAt.getTime() - info.startedAt.getTime()),
          metadata: {
            ...info.metadata,
            e2bSessionId: info.sandboxId,
            templateId: info.templateId,
            ...(info.name && { templateName: info.name }),
            cpuCount: info.cpuCount,
            memoryMB: info.memoryMB,
            endAt: info.endAt.toISOString(),
          },
        };
      },

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
        // A raw octet-stream body instead of multipart; the SDK falls back to
        // multipart on envd versions that lack it.
        writeFile: async (sandbox: E2BSandbox, path: string, content: string): Promise<void> => { await sandbox.files.write(path, content, { useOctetStream: true }); },
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

      // Pause snapshots memory and the filesystem; connect() resumes it.
      pause: async (sandbox: E2BSandbox): Promise<void> => { await sandbox.pause(); },
      resume: async (sandbox: E2BSandbox): Promise<E2BSandbox> => sandbox.connect(),
      pauseCapabilities: { memory: true },

      getInstance: (sandbox: E2BSandbox): E2BSandbox => sandbox,
    },

    snapshot: {
      // A full memory + rootfs snapshot; the source is paused while it is taken, then keeps running.
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false },
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
      list: async (config: E2BConfig) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        return drain(E2BSandbox.listSnapshots({ apiKey }));
      },
      delete: async (config: E2BConfig, snapshotId: string) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        // false = already gone, which is what delete asked for.
        await E2BSandbox.deleteSnapshot(snapshotId, { apiKey });
      }
    },

    template: {
      create: async (_config: E2BConfig, _options: { name: string }) => {
        throw new Error('To create a template in E2B, create a snapshot from a running sandbox using snapshot.create(), or use the E2B CLI to build from a Dockerfile.');
      },
      list: async (config: E2BConfig) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        try {
          const e2bStatic = E2BSandbox as E2BSandboxStatics;
          if (typeof e2bStatic.listTemplates === 'function') return await e2bStatic.listTemplates({ apiKey });
          return [];
        } catch { return []; }
      },
      delete: async (config: E2BConfig, templateId: string) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        try {
          const e2bStatic = E2BSandbox as E2BSandboxStatics;
          if (typeof e2bStatic.deleteTemplate === 'function') await e2bStatic.deleteTemplate(templateId, { apiKey });
        } catch { /* ignore */ }
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
