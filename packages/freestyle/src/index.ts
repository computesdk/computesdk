/**
 * Freestyle Provider - Factory-based Implementation
 *
 * Runs code in Freestyle VMs (https://www.freestyle.sh) — full Linux virtual
 * machines designed for long-running, complex agent tasks, with instant
 * startup, persistence, and cheap snapshotting.
 *
 * Freestyle base images ship no language runtime, so the first sandbox on an
 * account bakes a Node + Python snapshot once and caches it; every sandbox
 * after boots from it in ~200-300 ms. Point `snapshotId` (or
 * `FREESTYLE_SNAPSHOT_ID`) at your own snapshot to skip baking entirely.
 */

import {
  Freestyle,
  FreestyleApiError,
  type Vm,
  type FirewallSpec,
  type SnapshotData,
} from 'freestyle';
import { defineProvider, escapeShellArg, InstanceSizeError } from '@computesdk/provider';
import type {
  CommandResult,
  InstanceInfo,
  CreateInstanceOptions,
  CreateSnapshotOptions,
  ListSnapshotsOptions,
  FileEntry,
  RunCommandOptions,
} from '@computesdk/provider';

/**
 * Freestyle provider configuration
 */
export interface FreestyleConfig {
  /** Freestyle API key. Falls back to the `FREESTYLE_API_KEY` environment variable. */
  apiKey?: string;
  /**
   * Snapshot every sandbox boots from — an `sh-…` id or one of your slugs.
   * Falls back to `FREESTYLE_SNAPSHOT_ID`. When unset, the provider bakes a
   * Node + Python snapshot once per account and reuses it.
   */
  snapshotId?: string;
  /** API base URL. Falls back to `FREESTYLE_API_URL`, then the SDK default. */
  baseUrl?: string;
  /** Idle seconds before Freestyle stops the VM (default 300). */
  idleTimeoutSeconds?: number;
  /** Default wall-clock limit for a single command, in milliseconds (default 300000). */
  timeout?: number;
  /**
   * Keep the VM (and its disk) after it stops instead of deleting it. By default
   * a stopped or paused VM is kept for five minutes, so it can be resumed, then
   * deleted; the shared `ephemeral: true` create option deletes it on stop.
   */
  persistent?: boolean;
  /**
   * Outbound network policy. A Freestyle VM reaches nothing unless a rule says
   * so; the default allows all outbound so `npm`/`pip` work. Pass `{ rules: [] }`
   * for a sealed sandbox.
   */
  firewall?: FirewallSpec;
}

const DEFAULT_TIMEOUT_MS = 300_000;
/**
 * Freestyle accepts exec timeouts up to 24h on VMs with the current guest
 * agent; VMs booted from snapshots baked with an older agent refuse anything
 * over five minutes. Callers with a longer deadline get the cap, and a legacy
 * VM gets a retry at its own cap, never a refused call.
 */
const MAX_EXEC_TIMEOUT_MS = 86_400_000;
const LEGACY_EXEC_TIMEOUT_MS = 300_000;
const DEFAULT_IDLE_TIMEOUT_SECS = 300;
/** Ephemeral VMs are deleted when they stop; `-1` keeps them. */
const AUTO_DELETE_EPHEMERAL = 0;
const AUTO_DELETE_NEVER = -1;
/**
 * Default window a stopped or paused VM is kept before deletion. Freestyle
 * refuses to pause an ephemeral (`0`) VM, so a non-zero window is what makes
 * `pause()`/`start()` work on default sandboxes.
 */
const AUTO_DELETE_AFTER_STOP_SECS = 300;
/** Marks the VMs this provider creates, so `list` returns sandboxes rather than every VM on the account. */
const SANDBOX_METADATA_MARKER = 'computesdk';
/** Slug of the auto-baked runtime snapshot, so it is found and reused across processes. */
// Versioned so a re-bake picks up the current guest agent (long-running execs).
const RUNTIME_SNAPSHOT_SLUG = 'computesdk-freestyle-runtime-v2';
/** What the runtime snapshot boots with; `resize` can only grow from here. */
const RUNTIME_VCPUS = 4;
const RUNTIME_MEMORY_MIB = 8192;
const RUNTIME_NODE_VERSION = 'v22.19.0';
/** Snapshot list page size; the API pages, so a single call is never the whole account. */
const SNAPSHOT_PAGE_SIZE = 200;
const ALLOW_ALL_OUTBOUND: FirewallSpec = {
  rules: [{ action: 'allow', source: {}, destination: { public: true } }],
};

