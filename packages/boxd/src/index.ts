/**
 * boxd provider for ComputeSDK.
 *
 * Every sandbox is a boxd machine (a KVM microVM), created with `isolated: true`
 * so it is cut off from the rest of the organization's machines. Lifecycle,
 * commands, files, port URLs, snapshots and disks go through the official
 * `@boxd-sh/sdk`.
 */

import { randomUUID } from 'node:crypto';
import { Boxd, ConflictError, NotFoundError } from '@boxd-sh/sdk';
import type { Disk, ExecStream, Machine, MachineConfig, MachineCreateParams, Snapshot } from '@boxd-sh/sdk';
import { defineProvider, escapeShellArg, isUnifiedVolumeMounts, resolveVolumeRef } from '@computesdk/provider';
import type {
  CommandResult,
  CreateInstanceOptions,
  CreateSnapshotOptions,
  FileEntry,
  InstanceInfo,
  ListSnapshotsOptions,
  ProcessHandle,
  RunCommandOptions,
  StartProcessOptions,
} from '@computesdk/provider';
import type { Volume } from 'computesdk';

export interface BoxdConfig {
  /** boxd API key - if not provided, will use the BOXD_API_KEY environment variable */
  apiKey?: string;
  /** Region for new machines (`fra` or `nyc`) - falls back to BOXD_REGION, then the SDK default (Frankfurt) */
  region?: string;
}

export interface BoxdSandbox {
  client: Boxd;
  machine: Machine;
}

export interface BoxdSnapshot {
  /** boxd snapshot name, accepted by `create({ snapshotId })` and `snapshot.delete` */
  id: string;
  provider: 'boxd';
  createdAt: Date;
  metadata?: Record<string, any>;
}

export interface BoxdVolume extends Volume {
  id: string;
  name: string;
  sizeBytes: number;
  native: Disk | { id: string; name: string; sizeBytes: number; status: string };
}

/** boxd size classes: vCPU → memory. A request names one dimension and boxd picks the class. */
const BOXD_SIZES: Record<number, string> = { 1: '4G', 2: '8G', 4: '16G', 8: '32G' };
const DEFAULT_SNAPSHOT_TIMEOUT_MS = 300_000;
const DEFAULT_DISK_SIZE = '10G';

function createClient(config: BoxdConfig): Boxd {
  const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env?.BOXD_API_KEY : undefined);
  if (!apiKey) {
    throw new Error(
      'Missing boxd API key.\n\n' +
      'Create one in the boxd console (https://app.boxd.sh) or with `boxd auth keys create <name>`.\n' +
      'Then pass it: boxd({ apiKey: "bxd_..." })\n' +
      'Or set BOXD_API_KEY in your environment.'
    );
  }
  const region = config.region ?? (typeof process !== 'undefined' ? process.env?.BOXD_REGION : undefined);
  return new Boxd({ apiKey, region });
}

function withEnv(command: string, env?: Record<string, string>): string {
  if (!env || Object.keys(env).length === 0) return command;
  const exports = Object.entries(env).map(([key, value]) => {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
    return `export ${key}="${escapeShellArg(String(value))}"`;
  });
  return `${exports.join('; ')}; ${command}`;
}

function buildCommand(command: string, options?: RunCommandOptions): string {
  const full = withEnv(command, options?.env);
  if (options?.background) {
    // setsid detaches the job from the exec session so it outlives the call.
    return `setsid nohup sh -c "${escapeShellArg(full)}" > /dev/null 2>&1 < /dev/null &`;
  }
  return full;
}

function mapStatus(status: string): InstanceInfo['status'] {
  if (status === 'running' || status === 'pending' || status === 'starting' || status === 'migrating') return 'running';
  if (status === 'failed') return 'error';
  return 'stopped';
}

function toBoxdSnapshot(snapshot: Snapshot): BoxdSnapshot {
  return {
    id: snapshot.name,
    provider: 'boxd',
    createdAt: snapshot.createdAt ?? new Date(),
    metadata: {
      snapshotId: snapshot.id,
      version: snapshot.version,
      status: snapshot.status,
      sizeBytes: snapshot.sizeBytes,
      region: snapshot.region,
    },
  };
}

function toBoxdVolume(disk: Disk | { id: string; name: string; sizeBytes: number; status: string }): BoxdVolume {
  return { id: disk.id, name: disk.name, sizeBytes: disk.sizeBytes, native: disk };
}

