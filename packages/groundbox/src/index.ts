/**
 * Groundbox Provider - Factory-based Implementation
 *
 * Groundbox sandboxes are Firecracker VMs. This adapter is a thin layer over
 * the official `@groundbox/sdk` client: commands, live output and processes
 * through the exec API, files through the files API, preview URLs, pause and
 * resume, lifetime renewal, kept snapshots, templates and volumes.
 */

import {
  Groundbox,
  GroundboxError,
  type CreateSandboxRequest,
  type CreateTemplateRequest,
  type KillCommandRequest,
  type Sandbox,
  type Snapshot as NativeSnapshot,
  type Template,
  type Volume as NativeVolume,
} from '@groundbox/sdk';
import { InstanceSizeError, defineProvider, isUnifiedVolumeMounts, resolveVolumeRef } from '@computesdk/provider';
import type {
  CommandResult,
  CreateInstanceOptions,
  CreateTemplateOptions,
  CreateVolumeOptions,
  FileEntry,
  InstanceInfo,
  CreateSnapshotOptions,
  ListSnapshotsOptions,
  ListTemplatesOptions,
  ListVolumesOptions,
  ProcessHandle,
  ProcessStatus,
  RunCommandOptions,
  StartProcessOptions,
  Volume,
} from '@computesdk/provider';

export { GroundboxError } from '@groundbox/sdk';
export type { Sandbox as GroundboxSandbox, Snapshot as GroundboxNativeSnapshot, Template as GroundboxTemplate } from '@groundbox/sdk';

export interface GroundboxConfig {
  /** Groundbox API key (`gbx_...`). Falls back to the `GROUNDBOX_API_KEY` environment variable. */
  apiKey?: string;
  /** API base, ending in /v1. Falls back to `GROUNDBOX_API_URL`, then https://api.groundbox.dev/v1. */
  baseUrl?: string;
  /**
   * What `getUrl` makes. `private` (the default): a preview only the team can open, returned
   * as its share link, which carries a token that works for 24 hours. `public`: a preview
   * anyone with the URL can open, returned as the plain URL.
   */
  previews?: 'private' | 'public';
  /** Custom HTTP transport. */
  fetch?: typeof fetch;
  /** The WebSocket live output and `startProcess` use. Defaults to the runtime's own (Node 22 has one; on Node 20 pass one, such as the `ws` package's). */
  WebSocket?: typeof WebSocket;
}

/** The native handle: the sandbox id and the `@groundbox/sdk` client that reaches it. */
export interface GroundboxInstance {
  id: string;
  client: Groundbox;
}

/** `template.create` options: a name plus what the template is built from. */
export interface GroundboxCreateTemplateOptions extends CreateTemplateOptions, Omit<CreateTemplateRequest, 'name'> {}

/** A Groundbox volume, as `provider.volume` returns it. */
export interface GroundboxVolume extends Volume {
  id: string;
  sizeGb: number;
  status: NativeVolume['status'];
  native: NativeVolume;
}

/** A Groundbox kept snapshot, as `provider.snapshot` returns it. */
export interface GroundboxSnapshot {
  id: string;
  provider: 'groundbox';
  createdAt: Date;
  status: NativeSnapshot['status'];
  sourceInstanceId: string;
  name?: string;
  metadata: { cpus: number; memoryGb: number; diskGb: number; memory: boolean; sizeBytes: number; expiresAt: string | null };
  native: NativeSnapshot;
}

/** Sandbox sizes Groundbox sells: 1 to 16 whole vCPUs, and whole GB of memory up to 4 GB per vCPU. */
const MAX_VCPUS = 16;
/** The largest standard size that was booted and measured through this adapter (xl). */
const VERIFIED_MAX_VCPUS = 8;
const MAX_MEMORY_GB_PER_VCPU = 4;
/** Lifetimes: one hour unless a timeout is given, 30 days at most, renewable. */
const DEFAULT_LIFETIME_MINUTES = 60;
const MAX_LIFETIME_MINUTES = 30 * 24 * 60;
/** A background command or a process: one hour unless a timeout is given, 30 days at most. */
const MAX_PROCESS_TIMEOUT_S = 30 * 24 * 3600;
/** How long `create` waits for a sandbox made from an image: the image is turned into a disk first. */
const IMAGE_WAIT_MS = 35 * 60_000;
/** How long `snapshot.waitUntilReady` waits by default, and `snapshot.delete` retries one still being made. */
const SNAPSHOT_WAIT_MS = 10 * 60_000;
const SNAPSHOT_DELETE_RETRY_MS = 60_000;
/** The size of a volume made with no size given, in GB. */
export const DEFAULT_VOLUME_GB = 10;