interface ResolvedConfig {
  apiKey: string;
  baseUrl?: string;
  snapshotId?: string;
}

function resolveConfig(config: FreestyleConfig): ResolvedConfig {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const apiKey = config.apiKey || env?.FREESTYLE_API_KEY || '';
  if (!apiKey) {
    throw new Error(
      'Missing Freestyle API key. Provide `apiKey` in config or set FREESTYLE_API_KEY. Get a key at https://www.freestyle.sh',
    );
  }
  return {
    apiKey,
    baseUrl: config.baseUrl || env?.FREESTYLE_API_URL || undefined,
    snapshotId: config.snapshotId || env?.FREESTYLE_SNAPSHOT_ID || undefined,
  };
}

/**
 * One Freestyle client per (apiKey, baseUrl): the client is a thin credential
 * holder, and reusing it keeps the underlying fetch connections warm across a
 * burst of sandboxes.
 */
const clientCache = new Map<string, Freestyle>();
function clientFor(resolved: ResolvedConfig): Freestyle {
  const key = `${resolved.apiKey} ${resolved.baseUrl ?? ''}`;
  let client = clientCache.get(key);
  if (!client) {
    client = new Freestyle({ apiKey: resolved.apiKey, baseUrl: resolved.baseUrl });
    clientCache.set(key, client);
  }
  return client;
}

/**
 * Bake the Node + Python runtime snapshot, once per (apiKey, baseUrl).
 *
 * This is the fallback, not the common path: `create` names the snapshot by its
 * slug and only lands here when the API says no such snapshot exists, which is
 * once per account. The in-flight promise keeps a burst of sandboxes that all
 * miss from baking a snapshot each, and the slug persists the result across
 * processes — a later run resolves it on the create itself.
 */
const runtimeSnapshotCache = new Map<string, Promise<string>>();
function ensureSnapshot(resolved: ResolvedConfig): Promise<string> {
  if (resolved.snapshotId) return Promise.resolve(resolved.snapshotId);
  const key = `${resolved.apiKey} ${resolved.baseUrl ?? ''}`;
  let pending = runtimeSnapshotCache.get(key);
  if (!pending) {
    pending = bakeRuntimeSnapshot(clientFor(resolved)).catch((error) => {
      runtimeSnapshotCache.delete(key);
      throw error;
    });
    runtimeSnapshotCache.set(key, pending);
  }
  return pending;
}

/**
 * Find a snapshot by slug, paging until it turns up. The runtime snapshot is old
 * by construction — baked once, then only ever read — so it sinks past the first
 * page as an account accumulates snapshots. Stopping at one page would miss it
 * and re-bake under a slug that is already taken.
 */
async function findSnapshotBySlug(
  client: Freestyle,
  slug: string,
): Promise<SnapshotData | undefined> {
  for (let offset = 0; ; offset += SNAPSHOT_PAGE_SIZE) {
    const { snapshots, totalCount } = await client.vms.snapshots.list({
      limit: SNAPSHOT_PAGE_SIZE,
      offset,
    });
    const match = snapshots.find((snapshot) => snapshot.slug === slug);
    if (match) return match;
    if (snapshots.length === 0 || offset + snapshots.length >= totalCount) return undefined;
  }
}

