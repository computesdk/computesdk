/**
 * boxd Provider - Factory-based Implementation
 *
 * Linux computers on boxd (https://boxd.sh): each one is its own microVM that boots
 * in milliseconds, keeps its disk until it is destroyed, and can be snapshotted and
 * restored. This package talks to boxd through the official `@boxd-sh/sdk`, which is
 * ESM-only, so the build bundles it (see tsup.config.ts).
 *
 * Every computer this provider creates is isolated: boxd removes the in-machine boxd
 * CLI, integrations, agent logins and the laptop bridge from it, which is what code
 * from a user or an agent should run in.
 */

import {
  AuthenticationError,
  Boxd,
  ConflictError,
  MachineFileExistsError,
  MachineFileNotFoundError,
  NotFoundError,
} from '@boxd-sh/sdk';
import type { Machine, MachineCreateParams, MachineConfig, Snapshot as BoxdSnapshot } from '@boxd-sh/sdk';
import { defineProvider, escapeShellArg, TIMEOUT_EXIT_CODE } from '@computesdk/provider';
import type {
  CommandResult,
  CreateInstanceOptions,
  CreateSnapshotOptions,
  FileEntry,
  InstanceInfo,
  ListSnapshotsOptions,
  RunCommandOptions,
} from '@computesdk/provider';
import type { Snapshot } from 'computesdk';

export interface BoxdConfig {
  /** boxd API key - if not provided, will fallback to BOXD_API_KEY environment variable */
  apiKey?: string;
  /** boxd session token, used instead of an API key - falls back to BOXD_TOKEN */
  token?: string;
  /** Org (name or id) to create and list computers in - falls back to BOXD_ORG. Empty means your personal computers. */
  org?: string;
  /** Region for computers and snapshots (e.g. `fra`, `nyc`) - falls back to BOXD_REGION, then the boxd default (Frankfurt) */
  region?: string;
  /** API endpoint - falls back to BOXD_BASE_URL, then boxd production */
  baseURL?: string;
  /** Per-request timeout for boxd API calls in milliseconds */
  timeout?: number;
  /** Seconds of inactivity before a computer is suspended. 0 (the boxd default) never suspends. */
  autoSuspendTimeout?: number;
}

/** A computer as this provider hands it out. */
export interface BoxdInstance {
  id: string;
  name: string;
  region?: string;
  org?: string;
  /** Environment variables from `create({ envs })`, exported in every command */
  envs: Record<string, string>;
  machine: Machine;
  client: Boxd;
}

/** The sizes boxd offers, as vCPUs and memory in GiB. */
const SIZES: ReadonlyArray<{ vcpu: number; memoryGiB: number }> = [
  { vcpu: 1, memoryGiB: 4 },
  { vcpu: 2, memoryGiB: 8 },
  { vcpu: 4, memoryGiB: 16 },
  { vcpu: 8, memoryGiB: 32 },
];
const SIZE_LIST = SIZES.map((s) => `${s.vcpu} vCPU / ${s.memoryGiB} GiB`).join(', ');
const LABEL = { computesdk: 'true' } as const;
const SNAPSHOT_READY_TIMEOUT_MS = 120_000;

interface ResolvedConfig {
  apiKey?: string;
  token?: string;
  org?: string;
  region?: string;
  baseURL?: string;
  timeout?: number;
  autoSuspendTimeout?: number;
}

const clients = new Map<string, Boxd>();

function resolveConfig(config: BoxdConfig): ResolvedConfig {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const apiKey = config.apiKey || env?.BOXD_API_KEY || undefined;
  const token = config.token || env?.BOXD_TOKEN || undefined;
  if (!apiKey && !token) {
    throw new Error(
      `Missing boxd API key. Provide 'apiKey' in config or set the BOXD_API_KEY environment variable. ` +
        `Create one with \`boxd auth keys create <name> --org <org>\` or in the console at https://app.boxd.sh`,
    );
  }
  return {
    apiKey,
    token,
    org: config.org || env?.BOXD_ORG || undefined,
    region: config.region || env?.BOXD_REGION || undefined,
    baseURL: config.baseURL || env?.BOXD_BASE_URL || undefined,
    timeout: config.timeout,
    autoSuspendTimeout: config.autoSuspendTimeout,
  };
}

