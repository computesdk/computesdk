/**
 * Sail provider for ComputeSDK.
 *
 * The provider maps ComputeSDK's universal sandbox interface onto Sailboxes
 * through the official `@sailresearch/sdk` package.
 */

import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  CreateInstanceOptions,
  CreateSnapshotOptions,
  ListSnapshotsOptions,
  FileEntry,
  RunCommandOptions,
  InstanceInfo,
} from '@computesdk/provider';
import {
  App,
  Client,
  Image,
  NotFoundError,
  Sailbox,
  resolveConfig,
  type ExecOptions,
  type ImageSpec,
  type SailboxSize,
  type VolumeInfo,
} from '@sailresearch/sdk';

/** Configuration for the Sail provider. */
export interface SailConfig {
  /** Sail API key. Falls back to `SAIL_API_KEY`. */
  apiKey?: string;
  /** App that owns created Sailboxes. Falls back to `SAIL_APP`, then `computesdk`. */
  app?: string;
  /** Image used by created Sailboxes. Defaults to Sail's ARM64 Devbox builtin. */
  image?: ImageSpec | Image;
}

const PROVIDER = 'sail';
const DEFAULT_APP = 'computesdk';
const GONE_STATUSES = new Set(['terminating', 'terminated']);
const MAX_RESOLVED_CONFIGS = 32;

interface ResolvedSailConfig {
  client: Client;
  appName: string;
  apiKey: string;
  sailboxApiUrl: string;
  appPromise?: Promise<App>;
}

const resolvedConfigs = new Map<string, ResolvedSailConfig>();

/** Resolve and cache equivalent provider configs so their transports are shared. */
function resolve(config: SailConfig): ResolvedSailConfig {
  const environment = resolveConfig();
  const apiKey = config.apiKey ?? environment.apiKey;
  if (!apiKey) {
    throw new Error(
      'Missing Sail API key. Pass sail({ apiKey }) or set SAIL_API_KEY. ' +
        'Create a key at https://app.sailresearch.com.',
    );
  }
  const appName = config.app ?? process.env.SAIL_APP ?? DEFAULT_APP;
  const cacheKey = JSON.stringify([
    apiKey,
    appName,
    environment.mode ?? null,
    environment.apiUrl,
    environment.sailboxApiUrl,
    environment.imagebuilderUrl,
    environment.ingressScheme,
    environment.ingressBase,
  ]);
  let entry = resolvedConfigs.get(cacheKey);
  if (entry) {
    // Refresh insertion order so the bounded map behaves as an LRU cache.
    resolvedConfigs.delete(cacheKey);
    resolvedConfigs.set(cacheKey, entry);
    return entry;
  }

  entry = {
    client: config.apiKey
      ? clientWithKey(config.apiKey, environment)
      : Client.fromEnv(),
    appName,
    apiKey,
    sailboxApiUrl: environment.sailboxApiUrl,
  };
  resolvedConfigs.set(cacheKey, entry);
  if (resolvedConfigs.size > MAX_RESOLVED_CONFIGS) {
    const oldest = resolvedConfigs.keys().next().value;
    if (oldest !== undefined) resolvedConfigs.delete(oldest);
  }
  return entry;
}

/** Resolve an app once per provider config and share concurrent lookups. */
function resolveApp(config: SailConfig): Promise<App> {
  const entry = resolve(config);
  if (entry.appPromise) return entry.appPromise;

  const pending = App.find(entry.appName, {
    client: entry.client,
    mintIfMissing: true,
  });
  entry.appPromise = pending;
  pending.catch(() => {
    if (entry.appPromise === pending) entry.appPromise = undefined;
  });
  return pending;
}