async function findDisk(client: Boxd, idOrName: string): Promise<Disk | undefined> {
  const disks = await client.disks.list();
  return disks.find((disk) => disk.id === idOrName) ?? disks.find((disk) => disk.name === idOrName);
}

/** boxd addresses disks by id; accept a ComputeSDK volume handle, an id, or a name. */
async function resolveDiskId(client: Boxd, volume: string | Volume): Promise<string> {
  const ref = resolveVolumeRef(volume);
  const native = ref.native as { id?: unknown } | undefined;
  if (typeof native?.id === 'string') return native.id;
  const key = ref.id ?? ref.name;
  if (!key) throw new Error('boxd volume reference needs an id or a name');
  const disk = await findDisk(client, key);
  if (!disk) throw new Error(`boxd disk not found: ${key}`);
  return disk.id;
}

function machineConfig(options?: CreateInstanceOptions): MachineConfig | undefined {
  const vcpu = options?.vcpus ?? options?.cpus;
  const memoryMiB = options?.memoryMiB ?? options?.memoryMb;
  const config: MachineConfig = {};
  if (vcpu !== undefined) config.vcpu = vcpu;
  if (memoryMiB !== undefined) config.memory = `${Math.ceil(memoryMiB / 1024)}G`;
  return Object.keys(config).length > 0 ? config : undefined;
}

function egressAllowlist(egress: CreateInstanceOptions['egress']): string[] | undefined {
  if (egress === undefined) return undefined;
  if (typeof egress === 'string') return [egress];
  if (Array.isArray(egress)) return egress;
  throw new Error(
    'egress: boxd cannot host the ComputeSDK egress router. Pass a boxd egress allowlist instead, e.g. egress: ["api.example.com"]'
  );
}

function stringLabels(metadata?: Record<string, any>): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const labels = Object.fromEntries(Object.entries(metadata).filter(([, value]) => typeof value === 'string'));
  return Object.keys(labels).length > 0 ? labels : undefined;
}

/** Reads one output channel of an ExecStream, decoding UTF-8 across chunk boundaries. */
async function pump(source: AsyncIterable<Uint8Array>, onText: (text: string) => void): Promise<void> {
  const decoder = new TextDecoder();
  try {
    for await (const chunk of source) {
      const text = decoder.decode(chunk, { stream: true });
      if (text) onText(text);
    }
  } catch {
    // The stream ends with an error when it is cancelled (timeout or kill).
  }
  const rest = decoder.decode();
  if (rest) onText(rest);
}

interface StreamRun {
  stream: ExecStream;
  stdout: string;
  stderr: string;
  done: Promise<number | null>;
}

function startStream(
  sandbox: BoxdSandbox,
  command: string,
  options: { cwd?: string; env?: Record<string, string>; stdin?: boolean; onStdout?: (text: string) => void; onStderr?: (text: string) => void },
): StreamRun {
  const stream = sandbox.client.machines.streamExec(sandbox.machine.id, {
    command: withEnv(command, options.env),
    cwd: options.cwd,
    closeStdin: !options.stdin,
  });
  const run: StreamRun = { stream, stdout: '', stderr: '', done: Promise.resolve(null) };
  const out = pump(stream, (text) => { run.stdout += text; options.onStdout?.(text); });
  const err = pump(stream.stderr, (text) => { run.stderr += text; options.onStderr?.(text); });
  run.done = (async () => {
    let code: number | null;
    try {
      code = await stream.wait();
    } catch {
      code = null;
    }
    await Promise.all([out, err]);
    return code;
  })();
  return run;
}