// One client per credential set: it holds the session it exchanged the key for.
function clientFor(config: ResolvedConfig): Boxd {
  const key = JSON.stringify([config.apiKey, config.token, config.baseURL, config.region, config.timeout]);
  let client = clients.get(key);
  if (!client) {
    client = new Boxd({
      ...(config.token ? { token: config.token } : { apiKey: config.apiKey }),
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.region ? { region: config.region } : {}),
      ...(config.timeout ? { timeout: config.timeout } : {}),
    });
    clients.set(key, client);
  }
  return client;
}

function regionOpt(region?: string): { region?: string } {
  return region ? { region } : {};
}

function toInstance(client: Boxd, config: ResolvedConfig, machine: Machine, envs: Record<string, string> = {}): BoxdInstance {
  return {
    id: machine.id,
    name: machine.name,
    region: machine.region ?? config.region,
    org: config.org,
    envs,
    machine,
    client,
  };
}

function randomSuffix(): string {
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((v): v is number => typeof v === 'number' && v > 0);
}

/** Maps ComputeSDK's CPU and memory fields onto one of the four boxd sizes. */
function machineSize(options: CreateInstanceOptions): { vcpu: number; memory: string } | undefined {
  const vcpu = firstNumber(options.vcpus, options.cpu, options.cpus);
  const memoryMiB = firstNumber(options.memoryMiB, options.memMiB, options.memoryMb, options.memory);
  if (vcpu === undefined && memoryMiB === undefined) return undefined;
  const size = SIZES.find(
    (s) => (vcpu === undefined || s.vcpu === vcpu) && (memoryMiB === undefined || s.memoryGiB * 1024 === memoryMiB),
  );
  if (!size) {
    const asked = [vcpu !== undefined ? `${vcpu} vCPU` : '', memoryMiB !== undefined ? `${memoryMiB} MiB` : '']
      .filter(Boolean)
      .join(' / ');
    throw new Error(`boxd has no size for ${asked}. Pick one of: ${SIZE_LIST} (memory in MiB, e.g. 8192).`);
  }
  return { vcpu: size.vcpu, memory: `${size.memoryGiB}G` };
}

function createParams(config: ResolvedConfig, options: CreateInstanceOptions): MachineCreateParams {
  if (options.image) {
    throw new Error(
      `boxd computers boot from the boxd base image (Ubuntu 24.04 with Docker, Node, Python and Go). ` +
        `Set up a computer once, snapshot it, and pass its id as 'snapshotId' instead of 'image'.`,
    );
  }
  if (Array.isArray(options.volumes) && options.volumes.length > 0) {
    throw new Error('boxd provider does not support volumes yet.');
  }

  const fromSnapshot = options.snapshotId ?? options.templateId;
  const size = machineSize(options);
  if (fromSnapshot && size) {
    throw new Error('A boxd computer created from a snapshot keeps the snapshot\'s size, so vcpus/memory cannot be set with it.');
  }

  const machineConfig: MachineConfig = {
    ...(size ?? {}),
    ...(config.autoSuspendTimeout !== undefined ? { autoSuspendTimeout: config.autoSuspendTimeout } : {}),
  };
  const common = {
    name: options.name || `computesdk-${randomSuffix()}`,
    ...(config.org ? { org: config.org } : {}),
    ...regionOpt(typeof options.region === 'string' ? options.region : config.region),
    isolated: true,
    labels: { ...LABEL },
    ...(typeof options.timeout === 'number' && options.timeout > 0 ? { deleteAfter: Math.ceil(options.timeout / 1000) } : {}),
    ...(Object.keys(machineConfig).length > 0 ? { config: machineConfig } : {}),
  };
  return fromSnapshot ? { ...common, fromSnapshot } : common;
}

function isStopped(err: unknown): boolean {
  return err instanceof ConflictError && /is stopped/i.test(err.message);
}

function isExecTimeout(err: unknown): boolean {
  return err instanceof Error && /timed out/i.test(err.message);
}

async function startMachine(instance: BoxdInstance): Promise<void> {
  await instance.client.machines.start(instance.id, regionOpt(instance.region));
  await instance.client.machines.waitUntilReady(instance.id, regionOpt(instance.region));
}

