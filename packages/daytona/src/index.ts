/**
 * Daytona Provider - Factory-based Implementation (Daytona v2 platform)
 */

import { Daytona } from '@daytona/sdk';
import type { DaytonaV2Client } from '@daytona/sdk';
import { NotFoundError, Sandbox as DaytonaSandbox } from '@daytona/sdk/v2';
import type { CreateSandboxOptions } from '@daytona/sdk/v2';
import { resolveVolumeRef, isUnifiedVolumeMounts, withVolumeSettle, errorText } from '@computesdk/provider';
import { defineProvider, escapeShellArg, InstanceSizeError } from '@computesdk/provider';

import type {
  CommandResult, InstanceInfo, CreateInstanceOptions, FileEntry, RunCommandOptions, InstanceSizeClass,
} from '@computesdk/provider';

/**
 * Daytona-specific configuration options
 */
export interface DaytonaConfig {
  /** Daytona API key - if not provided, will fallback to DAYTONA_API_KEY environment variable */
  apiKey?: string;
  /** Default runtime environment (e.g. 'python', 'node'); unused on Daytona v2, which boots images */
  runtime?: string;
  /** Sandbox create wait in milliseconds */
  timeout?: number;
  /** Image booted for a `sizeClass` create without an `image`; defaults to the Daytona platform image */
  sizeImage?: string;
}

/** Daytona's documented per-sandbox maximum (https://www.daytona.io/docs/en/sandboxes). */
const DAYTONA_MAX_VCPUS = 4;
const DAYTONA_MAX_MEMORY_GIB = 8;

/** Disk (GiB) the ComputeSDK platform requests for each Daytona size. */
const DAYTONA_SIZE_DISK_GIB: Readonly<Partial<Record<InstanceSizeClass, number>>> = Object.freeze({
  sm: 10,
  md: 20,
  lg: 40,
});

/** Stop/start/pause/resume can outlast the SDK's default wait. */
const LIFECYCLE_TIMEOUT_S = 300;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isNotFound(err: unknown): boolean {
  return err instanceof NotFoundError
    || (err as { statusCode?: number }).statusCode === 404
    || (err as { status?: number }).status === 404
    || /not found|no such file/i.test(errorText(err));
}

function client(config: DaytonaConfig): DaytonaV2Client {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.DAYTONA_API_KEY) || undefined;
  return new Daytona({ apiKey }).v2;
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of items) out.push(item);
  return out;
}

/**
 * Create a Daytona provider instance using the factory pattern
 */