/** A command's timeout: 60 seconds unless one is given, one hour at most. */
const DEFAULT_COMMAND_TIMEOUT_S = 60;
const MAX_COMMAND_TIMEOUT_S = 3600;
const PAGE_LIMIT = 200;
const STATE_WAIT_MS = 120_000;
const DEFAULT_BASE_URL = 'https://api.groundbox.dev/v1';
/** Statuses a sandbox does not come back from by itself: waiting for another one is over. */
const NOT_COMING_STATUSES: readonly Sandbox['status'][] = ['stopping', 'stopped', 'failed', 'shutting_down', 'shut_down'];
/** The signals the commands API sends (COMMAND_SIGNALS in the API's contract). */
const COMMAND_SIGNALS: readonly NonNullable<KillCommandRequest['signal']>[] = ['SIGKILL', 'SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2'];

const USER_AGENT = 'computesdk-groundbox';

const clients = new WeakMap<GroundboxConfig, Groundbox>();
/** What `getUrl` makes with each client: see `GroundboxConfig.previews`. */
const previewModes = new WeakMap<Groundbox, 'private' | 'public'>();

/** The client for a config: the key from the config, else `GROUNDBOX_API_KEY`. */
function clientFor(config: GroundboxConfig): Groundbox {
  const cached = clients.get(config);
  if (cached) return cached;
  const apiKey = config.apiKey || process.env.GROUNDBOX_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing API key for groundbox.\n\n' +
        'Create a key in the dashboard: https://app.groundbox.dev/keys\n' +
        'Then pass it: groundbox({ apiKey: "gbx_..." })\n' +
        'Or set GROUNDBOX_API_KEY in your environment.',
    );
  }
  const baseUrl = (config.baseUrl || process.env.GROUNDBOX_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const client = new Groundbox({
    apiKey,
    baseUrl,
    userAgent: USER_AGENT,
    ...(config.fetch ? { fetch: config.fetch } : {}),
    ...(config.WebSocket ? { WebSocket: config.WebSocket } : {}),
  });
  clients.set(config, client);
  previewModes.set(client, config.previews ?? 'private');
  return client;
}

const isNotFound = (error: unknown) => error instanceof GroundboxError && error.code === 'not_found';

const abortReason = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('This operation was aborted', 'AbortError');

/** Wait `ms`; an abort ends the wait at once, rejecting with the signal's reason. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Milliseconds to whole minutes, rounded up, within what the API takes. */
function toMinutes(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) throw new Error('Groundbox timeouts are a positive number of milliseconds');
  return Math.min(Math.max(Math.ceil(ms / 60_000), 1), MAX_LIFETIME_MINUTES);
}