/** Preserve connection settings resolved by the Sail SDK. */
function clientWithKey(apiKey: string, environment: ReturnType<typeof resolveConfig>): Client {
  return Client.fromConfig({
    apiKey,
    mode: environment.mode ?? undefined,
    apiUrl: environment.apiUrl,
    sailboxApiUrl: environment.sailboxApiUrl,
    imagebuilderUrl: environment.imagebuilderUrl,
    // `ingressUrl` is a path-mode override. Subdomain mode is carried by mode.
    ingressUrl:
      environment.ingressScheme === 'path'
        ? environment.ingressBase
        : undefined,
  });
}

/** A Sail checkpoint surfaced as a ComputeSDK snapshot. */
export interface SailSnapshot {
  id: string;
  provider: typeof PROVIDER;
  createdAt: Date;
  metadata: {
    sailboxId: string;
    checkpointGeneration: number;
    name?: string;
    expiresAt?: Date;
  } & Record<string, unknown>;
}

interface CheckpointRecord {
  checkpoint_id: string;
  name: string | null;
  sailbox_id: string;
  app_id: string;
  checkpoint_generation: number;
  created_at: string;
  expires_at: string | null;
}

/** Call Sail's HTTPS Sailbox API for operations the SDK does not wrap
 *  (listing and deleting checkpoints). */
