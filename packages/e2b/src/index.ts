/**
 * E2B Provider - Factory-based Implementation
 */

import { Sandbox as E2BSandbox, Template as E2BTemplate, Volume as E2BVolume } from 'e2b';
import { defineProvider, resolveVolumeRef, isUnifiedVolumeMounts, withVolumeSettle, InstanceSizeError } from '@computesdk/provider';

import type {
  CommandResult, InstanceInfo, CreateInstanceOptions, CreateTemplateOptions, FileEntry, InstanceSizeClass,
  ListTemplatesOptions, RunCommandOptions, StartProcessOptions,
} from '@computesdk/provider';
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
  /** Team template to boot per standard `sizeClass`; defaults to {@link E2B_SIZE_TEMPLATES}. */
  sizeTemplates?: Partial<Record<InstanceSizeClass, string>>;
}

/**
 * E2B fixes CPU and memory when a template is built, so each standard size
 * boots its own team template. `scripts/provider-setup.mjs e2b` builds these
 * (node:22, same names as the other template-sized providers).
 */
export const E2B_SIZE_TEMPLATES: Readonly<Partial<Record<InstanceSizeClass, string>>> = Object.freeze({
  sm: 'csdk-node22-1cpu-2gb',
  md: 'csdk-node22-2cpu-4gb',
  lg: 'csdk-node22-4cpu-8gb',
  xl: 'csdk-node22-8cpu-16gb',
});

export interface E2BCreateTemplateOptions extends CreateTemplateOptions {
  /** Base image; defaults to E2B's base image. */
  image?: string;
  /** CPU and memory every sandbox booted from the template gets. */
  build?: { cpuCount?: number; memoryMB?: number; skipCache?: boolean };
}

/** A team template as returned by `GET /v2/templates`. */
export interface E2BTemplateInfo {
  id: string;
  templateID: string;
  names?: string[];
  buildStatus?: string;
  cpuCount?: number;
  memoryMB?: number;
  provider: 'e2b';
  [key: string]: unknown;
}

const apiKeyOf = (config: E2BConfig) => config.apiKey || (typeof process !== 'undefined' && process.env?.E2B_API_KEY) || '';
const apiUrl = () => process.env.E2B_API_URL || `https://api.${process.env.E2B_DOMAIN || 'e2b.app'}`;

function sizeTemplateOf(config: E2BConfig, sizeClass: InstanceSizeClass): string | undefined {
  const name = config.sizeTemplates?.[sizeClass] ?? E2B_SIZE_TEMPLATES[sizeClass];
  return typeof name === 'string' && name.trim() ? name : undefined;
}

/** A create that failed because a standard-size template was never built on this team. */
function missingSizeTemplate(config: E2BConfig, templateId: unknown, error: unknown): string | undefined {
  if (typeof templateId !== 'string' || !/\b404\b|not found/i.test(error instanceof Error ? error.message : String(error))) return undefined;
  const sizeClass = (Object.keys(E2B_SIZE_TEMPLATES) as InstanceSizeClass[]).find(c => sizeTemplateOf(config, c) === templateId);
  if (!sizeClass) return undefined;
  return `E2B size template '${templateId}' (sizeClass ${sizeClass}) is not built on this E2B team; run \`node scripts/provider-setup.mjs e2b\` (provider-setup.yml)`;
}

export const e2b = defineProvider<E2BSandbox, E2BConfig>({
  name: 'e2b',
  sizes: (config, profile, options) => {
    if (options?.cpuCount !== undefined || options?.memoryMB !== undefined) {
      throw new InstanceSizeError('conflict', 'cannot combine sizeClass with native E2B cpuCount/memoryMB');
    }
    if (options?.templateId !== undefined || options?.snapshotId !== undefined || options?.sandboxId !== undefined) {
      return { status: 'unsupported', reason: 'An E2B template or snapshot fixes CPU and memory; drop templateId/snapshotId to boot the standard size template.' };
    }
    const templateId = sizeTemplateOf(config, profile.sizeClass);
    if (!templateId) {
      return { status: 'unknown', reason: 'No E2B size template is set up for this standard shape.' };
    }
    return { status: 'supported', nativeOptions: { templateId } };
  },
  methods: {
    instances: {
      create: async (config: E2BConfig, options?: CreateInstanceOptions) => {
        const apiKey = apiKeyOf(config);

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
          const notBuilt = missingSizeTemplate(config, options?.templateId, error);
          if (notBuilt) throw new Error(notBuilt);
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
      // Builds through E2B's builder; sandboxes from it get build.cpuCount/memoryMB.
      create: async (config: E2BConfig, options: E2BCreateTemplateOptions): Promise<E2BTemplateInfo> => {
        if (!options.name?.trim()) throw new Error('An E2B template name is required.');
        if (options.description !== undefined || options.metadata !== undefined) {
          throw new Error('E2B template builds do not support description or metadata.');
        }
        const definition = options.image !== undefined
          ? E2BTemplate().fromImage(options.image)
          : E2BTemplate().fromBaseImage();
        const build = await E2BTemplate.build(definition, options.name, {
          apiKey: apiKeyOf(config),
          cpuCount: options.build?.cpuCount,
          memoryMB: options.build?.memoryMB,
          skipCache: options.build?.skipCache,
        });
        return {
          id: build.templateId, templateID: build.templateId, names: [build.name], buildID: build.buildId,
          buildStatus: 'ready', cpuCount: options.build?.cpuCount, memoryMB: options.build?.memoryMB, provider: 'e2b',
        };
      },
      // The SDK has no template listing; this is the documented GET /v2/templates.
      list: async (config: E2BConfig, options?: ListTemplatesOptions): Promise<E2BTemplateInfo[]> => {
        const limit = options?.limit;
        if (limit === 0) return [];
        const items: E2BTemplateInfo[] = [];
        let nextToken: string | null = null;
        do {
          const url = new URL(`${apiUrl()}/v2/templates`);
          url.searchParams.set('limit', '100');
          if (nextToken) url.searchParams.set('nextToken', nextToken);
          const res = await fetch(url, { headers: { 'X-API-Key': apiKeyOf(config) } });
          if (!res.ok) throw new Error(`Failed to list E2B templates: ${res.status} ${await res.text()}`);
          const page = await res.json() as Array<Record<string, unknown> & { templateID: string }>;
          items.push(...page.map(t => ({ ...t, id: t.templateID, provider: 'e2b' as const })));
          nextToken = res.headers.get('X-Next-Token');
        } while (nextToken && (limit === undefined || items.length < limit));
        return limit === undefined ? items : items.slice(0, limit);
      },
      delete: async (config: E2BConfig, templateId: string) => {
        const res = await fetch(`${apiUrl()}/templates/${encodeURIComponent(templateId)}`, {
          method: 'DELETE', headers: { 'X-API-Key': apiKeyOf(config) },
        });
        // 404 = already gone, which is what delete asked for.
        if (!res.ok && res.status !== 404) throw new Error(`Failed to delete E2B template: ${res.status} ${await res.text()}`);
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