export const daytona = defineProvider<DaytonaSandbox, DaytonaConfig>({
  name: 'daytona',
  sizes: (config, profile, options) => {
    const native = options as Record<string, unknown> | undefined;
    if (native?.disk !== undefined || native?.gpu !== undefined) {
      throw new InstanceSizeError('conflict', 'cannot combine sizeClass with native Daytona disk/gpu resources');
    }
    if (options?.snapshotId !== undefined || native?.snapshot !== undefined) {
      return {
        status: 'unsupported',
        reason: 'A Daytona snapshot fixes CPU, memory and disk; drop snapshotId/snapshot to boot the standard size from an image.',
      };
    }
    const memoryGiB = profile.memoryMiB / 1024;
    if (profile.vcpus > DAYTONA_MAX_VCPUS || memoryGiB > DAYTONA_MAX_MEMORY_GIB) {
      return {
        status: 'unsupported',
        reason: `Daytona sandboxes are limited to ${DAYTONA_MAX_VCPUS} vCPU / ${DAYTONA_MAX_MEMORY_GIB} GiB RAM.`,
      };
    }
    const disk = DAYTONA_SIZE_DISK_GIB[profile.sizeClass];
    return {
      status: 'supported',
      nativeOptions: {
        ...(native?.image === undefined && options?.templateId === undefined && config.sizeImage !== undefined && { image: config.sizeImage }),
        resources: { cpu: profile.vcpus, memory: memoryGiB, ...(disk !== undefined && { disk }) },
      },
      ...(disk !== undefined && {
        resolved: { vcpus: profile.vcpus, memoryMiB: profile.memoryMiB, diskMiB: disk * 1024 },
      }),
    };
  },
  methods: {
    instances: {
      create: async (config: DaytonaConfig, options?: CreateInstanceOptions) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.DAYTONA_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing Daytona API key. Provide 'apiKey' in config or set DAYTONA_API_KEY environment variable. Get your API key from https://daytona.io/`
          );
        }

        const timeout = options?.timeout ?? config.timeout;

        try {
          const d = client({ ...config, apiKey });

          const {
            timeout: _timeout,
            envs,
            name,
            metadata,
            templateId,
            snapshotId,
            sandboxId: _sandboxId,
            namespace: _namespace,
            directory: _directory,
            volumes,
            // v0-only create fields with no v2 equivalent.
            runtime: _runtime,
            language: _language,
            image: nativeImage,
            snapshot: nativeSnapshot,
            ...providerOptions
          } = (options || {}) as CreateInstanceOptions & Record<string, any>;

          // `volumes` only counts as unified VolumeMount[] when every entry
          // carries `volume`; a provider-native volumes spec reaches the SDK untouched.
          const unifiedVolumes = isUnifiedVolumeMounts(volumes) ? volumes : undefined;

          const createOptions: Record<string, any> = {
            ...providerOptions,
            ...(volumes !== undefined && {
              volumes: unifiedVolumes
                ? unifiedVolumes.map((m: any) => ({
                  volumeId: resolveVolumeRef(m.volume).id ?? resolveVolumeRef(m.volume).name,
                  mountPath: m.mountPath,
                }))
                : volumes,
            }),
          };

          if (envs && Object.keys(envs).length > 0) createOptions.env = envs;
          if (name) createOptions.name = name;

          if (metadata && typeof metadata === 'object') {
            const labels: Record<string, string> = {};
            for (const [k, v] of Object.entries(metadata)) {
              labels[k] = typeof v === 'string' ? v : JSON.stringify(v);
            }
            createOptions.labels = labels;
          }

          if (timeout) createOptions.waitSeconds = Math.ceil(timeout / 1000);

          // v2 snapshots (memory + disk) boot through createFromSnapshot;
          // templates are v2 images, the successor of v0 snapshots.
          const snapshot = snapshotId || nativeSnapshot;
          const session = snapshot
            ? await d.createFromSnapshot(snapshot, createOptions as any)
            : await d.create(templateId || nativeImage, createOptions as CreateSandboxOptions);

          return { instance: session, instanceId: session.id };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key')) {
              throw new Error(`Daytona authentication failed. Please check your DAYTONA_API_KEY environment variable.`);
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(`Daytona quota exceeded. Please check your usage at https://daytona.io/`);
            }
          }
          throw new Error(`Failed to create Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: DaytonaConfig, sandboxId: string) => {
        try {
          const session = await client(config).get(sandboxId);
          return { instance: session, instanceId: sandboxId };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw new Error(`Failed to get Daytona sandbox ${sandboxId}: ${errorText(error)}`);
        }
      },

      list: async (config: DaytonaConfig) => {
        try {
          const sandboxes = await collect(client(config).iter());
          return sandboxes.map((session) => ({ instance: session, instanceId: session.id }));
        } catch (error) {
          throw new Error(`Failed to list Daytona sandboxes: ${errorText(error)}`);
        }
      },

      destroy: async (config: DaytonaConfig, sandboxId: string) => {
        try {
          await client(config).delete(sandboxId);
        } catch (error) {
          if (isNotFound(error)) return;
          throw new Error(`Failed to destroy Daytona sandbox ${sandboxId}: ${errorText(error)}`);
        }
      },

      runCommand: async (sandbox: DaytonaSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          const fullCommand = options?.background
            ? `nohup sh -c ${shellQuote(command)} > /dev/null 2>&1 &`
            : command;
          const env = options?.env && Object.keys(options.env).length > 0 ? options.env : undefined;
          const result = await sandbox.exec(fullCommand, {
            ...(options?.cwd && { cwd: options.cwd }),
            ...(env && { env }),
            ...(options?.timeout !== undefined && { timeoutSeconds: Math.max(1, Math.ceil(options.timeout / 1000)) }),
          });
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode ?? (result.reason === 'exited' ? 0 : 1),
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          throw new Error(`Daytona command execution failed: ${errorText(error)}`);
        }
      },

      getInfo: async (sandbox: DaytonaSandbox): Promise<InstanceInfo> => {
        const state = sandbox.state;
        return {
          id: sandbox.id,
          provider: 'daytona',
          status: state === 'error' ? 'error' : ['stopped', 'paused', 'destroyed'].includes(state) ? 'stopped' : 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: { daytonaSandboxId: sandbox.id, state }
        };
      },

      getUrl: async (sandbox: DaytonaSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          const previewInfo = await sandbox.ports.previewLink(options.port);
          let url = previewInfo.url;
          if (options.protocol) {
            const urlObj = new URL(url);
            urlObj.protocol = options.protocol + ':';
            url = urlObj.toString();
          }
          return url;
        } catch (error) {
          throw new Error(`Failed to get Daytona preview URL for port ${options.port}: ${errorText(error)}`);
        }
      },

      filesystem: {
        readFile: async (sandbox: DaytonaSandbox, path: string): Promise<string> => {
          try {
            return await sandbox.fs.readText(path);
          } catch (error) {
            throw new Error(`File not found or cannot be read: ${path} (${errorText(error)})`);
          }
        },
        writeFile: async (sandbox: DaytonaSandbox, path: string, content: string): Promise<void> => {
          await sandbox.fs.writeText(path, content);
        },
        mkdir: async (sandbox: DaytonaSandbox, path: string): Promise<void> => {
          await sandbox.fs.mkdir(path, { mode: '755' });
        },
        readdir: async (sandbox: DaytonaSandbox, path: string): Promise<FileEntry[]> => {
          const files = await sandbox.fs.list(path);
          return files.items.map((f) => ({
            name: f.name,
            type: f.isDir ? 'directory' as const : 'file' as const,
            size: f.size || 0,
            modified: new Date(f.modifiedAt || f.modTime || Date.now()),
          }));
        },
        exists: async (sandbox: DaytonaSandbox, path: string): Promise<boolean> => {
          try {
            await sandbox.fs.stat(path);
            return true;
          } catch (error) {
            if (isNotFound(error)) return false;
            throw error;
          }
        },
        remove: async (sandbox: DaytonaSandbox, path: string): Promise<void> => {
          try {
            await sandbox.fs.remove(path, { recursive: true });
          } catch (error) {
            if (!isNotFound(error)) throw error;
          }
        }
      },

      getInstance: (sandbox: DaytonaSandbox): DaytonaSandbox => sandbox,

      // Daytona v2 sandboxes are VMs: pause keeps memory, so running processes survive.
      pause: async (sandbox: DaytonaSandbox): Promise<void> => {
        await sandbox.pause({ timeoutSeconds: LIFECYCLE_TIMEOUT_S });
      },
      resume: async (sandbox: DaytonaSandbox): Promise<void> => {
        await sandbox.resume({ timeoutSeconds: LIFECYCLE_TIMEOUT_S });
      },
      pauseCapabilities: { memory: true },
    },

    // v2 snapshots capture memory and disk of a running sandbox.
    snapshot: {
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false },
      create: async (config: DaytonaConfig, sandboxId: string, options?: { name?: string }) => {
        try {
          const name = options?.name || `snapshot-${Date.now()}`;
          const sandbox = await client(config).get(sandboxId);
          const snapshot = await sandbox.createSnapshot(name);
          return { id: snapshot.id, provider: 'daytona', createdAt: new Date(snapshot.createdAt), metadata: { name: snapshot.name, status: snapshot.status } };
        } catch (error) {
          throw new Error(`Failed to create Daytona snapshot: ${errorText(error)}`);
        }
      },
      list: async (config: DaytonaConfig) => {
        try {
          const snapshots = await collect(client(config).snapshots.iter());
          return snapshots.map((s) => ({
            id: s.id, provider: 'daytona', createdAt: new Date(s.createdAt), metadata: { name: s.name, status: s.status },
          }));
        } catch { return []; }
      },
      delete: async (config: DaytonaConfig, snapshotId: string) => {
        try { await client(config).snapshots.delete(snapshotId); } catch { /* ignore */ }
      }
    },

    // v2 images replace v0 snapshots as the boot source for new sandboxes.
    template: {
      create: async (_config: DaytonaConfig, _options: { name: string }) => {
        throw new Error('To create a template in Daytona, capture an image from a running sandbox with sandbox.captureImage()');
      },
      list: async (config: DaytonaConfig) => {
        try {
          const images = await collect(client(config).images.iter());
          return images.map((i) => ({
            id: i.id, provider: 'daytona', createdAt: new Date(i.createdAt), metadata: { name: i.name, status: i.status },
          }));
        } catch { return []; }
      },
      delete: async (config: DaytonaConfig, templateId: string) => {
        try { await client(config).images.delete(templateId); } catch { /* ignore */ }
      }
    },

    volume: {
      create: async (config: DaytonaConfig, options) => {
        const volume = await client(config).volumes.create({ name: options.name });
        if (volume.status !== 'ready') {
          throw new Error(`Daytona volume ${options.name} is not mountable (status: ${volume.rawStatus})`);
        }
        return { id: volume.id, name: volume.name, native: volume };
      },
      get: async (config: DaytonaConfig, idOrName: string) => {
        try {
          const volume = await client(config).volumes.get(idOrName);
          return { id: volume.id, name: volume.name, native: volume };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },
      list: async (config: DaytonaConfig) => {
        const volumes = await collect(client(config).volumes.iter());
        return volumes.map((v) => ({ id: v.id, name: v.name, native: v }));
      },
      delete: async (config: DaytonaConfig, idOrName: string) => {
        try {
          await withVolumeSettle(() => client(config).volumes.delete(idOrName));
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      },
    }
  }
});