async function sailboxApi<T>(
  config: SailConfig,
  method: 'GET' | 'DELETE',
  path: string,
): Promise<{ status: number; body: T | undefined }> {
  const { apiKey, sailboxApiUrl } = resolve(config);
  const response = await fetch(`${sailboxApiUrl.replace(/\/+$/, '')}/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : undefined;
  if (!response.ok && response.status !== 404) {
    const message =
      (body as { error?: { message?: string } } | undefined)?.error?.message ?? text;
    throw new Error(`Sail ${method} ${path} failed (${response.status}): ${message}`);
  }
  return { status: response.status, body };
}

function toSnapshot(record: CheckpointRecord): SailSnapshot {
  return {
    id: record.checkpoint_id,
    provider: PROVIDER,
    createdAt: new Date(record.created_at),
    metadata: {
      sailboxId: record.sailbox_id,
      appId: record.app_id,
      checkpointGeneration: record.checkpoint_generation,
      name: record.name ?? undefined,
      expiresAt: record.expires_at ? new Date(record.expires_at) : undefined,
    },
  };
}

/** Convert an aborted signal into a stable Error for runtimes with arbitrary reasons. */
function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Sailbox creation was aborted.');
  error.name = 'AbortError';
  return error;
}

/**
 * Race creation against ComputeSDK cancellation and terminate a late result.
 * Sail's create API is idempotent but not abortable, so cleanup must remain
 * attached after the caller stops waiting to prevent an orphaned Sailbox.
 */
function createWithAbortCleanup(
  create: Promise<Sailbox>,
  signal: AbortSignal | undefined,
  client: Client,
): Promise<Sailbox> {
  if (!signal) return create;
  if (signal.aborted) {
    void create.then((box) => client.terminateSailbox(box.sailboxId)).catch(() => undefined);
    return Promise.reject(abortError(signal));
  }

  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      void create.then((box) => client.terminateSailbox(box.sailboxId)).catch(() => undefined);
      rejectPromise(abortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    create.then(
      (box) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolvePromise(box);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        rejectPromise(error);
      },
    );
  });
}

/** Convert ComputeSDK's millisecond lifetime to Sail's whole seconds. */
function lifetimeSeconds(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;
  if (!Number.isFinite(timeout) || timeout <= 0 || Math.ceil(timeout / 1_000) > 4_294_967_295) {
    throw new Error('Sail create timeout must be positive finite milliseconds (at most 4294967295000).');
  }
  return Math.ceil(timeout / 1_000);
}

/** Reject options that Sail cannot honor without changing their meaning. */
function validateCreateOptions(options: CreateInstanceOptions | undefined): void {
  const supported = new Set([
    'envs', 'image', 'memoryGib', 'name', 'provider', 'signal', 'size', 'snapshotId', 'timeout', 'volumes',
  ]);
  const unsupported = Object.keys(options ?? {}).filter(
    (key) => options?.[key] !== undefined && !supported.has(key),
  );
  if (unsupported.length > 0) {
    throw new Error(`Sail does not support create option(s): ${unsupported.join(', ')}.`);
  }
  lifetimeSeconds(options?.timeout);
  if (options?.size !== undefined && !['s', 'm', 'l'].includes(options.size)) {
    throw new Error(`Sail does not support size ${options.size}; use s, m, or l.`);
  }
  if (options?.snapshotId !== undefined &&
      (options.image !== undefined || options.envs !== undefined || options.volumes !== undefined ||
       options.size !== undefined || options.memoryGib !== undefined)) {
    throw new Error('Sail restores the checkpoint environment and resources; image, envs, volumes, size, and memoryGib cannot be combined with snapshotId.');
  }
  if (options?.volumes !== undefined) {
    if (!Array.isArray(options.volumes)) throw new Error('Sail volumes must be an array of volume mounts.');
    const paths = new Set<string>();
    for (const mount of options.volumes) {
      if (!mount || typeof mount.mountPath !== 'string' || !mount.mountPath.startsWith('/') ||
          paths.has(mount.mountPath)) {
        throw new Error('Sail volume mount paths must be absolute and unique.');
      }
      paths.add(mount.mountPath);
      if (mount.readOnly !== undefined && typeof mount.readOnly !== 'boolean') {
        throw new Error('Sail volume readOnly must be a boolean.');
      }
    }
  }
}

/** Look up names without minting; ids are resolved from the org inventory. */
async function findVolume(client: Client, idOrName: string): Promise<VolumeInfo | null> {
  try {
    return await client.getVolume(idOrName, false);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
    return (await client.listVolumes()).find((volume) => volume.volumeId === idOrName) ?? null;
  }
}

function toVolume(volume: VolumeInfo) {
  return { id: volume.volumeId, name: volume.name, createdAt: volume.createdAt };
}

async function volumeMounts(client: Client, mounts: CreateInstanceOptions['volumes']) {
  const result: Record<string, { volume: string; readOnly?: boolean }> = {};
  for (const mount of mounts ?? []) {
    const ref = mount.volume;
    let id: string | undefined;
    if (typeof ref === 'object' && ref !== null && typeof ref.id === 'string') {
      id = ref.id;
    } else {
      const name = typeof ref === 'string' ? ref : ref?.name;
      if (typeof name !== 'string' || !name) throw new Error('Sail volume must have an id or name.');
      id = (await findVolume(client, name))?.volumeId;
      if (!id) throw new Error(`Sail volume not found: ${name}`);
    }
    result[mount.mountPath] = { volume: id, readOnly: mount.readOnly };
  }
  return result;
}

/** Map ComputeSDK protocols onto Sail ingress listeners. */
function toIngressProtocol(protocol: string | undefined): 'http' | 'tcp' {
  if (protocol === undefined || protocol === 'http' || protocol === 'https') {
    return 'http';
  }
  if (protocol === 'tcp') return 'tcp';
  throw new Error(`Sail does not support ingress protocol ${protocol}; use http, https, or tcp.`);
}

/** Map Sail lifecycle states onto ComputeSDK's three status values. */
function toStatus(status: string): InstanceInfo['status'] {
  switch (status) {
    case 'running':
      return 'running';
    case 'failed':
    case 'create_failed':
    case 'interrupted_unsafe_to_retry':
      return 'error';
    default:
      return 'stopped';
  }
}

/** The framework-supplied command runner handed to filesystem callbacks. */
type CommandRunner = (
  sandbox: Sailbox,
  command: string,
  options?: RunCommandOptions,
) => Promise<CommandResult>;

const FALLBACK_WORKDIR = '/';

/** Cached `pwd` probes: `fs.*` demands absolute paths, so relative filesystem
 *  paths resolve against the cwd a `runCommand` exec would use —
 *  `writeFile('a.txt')` and `cat a.txt` then agree. */
const workdirs = new WeakMap<Sailbox, Promise<string>>();

function workdirOf(sandbox: Sailbox, runCommand: CommandRunner): Promise<string> {
  let probe = workdirs.get(sandbox);
  if (!probe) {
    probe = runCommand(sandbox, 'pwd').then((result) => {
      const dir = result.stdout.trim();
      if (result.exitCode === 0 && dir.startsWith('/')) return dir;
      // runCommand reports exec failures as results, not rejections, so a
      // transient failure must not pin the workdir to the fallback forever —
      // evict and let the next filesystem op probe again.
      workdirs.delete(sandbox);
      return FALLBACK_WORKDIR;
    });
    workdirs.set(sandbox, probe);
    probe.catch(() => workdirs.delete(sandbox));
  }
  return probe;
}

/** Join `path` onto the sandbox workdir. Absolute paths pass through and skip
 *  the probe; empty and `.` segments are dropped; `..` segments are preserved
 *  for the sandbox filesystem to resolve physically — collapsing them
 *  lexically would mis-resolve when a preceding component is a symlink. */
async function resolveSandboxPath(
  sandbox: Sailbox,
  path: string,
  runCommand: CommandRunner,
): Promise<string> {
  const combined = path.startsWith('/')
    ? path
    : `${await workdirOf(sandbox, runCommand)}/${path}`;
  const segments: string[] = [];
  for (const segment of combined.split('/')) {
    if (segment === '' || segment === '.') continue;
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

/** Translate millisecond ComputeSDK command timeouts into Sail seconds. */
function toExecOptions(options?: RunCommandOptions) {
  return {
    cwd: options?.cwd,
    env: options?.env,
    background: options?.background,
    timeoutSeconds:
      options?.timeout !== undefined ? options.timeout / 1_000 : undefined,
  } satisfies ExecOptions;
}

export const sail = defineProvider<Sailbox, SailConfig>({
  name: PROVIDER,
  methods: {
    instances: {
      create: async (config, options?: CreateInstanceOptions) => {
        validateCreateOptions(options);
        if (options?.signal?.aborted) throw abortError(options.signal);
        const { client } = resolve(config);
        const name = options?.name ?? `csdk-${crypto.randomUUID().slice(0, 8)}`;
        if (options?.snapshotId) {
          const restore = Sailbox.fromCheckpoint({
            checkpointId: options.snapshotId,
            maxLifetimeSeconds: lifetimeSeconds(options.timeout),
            name,
            client,
          });
          const sandbox = await createWithAbortCleanup(restore, options.signal, client);
          return { instance: sandbox, instanceId: sandbox.sailboxId };
        }
        const app = await resolveApp(config);
        if (options?.signal?.aborted) throw abortError(options.signal);

        const volumes = options?.volumes === undefined
          ? undefined
          : await volumeMounts(client, options.volumes);
        if (options?.signal?.aborted) throw abortError(options.signal);
        const creation = Sailbox.create({
          app,
          name,
          client,
          image: options?.image !== undefined
            ? Image.fromRegistry(options.image)
            : config.image ?? Image.devbox('arm64'),
          ...(options?.size === undefined ? {} : { size: options.size as SailboxSize }),
          ...(options?.memoryGib === undefined ? {} : { memoryLimitGib: options.memoryGib }),
          env: options?.envs,
          volumes,
          maxLifetimeSeconds: lifetimeSeconds(options?.timeout),
        });
        const sandbox = await createWithAbortCleanup(creation, options?.signal, client);
        return { instance: sandbox, instanceId: sandbox.sailboxId };
      },

      getById: async (config, sandboxId) => {
        const { client } = resolve(config);
        try {
          const sandbox = await Sailbox.get(sandboxId, { client });
          if (GONE_STATUSES.has(sandbox.status)) return null;
          return { instance: sandbox, instanceId: sandbox.sailboxId };
        } catch (error) {
          if (error instanceof NotFoundError) return null;
          throw error;
        }
      },

      list: async (config) => {
        const { client, appName } = resolve(config);
        let app: App;
        try {
          app = await App.find(appName, { client, mintIfMissing: false });
        } catch (error) {
          if (error instanceof NotFoundError) return [];
          throw error;
        }
        const sandboxes = await Sailbox.list({ appId: app.id, client });
        return sandboxes
          .filter((sandbox) => !GONE_STATUSES.has(sandbox.status))
          .map((sandbox) => ({ instance: sandbox, instanceId: sandbox.sailboxId }));
      },

      destroy: async (config, sandboxId) => {
        await resolve(config).client.terminateSailbox(sandboxId);
      },

      runCommand: async (
        sandbox,
        command,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startedAt = Date.now();
        if (options?.background) {
          await sandbox.exec(command, toExecOptions(options));
          return {
            stdout: '',
            stderr: '',
            exitCode: 0,
            durationMs: Date.now() - startedAt,
          };
        }
        const result = await sandbox.run(command, toExecOptions(options));
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: Date.now() - startedAt,
        };
      },

      getInfo: async (sandbox): Promise<InstanceInfo> => {
        const current = await Sailbox.get(sandbox.sailboxId, {
          client: sandbox.client,
        });
        return {
          id: current.sailboxId,
          provider: PROVIDER,
          status: toStatus(current.status),
          createdAt: current.createdAt ?? new Date(0),
          timeout: current.expiresAt ? Math.max(0, current.expiresAt.getTime() - Date.now()) : 0,
        };
      },

      getUrl: async (sandbox, options): Promise<string> => {
        const protocol = toIngressProtocol(options.protocol);
        const existing = await sandbox.listener(options.port).catch((error: unknown) => {
          if (!(error instanceof NotFoundError)) throw error;
          return undefined;
        });
        if (existing === undefined) {
          await sandbox.expose(options.port, { protocol });
        } else if (existing.protocol !== protocol) {
          throw new Error(
            `Sailbox port ${options.port} is already exposed as ${existing.protocol}; ` +
              `request ${existing.protocol} or unexpose it first.`,
          );
        }

        const listener = await sandbox.waitForListener(options.port);
        if (listener.endpoint?.kind === 'http') return listener.endpoint.url;
        if (listener.endpoint?.kind === 'tcp') {
          return `tcp://${listener.endpoint.host}:${listener.endpoint.port}`;
        }
        throw new Error(`Sailbox port ${options.port} has no reachable endpoint.`);
      },

      filesystem: {
        readFile: async (sandbox, path, runCommand: CommandRunner) =>
          (
            await sandbox.fs.read(
              await resolveSandboxPath(sandbox, path, runCommand),
            )
          ).toString('utf8'),
        writeFile: async (sandbox, path, content, runCommand: CommandRunner) => {
          await sandbox.fs.write(
            await resolveSandboxPath(sandbox, path, runCommand),
            content,
          );
        },
        mkdir: async (sandbox, path, runCommand: CommandRunner) => {
          await sandbox.fs.mkdir(
            await resolveSandboxPath(sandbox, path, runCommand),
          );
        },
        readdir: async (sandbox, path, runCommand: CommandRunner): Promise<FileEntry[]> =>
          (
            await sandbox.fs.ls(
              await resolveSandboxPath(sandbox, path, runCommand),
            )
          ).map((entry) => ({
            name: entry.name,
            type: entry.type === 'directory' ? 'directory' : 'file',
            size: entry.size,
            modified: new Date(entry.modifiedTime * 1_000),
          })),
        exists: async (sandbox, path, runCommand: CommandRunner) =>
          sandbox.fs.exists(await resolveSandboxPath(sandbox, path, runCommand)),
        remove: async (sandbox, path, runCommand: CommandRunner) => {
          // An empty or dot-only path would resolve to the workdir itself —
          // refuse it rather than delete the sandbox's whole cwd.
          if (path.split('/').every((s) => s === '' || s === '.')) {
            throw new Error(`remove: refusing ambiguous path: ${JSON.stringify(path)}`);
          }
          await sandbox.fs.remove(
            await resolveSandboxPath(sandbox, path, runCommand),
          );
        },
      },

      getInstance: (sandbox) => sandbox,

      // Pause holds the Sailbox in memory: files anywhere on the rootfs and
      // running processes survive. `getInstance().sleep()` stays available
      // for Sail's to-disk sleep.
      pause: async (sandbox) => {
        await sandbox.pause();
      },
      resume: async (sandbox) => {
        await sandbox.resume();
      },
      pauseCapabilities: { memory: true },
    },

    volume: {
      create: async (config, options) => {
        const unsupported = Object.keys(options).filter(
          (key) => key !== 'name' && options[key] !== undefined,
        );
        if (unsupported.length) {
          throw new Error(`Sail does not support volume create option(s): ${unsupported.join(', ')}. Volumes grow with their contents.`);
        }
        return toVolume(await resolve(config).client.getVolume(options.name, true));
      },
      get: async (config, idOrName) => {
        const volume = await findVolume(resolve(config).client, idOrName);
        return volume ? toVolume(volume) : null;
      },
      list: async (config, options) =>
        (await resolve(config).client.listVolumes(options?.limit)).map(toVolume),
      delete: async (config, idOrName) => {
        const { client } = resolve(config);
        const volume = await findVolume(client, idOrName);
        if (volume) await client.deleteVolume(volume.volumeId, true);
      },
    },

    snapshot: {
      // A checkpoint saves the Sailbox's memory and disk and leaves it
      // running; `create({ snapshotId })` starts a new Sailbox from it.
      // `/tmp` lives on the root disk, so the whole filesystem is kept.
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false },

      create: async (
        config,
        sandboxId: string,
        options?: CreateSnapshotOptions,
      ): Promise<SailSnapshot> => {
        const { client } = resolve(config);
        const checkpoint = await Sailbox.fromId(sandboxId, { client }).checkpoint({
          name: options?.name,
        });
        return {
          id: checkpoint.checkpointId,
          provider: PROVIDER,
          createdAt: new Date(),
          metadata: {
            ...options?.metadata,
            sailboxId: checkpoint.sailboxId,
            checkpointGeneration: checkpoint.checkpointGeneration,
            name: options?.name,
            expiresAt: checkpoint.expiresAt,
          },
        };
      },

      list: async (config, options?: ListSnapshotsOptions): Promise<SailSnapshot[]> => {
        const sailboxId = options?.instanceId ?? options?.sandboxId;
        const snapshots: SailSnapshot[] = [];
        const pageSize = 100;
        for (let offset = 0; ; offset += pageSize) {
          const query = new URLSearchParams({
            limit: String(pageSize),
            offset: String(offset),
          });
          if (sailboxId) query.set('sailbox_id', sailboxId);
          const { body } = await sailboxApi<{
            data: CheckpointRecord[];
            has_more: boolean;
          }>(config, 'GET', `/sailbox-checkpoints?${query}`);
          for (const record of body?.data ?? []) {
            snapshots.push(toSnapshot(record));
            if (options?.limit !== undefined && snapshots.length >= options.limit) {
              return snapshots;
            }
          }
          if (!body?.has_more) return snapshots;
        }
      },

      delete: async (config, snapshotId: string) => {
        await sailboxApi(
          config,
          'DELETE',
          `/sailbox-checkpoints/${encodeURIComponent(snapshotId)}`,
        );
      },
    },
  },
});