async function bakeRuntimeSnapshot(client: Freestyle): Promise<string> {
  // Reuse a snapshot a previous run already baked.
  const existing = await findSnapshotBySlug(client, RUNTIME_SNAPSHOT_SLUG);
  if (existing) return existing.id;

  const { vm, vmId } = await client.vms.create({
    slug: RUNTIME_SNAPSHOT_SLUG + '-builder',
    reassignSlug: true,
    autoDeleteSeconds: AUTO_DELETE_EPHEMERAL,
    automaticRestart: false,
    firewall: ALLOW_ALL_OUTBOUND,
  });
  const run = async (command: string) => {
    const result = await vm.exec({ command, linuxUser: RUNTIME_USER, timeoutMs: DEFAULT_TIMEOUT_MS });
    if (result.statusCode !== 0) {
      throw new Error(`Freestyle runtime bake failed (${command}): ${result.stderr ?? result.stdout ?? ''}`);
    }
  };
  try {
    await run(
      'apt-get update -y && DEBIAN_FRONTEND=noninteractive apt-get install -y curl xz-utils ca-certificates python3 python3-pip',
    );
    await run(
      `curl -fsSL "https://nodejs.org/dist/${RUNTIME_NODE_VERSION}/node-${RUNTIME_NODE_VERSION}-linux-x64.tar.xz" | tar -xJ -C /usr/local --strip-components=1`,
    );
    const { snapshotId } = await vm.snapshot({
      slug: RUNTIME_SNAPSHOT_SLUG,
      displayName: 'ComputeSDK Freestyle runtime (Node + Python)',
    });
    return snapshotId;
  } finally {
    await client.vms.delete(vmId).catch(() => {
      /* builder is ephemeral; a failed cleanup is not fatal */
    });
  }
}

/** The guest agent on VMs from older snapshots only runs execs up to five minutes. */
function isLegacyGuestAgent(error: unknown): boolean {
  return error instanceof FreestyleApiError && /guest agent/i.test(error.message);
}

/**
 * Apply a requested vCPU count / memory (MiB) to a freshly booted VM. Freestyle
 * sizes come from the snapshot and `resize` is grow-only, so only axes above
 * what the VM booted with are sent; smaller requests keep the snapshot's size.
 */
async function growResources(vm: Vm, cpu?: number, memory?: number): Promise<void> {
  if (cpu === undefined && memory === undefined) return;
  const { resources } = await vm.data();
  const patch: { cpu?: number; memory?: number } = {};
  if (cpu !== undefined && cpu > resources.cpu) patch.cpu = cpu;
  if (memory !== undefined && memory > resources.memory) patch.memory = memory;
  if (patch.cpu === undefined && patch.memory === undefined) return;
  const { resources: target } = await vm.resize(patch);
  await waitForGuestResources(vm, target.cpu, target.memory);
}

/**
 * `resize` returns once the hypervisor has the new size, but the guest
 * hot-plugs vCPUs and memory a moment later. Wait until the guest sees them
 * (MemTotal sits a little under the allocation), so the first command runs
 * on the size that was asked for.
 */