// A stopped computer does not wake on its own, unlike a suspended or hibernated one.
async function withStart<T>(instance: BoxdInstance, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isStopped(err)) throw err;
    await startMachine(instance);
    return await fn();
  }
}

function shellCommand(instance: BoxdInstance, command: string, options?: RunCommandOptions): string {
  let cmd = command;
  const env = { ...instance.envs, ...(options?.env ?? {}) };
  const keys = Object.keys(env);
  if (keys.length > 0) {
    const exports = keys.map((key) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
      return `export ${key}="${escapeShellArg(env[key])}"`;
    });
    cmd = `${exports.join(' && ')} && ${cmd}`;
  }
  if (options?.background) cmd = `nohup sh -c "${escapeShellArg(cmd)}" >/dev/null 2>&1 &`;
  return cmd;
}

function infoStatus(status: string): InstanceInfo['status'] {
  if (status === 'failed') return 'error';
  if (status === 'stopped' || status === 'destroyed') return 'stopped';
  return 'running';
}

function toSnapshot(snapshot: BoxdSnapshot): Snapshot {
  return {
    id: snapshot.id,
    provider: 'boxd',
    createdAt: snapshot.createdAt ?? new Date(),
    metadata: {
      name: snapshot.name,
      status: snapshot.status,
      sizeBytes: snapshot.sizeBytes,
      vcpu: snapshot.vcpu,
      memoryBytes: snapshot.memoryBytes,
      region: snapshot.region,
    },
  };
}

async function streamOutput(
  queue: AsyncIterable<Uint8Array>,
  onChunk: ((data: string) => void) | undefined,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  const emit = (chunk: string) => {
    if (!chunk) return;
    text += chunk;
    onChunk?.(chunk);
  };
  try {
    for await (const bytes of queue) emit(decoder.decode(bytes, { stream: true }));
  } catch {
    // The queue fails when the stream is closed; what arrived before that is kept.
  }
  emit(decoder.decode());
  return text;
}