/** Groundbox metadata values are strings: anything else is stored as its JSON. */
function toMetadata(metadata: Record<string, unknown> | undefined, name: string | undefined): Record<string, string> | undefined {
  const entries = Object.entries(metadata ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)] as const);
  if (name !== undefined && !entries.some(([key]) => key === 'name')) entries.push(['name', name]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toSpec(options: CreateInstanceOptions): CreateSandboxRequest {
  const from = (['snapshotId', 'image', 'templateId'] as const).filter((field) => options[field] !== undefined);
  if (from.length > 1) {
    throw new Error(`Groundbox starts a sandbox from one of a snapshot, an image or a template: pass one of snapshotId, image and templateId, not ${from.join(' and ')}`);
  }
  const volumes = isUnifiedVolumeMounts(options.volumes)
    ? options.volumes.map((mount) => {
        const ref = resolveVolumeRef(mount.volume);
        const volume = ref.id ?? ref.name;
        if (!volume) throw new Error('A Groundbox volume mount needs the volume id or name');
        return { volume, path: mount.mountPath, read_only: mount.readOnly ?? false };
      })
    : options.volumes;
  const metadata = toMetadata(options.metadata, options.name);
  // Only fields that were given are sent: an omitted size is the API's default (2 vCPU, 4 GB).
  const spec: CreateSandboxRequest = {
    cpus: options.cpus,
    memory_gb: options.memory_gb,
    disk_gb: options.disk_gb,
    timeout_minutes: options.timeout === undefined ? undefined : toMinutes(options.timeout),
    env: options.envs,
    metadata,
    template: options.templateId,
    image: options.image,
    snapshot_id: options.snapshotId,
    volumes,
    allow_hosts: options.allow_hosts,
    deny_hosts: options.deny_hosts,
    on_timeout: options.on_timeout,
    secrets: options.secrets,
    env_from_secrets: options.env_from_secrets,
    flex: options.flex,
    desktop: options.desktop,
  };
  // Commands run as root unless the caller asks for the image's own user. A sandbox started
  // from a snapshot keeps the user of the sandbox the snapshot was taken from.
  const user = (options as { user?: 'root' | 'runner' }).user;
  if (user !== undefined || options.snapshotId === undefined) (spec as { user?: string }).user = user ?? 'root';
  for (const key of Object.keys(spec) as (keyof CreateSandboxRequest)[]) if (spec[key] === undefined) delete spec[key];
  return spec;
}

function toStatus(status: Sandbox['status']): InstanceInfo['status'] {
  if (status === 'failed') return 'error';
  if (status === 'queued' || status === 'starting' || status === 'running' || status === 'resuming') return 'running';
  return 'stopped';
}

/**
 * Poll until the sandbox is in `wanted`. A sandbox that is ending or shutting down meanwhile is
 * an error, and so is an abort of `signal`.
 */
async function waitForStatus(
  instance: GroundboxInstance,
  first: Sandbox,
  wanted: Sandbox['status'],
  { waitMs = STATE_WAIT_MS, everyMs = 500, signal }: { waitMs?: number; everyMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const deadline = Date.now() + waitMs;
  let sandbox = first;
  while (sandbox.status !== wanted) {
    if (NOT_COMING_STATUSES.includes(sandbox.status)) {
      const why = sandbox.error ?? sandbox.stop_reason;
      throw new Error(`Groundbox sandbox ${instance.id} is ${sandbox.status}${why ? ` (${why})` : ''}`);
    }
    if (Date.now() > deadline) throw new Error(`Groundbox sandbox ${instance.id} is still ${sandbox.status} after ${waitMs / 1000} s`);
    await sleep(everyMs, signal);
    sandbox = await instance.client.get_sandbox(instance.id, signal ? { signal } : {});
  }
}

/** A command timeout in whole seconds, rounded up, within what the API takes. */
function toTimeoutS(ms: number | undefined, max = MAX_COMMAND_TIMEOUT_S): number {
  if (ms === undefined) return DEFAULT_COMMAND_TIMEOUT_S;
  return Math.min(Math.max(Math.ceil(ms / 1000), 1), max);
}

/** A command killed at its timeout is never reported as a success. */
const exitCode = (result: { exit_code: number; timed_out?: boolean }) => (result.timed_out && result.exit_code === 0 ? 124 : result.exit_code);

async function runCommand(instance: GroundboxInstance, command: string, options: RunCommandOptions = {}): Promise<CommandResult> {
  const started = Date.now();
  if (options.background) {
    // Started with nobody waiting for it: the call answers as soon as the command runs.
    await instance.client.start_command(instance.id, command, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: options.env } : {}),
      ...(options.timeout === undefined ? {} : { timeout_s: toTimeoutS(options.timeout, MAX_PROCESS_TIMEOUT_S) }),
    });
    return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - started };
  }
  const result = await instance.client.run_command(instance.id, command, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    timeout_s: toTimeoutS(options.timeout),
  });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: exitCode(result), durationMs: Date.now() - started };
}

/** Live output over the exec stream: chunks arrive while the command runs. */
async function streamCommand(instance: GroundboxInstance, command: string, options: RunCommandOptions): Promise<CommandResult> {
  if (options.background) return runCommand(instance, command, options);
  const started = Date.now();
  let stdout = '';
  let stderr = '';
  const stream = instance.client.stream_command(
    instance.id,
    command,
    {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: options.env } : {}),
      timeout_s: toTimeoutS(options.timeout),
    },
    {
      onStdout: (text) => {
        stdout += text;
        options.onStdout?.(text);
      },
      onStderr: (text) => {
        stderr += text;
        options.onStderr?.(text);
      },
    },
  );
  const result = await stream.done;
  return { stdout, stderr, exitCode: exitCode(result), durationMs: Date.now() - started };
}