const RESIZE_SETTLE_TIMEOUT_MS = 60_000;
const RESIZE_POLL_INTERVAL_MS = 500;
async function waitForGuestResources(vm: Vm, cpu: number, memoryMiB: number): Promise<void> {
  const deadline = Date.now() + RESIZE_SETTLE_TIMEOUT_MS;
  for (;;) {
    const result = await vm.exec({
      command: "nproc; awk '/MemTotal/ {print $2}' /proc/meminfo",
      linuxUser: RUNTIME_USER,
      timeoutMs: 10_000,
    });
    const [cpus, memKiB] = (result.stdout ?? '').trim().split(/\s+/).map(Number);
    if (cpus >= cpu && memKiB >= memoryMiB * 1024 * 0.95) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Freestyle VM did not reach ${cpu} vCPU / ${memoryMiB} MiB after resize (guest sees ${cpus} vCPU / ${Math.round(memKiB / 1024)} MiB)`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, RESIZE_POLL_INTERVAL_MS));
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof FreestyleApiError &&
    (error.code === 'NOT_FOUND' || (error as { status?: number }).status === 404)
  );
}

/**
 * Whether a create failed because the snapshot it named is not there.
 *
 * A create that names a missing snapshot is a `400 BAD_REQUEST`, not a 404 —
 * the API documents that status as "invalid slug, metadata, or a snapshot that
 * does not exist" — so {@link isNotFound} does not cover it. The slug has to
 * appear in the message too: a 400 is also how a malformed request is refused,
 * and baking a runtime image in response to that would be nonsense.
 */
function isMissingSnapshot(error: unknown, slug: string): boolean {
  if (isNotFound(error)) return true;
  if (!(error instanceof FreestyleApiError)) return false;
  const status = (error as { status?: number }).status;
  if (status !== 400 && error.code !== 'BAD_REQUEST') return false;
  return error.message.includes(slug) && /does not exist/i.test(error.message);
}

/**
 * Commands run as root. Freestyle's base image logs in as an unprivileged
 * `ubuntu` user with no `HOME`; asking for root gives a normal sandbox — a set
 * `HOME`, working `apt`/`npm`/`pip`, and the write access sandboxed code expects.
 */
const RUNTIME_USER = 'root';

/** Compose `cwd`/`background` onto a command, running it through the guest shell. */
function buildCommand(command: string, options?: RunCommandOptions): string {
  let full = command;
  // Quoted so a path with spaces works and a crafted cwd cannot break out of `cd`.
  if (options?.cwd) full = `cd "${escapeShellArg(options.cwd)}" && ${full}`;
  if (options?.background) full = `nohup ${full} > /dev/null 2>&1 &`;
  return full;
}

/**
 * A snapshot in ComputeSDK's shape. The gateway (`compute.setConfig`, and with
 * it `compute.snapshot.*`) types snapshots as `{ id, provider, createdAt }`, so
 * returning Freestyle's raw `{ snapshotId }` would make this provider
 * unassignable to `DirectProvider` and break the gateway path entirely.
 */
export interface FreestyleSnapshot {
  id: string;
  provider: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

function toSnapshot(data: SnapshotData): FreestyleSnapshot {
  return {
    id: data.id,
    provider: 'freestyle',
    createdAt: new Date(data.createdAt),
    metadata: {
      ...(data.sourceVmId ? { sourceVmId: data.sourceVmId } : {}),
      ...(data.slug ? { slug: data.slug } : {}),
      ...(data.displayName ? { displayName: data.displayName } : {}),
    },
  };
}

/**
 * Create a Freestyle provider instance.
 */
export const freestyle = defineProvider<Vm, FreestyleConfig, unknown, FreestyleSnapshot>({
  name: 'freestyle',
  sizes: (config, profile, options) => {
    if (options?.cpu !== undefined || options?.memory !== undefined) {
      throw new InstanceSizeError('conflict', 'cannot combine sizeClass with native Freestyle cpu/memory fields');
    }
    if (options?.sandboxId || options?.snapshotId || options?.templateId || config.snapshotId) {
      return { status: 'unsupported', reason: 'The snapshot sets the base size of a Freestyle VM; standard sizes apply to the default runtime snapshot only.' };
    }
    if (profile.vcpus < RUNTIME_VCPUS || profile.memoryMiB < RUNTIME_MEMORY_MIB) {
      return { status: 'unavailable', reason: `Freestyle resize is grow-only; the runtime snapshot boots at ${RUNTIME_VCPUS} vCPU / ${RUNTIME_MEMORY_MIB} MiB.` };
    }
    if (profile.sizeClass === '2xl') {
      return { status: 'unknown', reason: 'This adapter has not verified this standard shape.' };
    }
    return { status: 'supported', nativeOptions: { cpu: profile.vcpus, memory: profile.memoryMiB } };
  },
  methods: {
    instances: {
      // ── Collection operations (compute.sandbox.*) ──────────────────────
      create: async (config: FreestyleConfig, options?: CreateInstanceOptions) => {
        const resolved = resolveConfig(config);
        const client = clientFor(resolved);

        // Reconnect to an existing sandbox by id — no boot.
        if (options?.sandboxId) {
          return { instance: client.vms.ref(options.sandboxId), instanceId: options.sandboxId };
        }

        // `snapshotId` accepts an id, your own slug, or a public `{owner}/{slug}`,
        // so the runtime snapshot needs no lookup: name it and let the create
        // resolve it. Only if it is genuinely absent do we pay for a bake, and
        // then only once — `ensureSnapshot` de-duplicates concurrent callers.
        const requested = options?.snapshotId || options?.templateId || resolved.snapshotId;
        const snapshotId = requested ?? RUNTIME_SNAPSHOT_SLUG;
        // Shared `ephemeral` create option overrides config.persistent for this
        // sandbox: true -> deleted on stop, false -> kept.
        const autoDeleteSeconds =
          options?.ephemeral === true
            ? AUTO_DELETE_EPHEMERAL
            : options?.ephemeral === false || config.persistent
              ? AUTO_DELETE_NEVER
              : AUTO_DELETE_AFTER_STOP_SECS;
        try {
          return await boot(snapshotId);
        } catch (error) {
          // A caller who named a snapshot gets the error; only our own slug
          // fallback means "not baked yet".
          if (!requested && isMissingSnapshot(error, RUNTIME_SNAPSHOT_SLUG)) {
            return await boot(await ensureSnapshot(resolved));
          }
          if (
            error instanceof FreestyleApiError &&
            (error.code === 'UNAUTHORIZED' || (error as { status?: number }).status === 401)
          ) {
            throw new Error(
              'Freestyle authentication failed. Check your FREESTYLE_API_KEY. Get a key at https://www.freestyle.sh',
            );
          }
          throw new Error(
            `Failed to create Freestyle sandbox: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        async function boot(snapshot: string) {
          const { vm, vmId } = await client.vms.create({
            snapshotId: snapshot,
            autoDeleteSeconds,
            automaticRestart: false,
            idleTimeoutSeconds: config.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECS,
            // Marker last, so a caller's own metadata can never overwrite it and
            // hide the sandbox from `list`.
            metadata: { ...(options?.metadata ?? {}), purpose: SANDBOX_METADATA_MARKER },
            firewall: config.firewall ?? ALLOW_ALL_OUTBOUND,
          });
          try {
            await growResources(vm, options?.cpu, options?.memory);
          } catch (error) {
            await client.vms.delete(vmId).catch(() => {});
            throw error;
          }
          return { instance: vm, instanceId: vmId };
        }
      },

      getById: async (config: FreestyleConfig, sandboxId: string) => {
        const client = clientFor(resolveConfig(config));
        try {
          // Confirm it exists (and is this account's) before handing back a handle.
          await client.vms.get(sandboxId);
          return { instance: client.vms.ref(sandboxId), instanceId: sandboxId };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },

      list: async (config: FreestyleConfig) => {
        const client = clientFor(resolveConfig(config));
        // Only the VMs this provider created — metadata keeps `list` from
        // returning unrelated VMs on a shared account.
        const { vms } = await client.vms.list({
          metadata: `purpose:${SANDBOX_METADATA_MARKER}`,
          limit: 200,
        });
        return vms.map((vm) => ({ instance: client.vms.ref(vm.id), instanceId: vm.id }));
      },

      destroy: async (config: FreestyleConfig, sandboxId: string) => {
        const client = clientFor(resolveConfig(config));
        try {
          await client.vms.delete(sandboxId);
        } catch (error) {
          // Already gone is an acceptable outcome for destroy.
          if (!isNotFound(error)) throw error;
        }
      },

      // ── Instance operations (Sandbox methods) ──────────────────────────
      runCommand: async (
        sandbox: Vm,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          const request = {
            // Freestyle runs this through the guest's shell and applies env natively.
            command: buildCommand(command, options),
            linuxUser: RUNTIME_USER,
            env: options?.env,
            timeoutMs: Math.min(
              options?.timeout ?? DEFAULT_TIMEOUT_MS,
              MAX_EXEC_TIMEOUT_MS,
            ),
          };
          const result = await sandbox.exec(request).catch((error: unknown) => {
            if (request.timeoutMs <= LEGACY_EXEC_TIMEOUT_MS || !isLegacyGuestAgent(error)) throw error;
            return sandbox.exec({ ...request, timeoutMs: LEGACY_EXEC_TIMEOUT_MS });
          });
          return {
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            exitCode: result.statusCode ?? 124,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (sandbox: Vm): Promise<InstanceInfo> => {
        const data = await sandbox.data();
        const status: InstanceInfo['status'] =
          data.state === 'running' || data.state === 'starting'
            ? 'running'
            : data.state === 'stopped' || data.state === 'paused' || data.state === 'pausing'
              ? 'stopped'
              : 'error';
        return {
          id: sandbox.id,
          provider: 'freestyle',
          status,
          createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
          timeout: (data.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECS) * 1000,
          metadata: { freestyleVmId: sandbox.id, state: data.state, ...(data.metadata ?? {}) },
        };
      },

      getUrl: async (_sandbox: Vm, options: { port: number; protocol?: string }): Promise<string> => {
        throw new Error(
          `Freestyle does not expose a per-port URL for port ${options.port}. Map a domain to the VM with ` +
            `freestyle.domains (https://docs.freestyle.sh) and reach the guest through that.`,
        );
      },

      filesystem: {
        readFile: async (sandbox: Vm, path: string): Promise<string> => sandbox.fs.readTextFile(path),
        writeFile: async (sandbox: Vm, path: string, content: string): Promise<void> => {
          await sandbox.fs.writeFile(path, content);
        },
        mkdir: async (sandbox: Vm, path: string): Promise<void> => {
          await sandbox.fs.mkdir(path);
        },
        readdir: async (sandbox: Vm, path: string): Promise<FileEntry[]> => {
          const entries = await sandbox.fs.readDir(path);
          return entries.map((entry) => ({
            name: entry.name,
            type: entry.kind === 'directory' ? 'directory' : 'file',
          }));
        },
        exists: async (sandbox: Vm, path: string): Promise<boolean> => sandbox.fs.exists(path),
        remove: async (sandbox: Vm, path: string): Promise<void> => {
          await sandbox.fs.remove(path);
        },
      },

      // Freestyle's native pause freezes the VM with its memory, and `start`
      // resumes it exactly. Default sandboxes are kept for a few minutes after
      // a pause; only `ephemeral: true` ones (deleted on stop) can't pause.
      pause: async (sandbox: Vm): Promise<void> => {
        await sandbox.pause();
      },
      resume: async (sandbox: Vm): Promise<void> => {
        await sandbox.start();
      },
      // Live-checked: files in /tmp and /root and running processes survive.
      pauseCapabilities: { memory: true },

      getInstance: (sandbox: Vm): Vm => sandbox,
    },

    snapshot: {
      create: async (
        config: FreestyleConfig,
        sandboxId: string,
        options?: CreateSnapshotOptions,
      ): Promise<FreestyleSnapshot> => {
        const client = clientFor(resolveConfig(config));
        // Freestyle snapshots carry no free-form metadata, so `options.metadata`
        // has nowhere to go; `name` becomes the snapshot's display name.
        const { snapshot } = await client.vms
          .ref(sandboxId)
          .snapshot(options?.name ? { displayName: options.name } : undefined);
        return toSnapshot(snapshot);
      },

      list: async (
        config: FreestyleConfig,
        options?: ListSnapshotsOptions,
      ): Promise<FreestyleSnapshot[]> => {
        const client = clientFor(resolveConfig(config));
        const { snapshots } = await client.vms.snapshots.list({
          sourceVmId: options?.sandboxId,
          limit: options?.limit ?? SNAPSHOT_PAGE_SIZE,
        });
        return snapshots.map(toSnapshot);
      },

      delete: async (config: FreestyleConfig, snapshotId: string) => {
        const client = clientFor(resolveConfig(config));
        await client.vms.snapshots.delete(snapshotId);
      },

      // A Freestyle snapshot captures the whole VM, memory and disk, and
      // leaves the source running. Live-checked: the whole ext4 rootfs (/tmp,
      // /root) and running processes survive a restore.
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false },
    },
  },
});

export type { Vm as FreestyleSandbox };