async function streamOnce(instance: BoxdInstance, command: string, options: RunCommandOptions): Promise<CommandResult> {
  const start = Date.now();
  const stream = instance.client.machines.streamExec(instance.id, {
    command: shellCommand(instance, command, options),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    closeStdin: true,
    ...regionOpt(instance.region),
  });
  let timedOut = false;
  const timer = options.timeout
    ? setTimeout(() => {
        timedOut = true;
        stream.close();
      }, options.timeout)
    : undefined;
  const stdoutPromise = streamOutput(stream.stdout, options.onStdout);
  const stderrPromise = streamOutput(stream.stderr, options.onStderr);
  let exitCode: number;
  try {
    exitCode = await stream.wait();
  } catch (err) {
    if (!timedOut) {
      stream.close();
      throw err;
    }
    exitCode = TIMEOUT_EXIT_CODE;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { stdout, stderr, exitCode: timedOut ? TIMEOUT_EXIT_CODE : exitCode, durationMs: Date.now() - start };
}

export const boxd = defineProvider<BoxdInstance, BoxdConfig, unknown, Snapshot>({
  name: 'boxd',
  // boxd gives every vCPU 4 GiB of memory and the standard classes give 1 or 2, so no
  // class is an exact match and the resolver says so instead of rounding.
  sizes: () => ({
    status: 'unsupported',
    reason: `boxd computers come in ${SIZE_LIST}; none equals a standard size class. Pass vcpus or memoryMiB instead.`,
  }),
  methods: {
    instances: {
      create: async (config: BoxdConfig, options: CreateInstanceOptions = {}) => {
        const resolved = resolveConfig(config);
        const client = clientFor(resolved);
        let machine: Machine;
        try {
          machine = await client.machines.create(createParams(resolved, options));
        } catch (err) {
          if (err instanceof AuthenticationError) {
            throw new Error(`boxd rejected the credentials (${err.message}). Check BOXD_API_KEY and that BOXD_ORG is the org the key belongs to.`);
          }
          throw err;
        }
        const instance = toInstance(client, resolved, machine, options.envs ?? {});
        // create returns before the computer takes commands; waitUntilReady covers the gap.
        try {
          instance.machine = await client.machines.waitUntilReady(machine.id, regionOpt(instance.region));
        } catch (err) {
          await client.machines.delete(machine.id, regionOpt(instance.region)).catch(() => undefined);
          throw err;
        }
        return { instance, instanceId: machine.id };
      },

      getById: async (config: BoxdConfig, instanceId: string) => {
        const resolved = resolveConfig(config);
        const client = clientFor(resolved);
        try {
          const machine = await client.machines.get(instanceId, regionOpt(resolved.region));
          return { instance: toInstance(client, resolved, machine), instanceId: machine.id };
        } catch (err) {
          if (err instanceof NotFoundError) return null;
          throw err;
        }
      },

      // Only the computers this provider created, which carry the computesdk label.
      list: async (config: BoxdConfig) => {
        const resolved = resolveConfig(config);
        const client = clientFor(resolved);
        const machines = await client.machines.list({
          ...(resolved.org ? { org: resolved.org } : {}),
          ...regionOpt(resolved.region),
          labels: { ...LABEL },
        });
        return machines.map((machine) => ({ instance: toInstance(client, resolved, machine), instanceId: machine.id }));
      },

      destroy: async (config: BoxdConfig, instanceId: string) => {
        const resolved = resolveConfig(config);
        try {
          await clientFor(resolved).machines.delete(instanceId, regionOpt(resolved.region));
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err;
        }
      },

      runCommand: async (instance: BoxdInstance, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const start = Date.now();
        try {
          const result = await withStart(instance, () =>
            instance.client.machines.exec(instance.id, {
              command: shellCommand(instance, command, options),
              ...(options?.cwd ? { cwd: options.cwd } : {}),
              ...(options?.timeout ? { timeout: options.timeout } : {}),
              ...regionOpt(instance.region),
            }),
          );
          return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, durationMs: Date.now() - start };
        } catch (err) {
          // boxd kills the command when the timeout elapses; report it the way `timeout(1)` does.
          if (options?.timeout && isExecTimeout(err)) {
            return { stdout: '', stderr: (err as Error).message, exitCode: TIMEOUT_EXIT_CODE, durationMs: Date.now() - start };
          }
          throw err;
        }
      },

      // Output arrives over boxd's own exec stream, so no port has to be exposed for it.
      streamCommand: async (instance: BoxdInstance, command: string, options: RunCommandOptions): Promise<CommandResult> => {
        let delivered = false;
        const tracked: RunCommandOptions = {
          ...options,
          onStdout: (data) => {
            delivered = true;
            options.onStdout?.(data);
          },
          onStderr: (data) => {
            delivered = true;
            options.onStderr?.(data);
          },
        };
        try {
          return await streamOnce(instance, command, tracked);
        } catch (err) {
          if (delivered || !isStopped(err)) throw err;
          await startMachine(instance);
          return await streamOnce(instance, command, options);
        }
      },

      getInfo: async (instance: BoxdInstance): Promise<InstanceInfo> => {
        let machine: Machine | undefined;
        try {
          machine = await instance.client.machines.get(instance.id, regionOpt(instance.region));
          instance.machine = machine;
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err;
        }
        const current = machine ?? instance.machine;
        return {
          id: instance.id,
          provider: 'boxd',
          status: machine ? infoStatus(machine.status) : 'stopped',
          createdAt: current.createdAt ?? new Date(0),
          timeout: current.deleteAt ? Math.max(0, current.deleteAt.getTime() - Date.now()) : 0,
          metadata: {
            name: current.name,
            status: machine ? machine.status : 'destroyed',
            region: current.region,
            org: current.org?.name,
            resources: current.resources,
            bootTimeMs: current.bootTimeMs,
            labels: current.labels,
          },
        };
      },

      // A named proxy per port: https://p<port>.<computer>.boxd.sh. The computer's default
      // domain sits behind bot protection, so it is not handed out. A new name gets its TLS
      // certificate within about 15 seconds of being created.
      getUrl: async (instance: BoxdInstance, options: { port: number; protocol?: string }): Promise<string> => {
        const proxies = instance.client.machines.proxies;
        const region = regionOpt(instance.region);
        const findDomain = async () =>
          (await proxies.list(instance.id, region)).find((p) => p.name && !p.isDefault && p.port === options.port)?.domain;
        let domain = await findDomain();
        if (!domain) {
          const created = await proxies.create(instance.id, `p${options.port}`, options.port, region);
          domain = (await findDomain()) ?? `${created.name}.${instance.name}.boxd.sh`;
        }
        const scheme = options.protocol === 'ws' || options.protocol === 'wss' ? 'wss' : 'https';
        return `${scheme}://${domain}`;
      },

      getInstance: (instance: BoxdInstance): BoxdInstance => instance,

      // boxd's file API, so no shell is involved. Files are written as the computer's user, `boxd`.
      filesystem: {
        readFile: async (instance: BoxdInstance, path: string): Promise<string> => {
          const bytes = await withStart(instance, () => instance.client.machines.fs.read(instance.id, path, regionOpt(instance.region)));
          return new TextDecoder().decode(bytes);
        },
        writeFile: async (instance: BoxdInstance, path: string, content: string): Promise<void> => {
          await withStart(instance, () => instance.client.machines.fs.write(instance.id, path, content, regionOpt(instance.region)));
        },
        mkdir: async (instance: BoxdInstance, path: string): Promise<void> => {
          try {
            await withStart(instance, () => instance.client.machines.fs.mkdir(instance.id, path, regionOpt(instance.region)));
          } catch (err) {
            if (!(err instanceof MachineFileExistsError)) throw err;
            const stat = await instance.client.machines.fs.stat(instance.id, path, regionOpt(instance.region));
            if (!stat.isDir) throw err;
          }
        },
        readdir: async (instance: BoxdInstance, path: string): Promise<FileEntry[]> => {
          const entries = await withStart(instance, () => instance.client.machines.fs.list(instance.id, path, regionOpt(instance.region)));
          return entries.map((entry) => ({
            name: entry.name,
            type: entry.isDir ? ('directory' as const) : ('file' as const),
            size: entry.size,
            modified: entry.mtime,
          }));
        },
        exists: async (instance: BoxdInstance, path: string): Promise<boolean> => {
          return withStart(instance, () => instance.client.machines.fs.exists(instance.id, path, regionOpt(instance.region)));
        },
        remove: async (instance: BoxdInstance, path: string): Promise<void> => {
          try {
            await withStart(instance, () =>
              instance.client.machines.fs.remove(instance.id, path, { recursive: true, ...regionOpt(instance.region) }),
            );
          } catch (err) {
            if (!(err instanceof MachineFileNotFoundError)) throw err;
          }
        },
      },
    },

    // A snapshot is the computer's disk and memory, captured once. Create a computer from
    // it with `create({ snapshotId })`; it starts as it was captured, already running.
    snapshot: {
      create: async (config: BoxdConfig, instanceId: string, options?: CreateSnapshotOptions): Promise<Snapshot> => {
        const resolved = resolveConfig(config);
        const client = clientFor(resolved);
        const name = options?.name || `computesdk-snap-${randomSuffix()}`;
        const lookup = { ...(resolved.org ? { org: resolved.org } : {}), ...regionOpt(resolved.region) };
        const created = await client.snapshots.create(instanceId, name, regionOpt(resolved.region));
        const deadline = Date.now() + SNAPSHOT_READY_TIMEOUT_MS;
        let snapshot = await client.snapshots.get(created.name, lookup);
        while (snapshot.status === 'pending' && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          snapshot = await client.snapshots.get(created.name, lookup);
        }
        if (snapshot.status !== 'ready') {
          throw new Error(`boxd snapshot ${name} is ${snapshot.status} instead of ready`);
        }
        return toSnapshot(snapshot);
      },

      // boxd snapshots are not tied to a computer once taken, so `instanceId` does not filter.
      list: async (config: BoxdConfig, options?: ListSnapshotsOptions): Promise<Snapshot[]> => {
        const resolved = resolveConfig(config);
        const snapshots = await clientFor(resolved).snapshots.list({
          ...(resolved.org ? { org: resolved.org } : {}),
          ...regionOpt(resolved.region),
        });
        const all = snapshots.map(toSnapshot);
        return options?.limit ? all.slice(0, options.limit) : all;
      },

      delete: async (config: BoxdConfig, snapshotId: string): Promise<void> => {
        const resolved = resolveConfig(config);
        try {
          await clientFor(resolved).snapshots.delete(snapshotId, {
            ...(resolved.org ? { org: resolved.org } : {}),
            ...regionOpt(resolved.region),
          });
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err;
        }
      },
    },
  },
});

export default boxd;