/**
 * A long-running process on the exec stream, started resumable: it runs on in the sandbox
 * if the connection drops, and the stream reconnects and reads on. It ends when it exits,
 * when it is killed, or with the sandbox (its timeout is the longest a sandbox lives, 30 days).
 */
async function startProcess(instance: GroundboxInstance, command: string, options: StartProcessOptions): Promise<ProcessHandle> {
  const started = Date.now();
  let stdout = '';
  let stderr = '';
  let killedWith: string | null = null;
  let ended: { exitCode: number; signal: string | null } | undefined;
  const stream = instance.client.stream_command(
    instance.id,
    command,
    {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: options.env } : {}),
      timeout_s: MAX_PROCESS_TIMEOUT_S,
      stdin: options.stdin ?? false,
      resumable: true,
    },
    {
      onStdout: (text) => {
        stdout += text;
        options.onStdout?.(text);
      },
      onStderr: (text) => {
        stderr += text;
        options.onStderr?.(text);
      },
    },
  );
  const done = stream.done.then((result) => {
    // The stream reports an exit code only: the signal is the one this handle sent, if it sent one.
    ended = { exitCode: exitCode(result), signal: result.exit_code === 0 ? null : killedWith };
    options.onExit?.({ exitCode: ended.exitCode, signal: ended.signal });
    return ended;
  });
  // A stream that fails is reported by wait(); it must not be an unhandled rejection meanwhile.
  done.catch(() => {});
  // The command's id arrives with the stream's first message.
  const deadline = Date.now() + 30_000;
  while (stream.exec_id === undefined && ended === undefined && Date.now() < deadline) {
    const failed = await Promise.race([done.then(() => false, () => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), 20))]);
    if (failed) await done;
  }
  if (stream.exec_id === undefined && ended === undefined) {
    stream.kill();
    throw new Error(`Groundbox did not start the process within 30 s: ${command}`);
  }
  const jobId = stream.exec_id ?? `ended-${started}`;
  const status = (): ProcessStatus => ({ status: ended ? 'exited' : 'running', exitCode: ended?.exitCode ?? null, signal: ended?.signal ?? null, stdout, stderr });
  return {
    pid: null,
    jobId,
    runtime: 'native',
    write: async (data) => {
      if (!options.stdin) throw new Error('The process was not started with stdin: true');
      if (ended) throw new Error('The process has exited');
      // Text or bytes, sent as they are.
      stream.write(data);
    },
    closeStdin: async () => {
      if (options.stdin && !ended) stream.end();
    },
    status: async () => status(),
    wait: async (waitOptions) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        if (waitOptions?.timeout !== undefined) timer = setTimeout(() => reject(new Error(`Process ${jobId} did not exit within ${waitOptions.timeout} ms`)), waitOptions.timeout);
      });
      try {
        const result = await Promise.race([done, timeout]);
        return { stdout, stderr, exitCode: result.exitCode, signal: result.signal, durationMs: Date.now() - started };
      } finally {
        clearTimeout(timer);
      }
    },
    kill: async (signal = 'SIGKILL') => {
      const known = COMMAND_SIGNALS.find((each) => each === signal);
      if (!known) throw new Error(`Groundbox sends ${COMMAND_SIGNALS.join(', ')} to a process; "${signal}" is not one of them`);
      if (ended) return;
      killedWith = known;
      try {
        // The signal goes to the command and everything it started.
        await instance.client.kill_command(instance.id, jobId, known);
      } catch (error) {
        // A kill that failed sent no signal: an exit after it is not reported with one.
        killedWith = null;
        // The process may have exited while the kill was on its way (the API then answers 404
        // or 409): its stream says so a moment later, and a process that is gone is killed.
        if (!ended && error instanceof GroundboxError && (error.code === 'not_found' || error.code === 'conflict')) {
          await Promise.race([done.catch(() => undefined), sleep(1000)]);
        }
        if (ended) return;
        throw error;
      }
    },
  };
}