const _provider = defineProvider<BoxdSandbox, BoxdConfig, any, BoxdSnapshot, BoxdVolume>({
  name: 'boxd',
  // boxd sizes are fixed at 4 GiB per vCPU (1/4, 2/8, 4/16, 8/32), so no standard
  // ComputeSDK size class (1/1 ... 16/32 GiB) maps exactly onto one.
  sizes: (_config, profile) => ({
    status: 'unsupported',
    reason: `boxd has no ${profile.vcpus} vCPU / ${profile.memoryMiB / 1024} GiB size; it offers 1/4, 2/8, 4/16 and 8/32 GiB. Pass vcpus or memoryMiB instead.`,
  }),
  methods: {
    instances: {
      create: async (config: BoxdConfig, options?: CreateInstanceOptions) => {
        const client = createClient(config);
        const fromSnapshot = options?.snapshotId ?? options?.templateId;
        const deleteAfter = options?.timeout ? Math.ceil(options.timeout / 1000) : undefined;
        const egress = egressAllowlist(options?.egress);
        const labels = stringLabels(options?.metadata);
        const sizing = machineConfig(options);
        const volumes = isUnifiedVolumeMounts(options?.volumes)
          ? await Promise.all(options!.volumes!.map(async (mount) => ({
            diskId: await resolveDiskId(client, mount.volume),
            mountPath: mount.mountPath,
            readOnly: mount.readOnly,
          })))
          : undefined;

        let params: MachineCreateParams;
        if (fromSnapshot) {
          if (volumes) throw new Error('boxd cannot attach disks to a machine restored from a snapshot');
          params = { name: options?.name, fromSnapshot, isolated: true, deleteAfter, labels };
        } else {
          const machineCfg: MachineConfig | undefined = sizing || volumes ? { ...sizing, ...(volumes ? { volumes } : {}) } : undefined;
          params = {
            name: options?.name,
            image: options?.image,
            isolated: true,
            env: options?.envs,
            deleteAfter,
            labels,
            config: machineCfg,
          };
        }

        const created = await client.machines.create(params);
        try {
          if (egress) await client.machines.setEgressAllow(created.id, egress);
          const machine = await client.machines.waitUntilReady(created.id);
          return { instance: { client, machine }, instanceId: machine.id };
        } catch (error) {
          await client.machines.delete(created.id).catch(() => {});
          throw error;
        }
      },

      getById: async (config: BoxdConfig, instanceId: string) => {
        const client = createClient(config);
        try {
          const machine = await client.machines.get(instanceId);
          if (machine.status === 'destroyed') return null;
          return { instance: { client, machine }, instanceId: machine.id };
        } catch (error) {
          if (error instanceof NotFoundError) return null;
          throw error;
        }
      },

      list: async (config: BoxdConfig) => {
        const client = createClient(config);
        const machines = await client.machines.list();
        return machines
          .filter((machine) => machine.status !== 'destroyed')
          .map((machine) => ({ instance: { client, machine }, instanceId: machine.id }));
      },

      destroy: async (config: BoxdConfig, instanceId: string) => {
        const client = createClient(config);
        try {
          await client.machines.delete(instanceId);
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
      },

      runCommand: async (sandbox: BoxdSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          const result = await sandbox.client.machines.exec(sandbox.machine.id, {
            command: buildCommand(command, options),
            cwd: options?.cwd,
            timeout: options?.timeout,
          });
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          const timedOut = options?.timeout !== undefined && Date.now() - startTime >= options.timeout;
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: timedOut ? 124 : 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      // `streamExec` delivers stdout and stderr as they are produced. Closing the
      // stream kills the remote process group, which is how timeouts are enforced.
      streamCommand: async (sandbox: BoxdSandbox, command: string, options: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        const run = startStream(sandbox, command, {
          cwd: options.cwd,
          env: options.env,
          onStdout: options.onStdout,
          onStderr: options.onStderr,
        });
        let timedOut = false;
        const timer = options.timeout !== undefined
          ? setTimeout(() => { timedOut = true; run.stream.close(); }, options.timeout)
          : undefined;
        try {
          const code = await run.done;
          return {
            stdout: run.stdout,
            stderr: run.stderr,
            exitCode: timedOut ? 124 : (code ?? 1),
            durationMs: Date.now() - startTime,
          };
        } finally {
          clearTimeout(timer);
          run.stream.close();
        }
      },

      startProcess: async (sandbox: BoxdSandbox, command: string, options: StartProcessOptions): Promise<ProcessHandle> => {
        const startTime = Date.now();
        const run = startStream(sandbox, command, options);
        const jobId = randomUUID();
        let killSignal: string | null = null;
        let exitCode: number | null | undefined;
        const finished = run.done.then((code) => {
          exitCode = killSignal ? null : code;
          options.onExit?.({ exitCode, signal: killSignal });
          return { exitCode, signal: killSignal };
        });
        const toResult = (result: { exitCode: number | null; signal: string | null }) => ({
          stdout: run.stdout,
          stderr: run.stderr,
          exitCode: result.exitCode ?? 137,
          signal: result.signal,
          durationMs: Date.now() - startTime,
        });

        return {
          pid: null,
          jobId,
          runtime: 'native',
          write: async (data) => {
            if (!options.stdin) throw new Error('Process was started without stdin: true');
            if (exitCode !== undefined) throw new Error(`Process ${jobId} has exited`);
            run.stream.write(data);
          },
          closeStdin: async () => {
            if (options.stdin && exitCode === undefined) run.stream.end();
          },
          status: async () =>
            exitCode !== undefined
              ? { status: 'exited', exitCode, signal: killSignal, stdout: run.stdout, stderr: run.stderr }
              : { status: 'running', exitCode: null, signal: null, stdout: run.stdout, stderr: run.stderr },
          wait: async (waitOptions) => {
            if (waitOptions?.timeout === undefined) return toResult(await finished);
            let timer: ReturnType<typeof setTimeout> | undefined;
            const timeout = new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`Process ${jobId} did not exit within ${waitOptions.timeout}ms`)),
                waitOptions.timeout,
              );
            });
            try {
              return toResult(await Promise.race([finished, timeout]));
            } finally {
              clearTimeout(timer);
            }
          },
          // Closing the stream makes boxd SIGTERM the process group, then SIGKILL
          // it; the requested signal name is what the result reports.
          kill: async (signal) => {
            if (exitCode !== undefined) return;
            killSignal = signal ?? 'SIGTERM';
            run.stream.close();
            await finished;
          },
        };
      },

      getInfo: async (sandbox: BoxdSandbox): Promise<InstanceInfo> => ({
        id: sandbox.machine.id,
        provider: 'boxd',
        status: mapStatus(sandbox.machine.status),
        createdAt: sandbox.machine.createdAt ?? new Date(),
        timeout: sandbox.machine.deleteAt ? Math.max(0, sandbox.machine.deleteAt.getTime() - Date.now()) : 0,
        metadata: {
          name: sandbox.machine.name,
          url: sandbox.machine.access.url,
        },
      }),

      getUrl: async (sandbox: BoxdSandbox, urlOptions: { port: number; protocol?: string }): Promise<string> => {
        const { client, machine } = sandbox;
        const routeName = `p${urlOptions.port}`;
        try {
          await client.machines.proxies.create(machine.id, routeName, urlOptions.port);
        } catch (error) {
          if (!(error instanceof ConflictError)) throw error;
        }
        const routes = await client.machines.proxies.list(machine.id);
        const route = routes.find((r) => r.name === routeName);
        if (!route) {
          throw new Error(`boxd did not return a proxy route for port ${urlOptions.port} on machine ${machine.id}`);
        }
        const protocol = urlOptions.protocol || 'https';
        return `${protocol}://${route.domain}`;
      },

      // A disk lives on one host, so attaching to an existing machine only works
      // when both share a host; pass `volumes` on create to pair them reliably.
      attachVolume: async (sandbox: BoxdSandbox, volume: string | Volume, mountPath: string): Promise<void> => {
        const diskId = await resolveDiskId(sandbox.client, volume);
        await sandbox.client.disks.attach(diskId, sandbox.machine.id, mountPath);
      },

      detachVolume: async (sandbox: BoxdSandbox, volume: string | Volume): Promise<void> => {
        const diskId = await resolveDiskId(sandbox.client, volume);
        await sandbox.client.disks.detach(diskId, sandbox.machine.id);
      },

      // `machines.pause` suspends the VM to RAM; `resume` thaws it with processes intact.
      pause: async (sandbox: BoxdSandbox): Promise<void> => {
        await sandbox.client.machines.pause(sandbox.machine.id);
      },

      resume: async (sandbox: BoxdSandbox): Promise<void> => {
        await sandbox.client.machines.resume(sandbox.machine.id);
        sandbox.machine = await sandbox.client.machines.get(sandbox.machine.id);
      },

      pauseCapabilities: { memory: true },

      // Machines are persistent unless created with `timeout` (boxd's `deleteAfter`).
      lifetime: {},

      // Moves the machine's delete time later by `ms`. A machine with no delete time has no limit to extend.
      extendLifetime: async (sandbox: BoxdSandbox, ms: number): Promise<void> => {
        const machine = await sandbox.client.machines.get(sandbox.machine.id);
        sandbox.machine = machine;
        if (!machine.deleteAt) return;
        const now = Date.now();
        const target = Math.max(machine.deleteAt.getTime(), now) + ms;
        await sandbox.client.machines.setDeleteAfter(machine.id, Math.ceil((target - now) / 1000));
      },

      filesystem: {
        readFile: async (sandbox: BoxdSandbox, path: string): Promise<string> => {
          const bytes = await sandbox.client.machines.fs.read(sandbox.machine.id, path);
          return new TextDecoder().decode(bytes);
        },

        writeFile: async (sandbox: BoxdSandbox, path: string, content: string): Promise<void> => {
          await sandbox.client.machines.fs.write(sandbox.machine.id, path, content);
        },

        mkdir: async (sandbox: BoxdSandbox, path: string): Promise<void> => {
          await sandbox.client.machines.fs.mkdir(sandbox.machine.id, path);
        },

        readdir: async (sandbox: BoxdSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await sandbox.client.machines.fs.list(sandbox.machine.id, path);
          return entries.map((entry) => ({
            name: entry.name,
            type: entry.isDir ? 'directory' as const : 'file' as const,
            size: entry.size,
            modified: entry.mtime,
          }));
        },

        exists: async (sandbox: BoxdSandbox, path: string): Promise<boolean> =>
          sandbox.client.machines.fs.exists(sandbox.machine.id, path),

        remove: async (sandbox: BoxdSandbox, path: string): Promise<void> => {
          await sandbox.client.machines.fs.remove(sandbox.machine.id, path, { recursive: true });
        },
      },

      getInstance: (sandbox: BoxdSandbox): BoxdSandbox => sandbox,
    },

    snapshot: {
      // boxd snapshots capture disk and memory; the source machine keeps running.
      // `snapshots.create` returns while the snapshot is still `pending`.
      capabilities: {
        scope: 'rootfs',
        memory: true,
        destroysSource: false,
        source: 'kept',
        fork: true,
        readiness: 'eventual',
      },

      create: async (config: BoxdConfig, instanceId: string, options?: CreateSnapshotOptions): Promise<BoxdSnapshot> => {
        const client = createClient(config);
        const name = options?.name ?? `csdk-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const created = await client.snapshots.create(instanceId, name);
        return {
          id: created.name,
          provider: 'boxd',
          createdAt: new Date(),
          metadata: {
            snapshotId: created.id,
            version: created.version,
            status: created.status,
            sourceInstanceId: instanceId,
            ...options?.metadata,
          },
        };
      },

      // boxd snapshots don't record their source machine, so `instanceId` can't be filtered on.
      list: async (config: BoxdConfig, options?: ListSnapshotsOptions): Promise<BoxdSnapshot[]> => {
        const client = createClient(config);
        const snapshots = (await client.snapshots.list()).map(toBoxdSnapshot);
        return options?.limit ? snapshots.slice(0, options.limit) : snapshots;
      },

      delete: async (config: BoxdConfig, snapshotId: string): Promise<void> => {
        const client = createClient(config);
        try {
          await client.snapshots.delete(snapshotId);
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
      },

      waitUntilReady: async (config: BoxdConfig, snapshotId: string, options?: { timeoutMs?: number }): Promise<void> => {
        const client = createClient(config);
        const deadline = Date.now() + (options?.timeoutMs ?? DEFAULT_SNAPSHOT_TIMEOUT_MS);
        for (;;) {
          const snapshot = await client.snapshots.get(snapshotId);
          if (snapshot.status === 'ready') return;
          if (snapshot.status === 'failed') throw new Error(`boxd snapshot ${snapshotId} failed`);
          if (Date.now() >= deadline) throw new Error(`Timed out waiting for boxd snapshot ${snapshotId} to be ready`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      },
    },

    // boxd disks: standalone block storage that outlives the machine it is attached to.
    volume: {
      create: async (config: BoxdConfig, options): Promise<BoxdVolume> => {
        const client = createClient(config);
        const disk = await client.disks.create(options.name, options.sizeBytes ?? DEFAULT_DISK_SIZE);
        return toBoxdVolume(disk);
      },

      get: async (config: BoxdConfig, volumeIdOrName: string): Promise<BoxdVolume | null> => {
        const client = createClient(config);
        const disk = await findDisk(client, volumeIdOrName);
        return disk ? toBoxdVolume(disk) : null;
      },

      list: async (config: BoxdConfig, options): Promise<BoxdVolume[]> => {
        const client = createClient(config);
        const disks = (await client.disks.list()).map(toBoxdVolume);
        return options?.limit ? disks.slice(0, options.limit) : disks;
      },

      delete: async (config: BoxdConfig, volumeIdOrName: string): Promise<void> => {
        const client = createClient(config);
        const disk = await findDisk(client, volumeIdOrName);
        if (!disk) return;
        try {
          await client.disks.delete(disk.id);
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
      },
    },
  },
});

export const boxd = (config: BoxdConfig = {}) => _provider(config);