function toSnapshot(snapshot: NativeSnapshot): GroundboxSnapshot {
  return {
    id: snapshot.id,
    provider: 'groundbox',
    createdAt: new Date(snapshot.created_at),
    status: snapshot.status,
    sourceInstanceId: snapshot.source_sandbox_id,
    ...(snapshot.label ? { name: snapshot.label } : {}),
    metadata: {
      cpus: snapshot.cpus,
      memoryGb: snapshot.memory_gb,
      diskGb: snapshot.disk_gb,
      memory: snapshot.memory,
      sizeBytes: snapshot.size_bytes,
      expiresAt: snapshot.expires_at,
    },
    native: snapshot,
  };
}

function toVolume(volume: NativeVolume): GroundboxVolume {
  return { id: volume.id, ...(volume.name ? { name: volume.name } : {}), sizeGb: volume.size_gb, status: volume.status, native: volume };
}

/** Every item of a list endpoint that `keep` keeps, through every page, or the first `limit` of them. */
async function pages<T>(
  read: (query: { limit: number; cursor?: string }) => Promise<{ data: T[]; next_cursor: string | null }>,
  limit?: number,
  keep: (item: T) => boolean = () => true,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await read({ limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
    items.push(...page.data.filter(keep));
    cursor = page.next_cursor ?? undefined;
  } while (cursor && (limit === undefined || items.length < limit));
  return limit === undefined ? items : items.slice(0, limit);
}

/** A volume being deleted or already deleted is not one any more. */
const isLiveVolume = (volume: NativeVolume) => volume.status !== 'deleting' && volume.status !== 'deleted';

/**
 * Create a Groundbox provider instance using the factory pattern.
 */
export const groundbox = defineProvider<GroundboxInstance, GroundboxConfig, Template, GroundboxSnapshot, GroundboxVolume>({
  name: 'groundbox',
  // Each standard size is asked for exactly, as cpus and memory_gb. Local: no API call is made.
  sizes: (_config, profile, options) => {
    if (options?.memory_gb !== undefined) throw new InstanceSizeError('conflict', 'cannot combine sizeClass with memory_gb');
    const memoryGb = profile.memoryMiB / 1024;
    if (profile.vcpus > MAX_VCPUS) {
      return { status: 'unsupported', reason: `Groundbox sandboxes have at most ${MAX_VCPUS} vCPUs; ${profile.sizeClass} has ${profile.vcpus}.` };
    }
    if (profile.vcpus > VERIFIED_MAX_VCPUS) {
      return {
        status: 'unknown',
        reason:
          `Groundbox takes up to ${MAX_VCPUS} vCPUs, but only sizes up to ${VERIFIED_MAX_VCPUS} vCPUs (xl) have been booted and checked through this adapter. ` +
          `For ${profile.sizeClass}, pass cpus and memory_gb instead of sizeClass.`,
      };
    }
    if (!Number.isInteger(memoryGb) || memoryGb > profile.vcpus * MAX_MEMORY_GB_PER_VCPU) {
      return {
        status: 'unsupported',
        reason: `Groundbox memory is a whole number of GB, at most ${MAX_MEMORY_GB_PER_VCPU} GB per vCPU; ${profile.sizeClass} does not fit.`,
      };
    }
    return { status: 'supported', nativeOptions: { cpus: profile.vcpus, memory_gb: memoryGb } };
  },
  methods: {
    instances: {
      create: async (config, options = {}) => {
        const client = clientFor(config);
        const signal: AbortSignal | undefined = options.signal;
        const sandbox = await client.create_sandbox(toSpec(options), signal ? { signal } : {});
        const instance = { id: sandbox.id, client };
        // The first sandbox from an image is queued while the image is turned into a disk; one
        // from a snapshot may still be restoring. A flex sandbox waits for room: it is not waited for.
        // An abort while waiting deletes the sandbox, like any other failure here.
        if (sandbox.status !== 'running' && !options.flex) {
          try {
            await waitForStatus(instance, sandbox, 'running', { waitMs: options.image !== undefined ? IMAGE_WAIT_MS : STATE_WAIT_MS, everyMs: 2000, signal });
          } catch (error) {
            await client.delete_sandbox(sandbox.id).catch(() => {});
            throw error;
          }
        }
        return { instance, instanceId: sandbox.id };
      },

      getById: async (config, instanceId) => {
        const client = clientFor(config);
        try {
          const sandbox = await client.get_sandbox(instanceId);
          // A deleted sandbox is still readable for its record; it is not an instance any more.
          if (sandbox.status === 'stopped' || sandbox.status === 'failed') return null;
          return { instance: { id: sandbox.id, client }, instanceId: sandbox.id };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },

      list: async (config) => {
        const client = clientFor(config);
        // Every sandbox that is not over (stopped or failed), in one filtered listing.
        const live = await pages((query) => client.list_sandboxes({ ...query, live: true }));
        return live.map((sandbox) => ({ instance: { id: sandbox.id, client }, instanceId: sandbox.id }));
      },

      destroy: async (config, instanceId) => {
        try {
          await clientFor(config).delete_sandbox(instanceId);
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      },

      runCommand,
      streamCommand,
      startProcess,

      getInfo: async (instance) => {
        const sandbox = await instance.client.get_sandbox(instance.id);
        return {
          id: sandbox.id,
          provider: 'groundbox',
          status: toStatus(sandbox.status),
          createdAt: new Date(sandbox.created_at),
          timeout: sandbox.timeout_minutes * 60_000,
          metadata: {
            // The adapter's own key is written last, so a user label named `groundbox` cannot hide it.
            ...sandbox.metadata,
            groundbox: {
              status: sandbox.status,
              cpus: sandbox.cpus,
              memoryGb: sandbox.memory_gb,
              diskGb: sandbox.disk_gb,
              // What the VM itself reported once it booted; null until it has.
              booted: sandbox.booted ? { cpus: sandbox.booted.cpus, memoryMiB: sandbox.booted.memory_mb } : null,
              expiresAt: sandbox.expires_at,
            },
          },
        };
      },

      getUrl: async (instance, { port, protocol }) => {
        const scheme = protocol ?? 'https';
        if (!['http', 'https', 'ws', 'wss'].includes(scheme)) {
          throw new Error(`Groundbox previews serve HTTPS and WebSockets; "${scheme}" is not supported`);
        }
        const preview = await instance.client.expose_port(instance.id, port, previewModes.get(instance.client) === 'public' ? { public: true } : {});
        // A private preview is returned as its share link; the plain URL asks for the dashboard sign-in.
        const url = preview.share_url ?? preview.url.replace(/\/$/, '');
        return scheme === 'ws' || scheme === 'wss' ? url.replace(/^https:/, 'wss:') : url;
      },

      pause: async (instance) => {
        await waitForStatus(instance, await instance.client.pause_sandbox(instance.id), 'paused');
      },
      resume: async (instance) => {
        await waitForStatus(instance, await instance.client.resume_sandbox(instance.id), 'running');
      },
      // A paused sandbox keeps its memory and disk: processes are running again after resume.
      pauseCapabilities: { memory: true },

      lifetime: { defaultMs: DEFAULT_LIFETIME_MINUTES * 60_000, maxMs: MAX_LIFETIME_MINUTES * 60_000 },
      extendLifetime: async (instance, ms) => {
        await instance.client.update_sandbox(instance.id, { timeout_minutes: toMinutes(ms) });
      },

      getInstance: (instance) => instance,

      filesystem: {
        readFile: async (instance, path) => instance.client.read_text_file(instance.id, path),

        // Parent folders are made by the API.
        writeFile: async (instance, path, content) => {
          await instance.client.write_file(instance.id, path, content);
        },

        mkdir: async (instance, path) => {
          await instance.client.make_dir(instance.id, path);
        },

        readdir: async (instance, path): Promise<FileEntry[]> => {
          const listing = await instance.client.list_files(instance.id, path);
          return listing.entries.map((entry) => ({
            name: entry.name,
            // FileEntry has two types: a symlink or a device is listed as a file.
            type: entry.type === 'dir' ? ('directory' as const) : ('file' as const),
            size: entry.size_bytes,
            modified: new Date(entry.modified_at),
          }));
        },

        exists: async (instance, path) => {
          try {
            await instance.client.stat_file(instance.id, path);
            return true;
          } catch (error) {
            if (!isNotFound(error)) throw error;
            // A missing sandbox is a 404 too, with the same code: the path is "not there" only
            // when the sandbox is. A sandbox that is gone fails here, or below.
            const sandbox = await instance.client.get_sandbox(instance.id);
            if (sandbox.status === 'stopped' || sandbox.status === 'failed') throw error;
            return false;
          }
        },

        remove: async (instance, path) => {
          await instance.client.delete_file(instance.id, path, { recursive: true });
        },
      },
    },

    // Kept snapshots: a moment of a running sandbox (memory, processes and disk) that outlives
    // it. The source keeps running; any number of sandboxes start from one snapshot.
    snapshot: {
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false, source: 'kept', fork: true, readiness: 'eventual' },

      // Groundbox snapshots have a label and no metadata: `name` is the label, metadata is not sent.
      // A running sandbox's memory is always kept with it, so `scope` changes nothing.
      // Answers at once, maybe while the snapshot is still being made (readiness: 'eventual').
      create: async (config, instanceId, options?: CreateSnapshotOptions) => {
        const body = { sandbox_id: instanceId, ...(options?.name ? { label: options.name } : {}) };
        return toSnapshot(await clientFor(config).keep_snapshot(body, { wait: false }));
      },

      list: async (config, options?: ListSnapshotsOptions) => {
        const client = clientFor(config);
        const sandboxId = options?.instanceId ?? options?.sandboxId;
        // Deleted snapshots are left out before `limit` counts.
        const snapshots = await pages(
          (query) => client.list_snapshots({ ...query, ...(sandboxId ? { sandbox_id: sandboxId } : {}) }),
          options?.limit,
          (snapshot) => snapshot.status !== 'deleted',
        );
        return snapshots.map(toSnapshot);
      },

      // A snapshot that is already gone is deleted; one still being made is retried for a minute.
      delete: async (config, snapshotId) => {
        const client = clientFor(config);
        const deadline = Date.now() + SNAPSHOT_DELETE_RETRY_MS;
        for (;;) {
          try {
            await client.delete_snapshot(snapshotId);
            return;
          } catch (error) {
            if (isNotFound(error)) return;
            if (!(error instanceof GroundboxError && error.code === 'conflict') || Date.now() > deadline) throw error;
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      },

      waitUntilReady: async (config, snapshotId, options) => {
        const client = clientFor(config);
        const waitMs = options?.timeoutMs ?? SNAPSHOT_WAIT_MS;
        const deadline = Date.now() + waitMs;
        for (;;) {
          const snapshot = await client.get_snapshot(snapshotId);
          if (snapshot.status === 'ready') return;
          if (snapshot.status !== 'creating') throw new Error(`Groundbox snapshot ${snapshotId} is ${snapshot.status}${snapshot.error ? ` (${snapshot.error})` : ''}`);
          if (Date.now() > deadline) throw new Error(`Groundbox snapshot ${snapshotId} is still being made after ${waitMs / 1000} s`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      },
    },

    template: {
      // The first version starts building at once: the template can be used once its status is `ready`.
      create: async (config, options: CreateTemplateOptions) => {
        // Groundbox templates have no description or metadata: neither is sent.
        const body: Record<string, unknown> = { ...(options as GroundboxCreateTemplateOptions) };
        delete body.description;
        delete body.metadata;
        return clientFor(config).create_template(body as CreateTemplateRequest);
      },
      list: async (config, options?: ListTemplatesOptions) => {
        const client = clientFor(config);
        return pages((query) => client.list_templates(query), options?.limit);
      },
      delete: async (config, templateId) => {
        await clientFor(config).delete_template(templateId);
      },
    },

    volume: {
      create: async (config, options: CreateVolumeOptions) => {
        // A volume made with no size gets DEFAULT_VOLUME_GB, so `volume.create({ name })` works as it does on other providers.
        const sizeGb = options.size_gb ?? options.sizeGb ?? (options.sizeBytes === undefined ? DEFAULT_VOLUME_GB : Math.ceil(options.sizeBytes / 2 ** 30));
        if (typeof sizeGb !== 'number' || !Number.isFinite(sizeGb) || sizeGb <= 0) throw new Error('A Groundbox volume size is a positive number: pass sizeBytes (rounded up to whole GB)');
        return toVolume(await clientFor(config).create_volume({ name: options.name, size_gb: sizeGb }));
      },
      get: async (config, volumeIdOrName) => {
        try {
          const volume = await clientFor(config).get_volume(volumeIdOrName);
          return isLiveVolume(volume) ? toVolume(volume) : null;
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },
      list: async (config, options?: ListVolumesOptions) => {
        const client = clientFor(config);
        return (await pages((query) => client.list_volumes(query), options?.limit, isLiveVolume)).map(toVolume);
      },
      delete: async (config, volumeIdOrName) => {
        await clientFor(config).delete_volume(volumeIdOrName);
      },
    },
  },
});
