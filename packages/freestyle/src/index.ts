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
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
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
  /** Keep the VM (and its disk) after it stops instead of deleting it (default: ephemeral). */
  persistent?: boolean;
  /**
   * Outbound network policy. A Freestyle VM reaches nothing unless a rule says
   * so; the default allows all outbound so `npm`/`pip` work. Pass `{ rules: [] }`
   * for a sealed sandbox.
   */
  firewall?: FirewallSpec;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_IDLE_TIMEOUT_SECS = 300;
/** Ephemeral VMs are deleted when they stop; `-1` keeps them. */
const AUTO_DELETE_EPHEMERAL = 0;
const AUTO_DELETE_NEVER = -1;
/** Marks the VMs this provider creates, so `list` returns sandboxes rather than every VM on the account. */
const SANDBOX_METADATA_MARKER = 'computesdk';
/** Slug of the auto-baked runtime snapshot, so it is found and reused across processes. */
const RUNTIME_SNAPSHOT_SLUG = 'computesdk-freestyle-runtime';
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
 * The snapshot every sandbox boots from: the configured one if given, else a
 * Node + Python snapshot baked once and cached per (apiKey, baseUrl). The bake
 * is de-duplicated by an in-flight promise, and persisted across processes by
 * the snapshot's slug — a fresh process finds it and skips baking.
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

function isNotFound(error: unknown): boolean {
  return (
    error instanceof FreestyleApiError &&
    (error.code === 'NOT_FOUND' || (error as { status?: number }).status === 404)
  );
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
  methods: {
    sandbox: {
      // ── Collection operations (compute.sandbox.*) ──────────────────────
      create: async (config: FreestyleConfig, options?: CreateSandboxOptions) => {
        const resolved = resolveConfig(config);
        const client = clientFor(resolved);

        // Reconnect to an existing sandbox by id — no boot.
        if (options?.sandboxId) {
          return { sandbox: client.vms.ref(options.sandboxId), sandboxId: options.sandboxId };
        }

        const snapshotId =
          options?.snapshotId || options?.templateId || (await ensureSnapshot(resolved));
        try {
          const { vm, vmId } = await client.vms.create({
            snapshotId,
            autoDeleteSeconds: config.persistent ? AUTO_DELETE_NEVER : AUTO_DELETE_EPHEMERAL,
            automaticRestart: false,
            idleTimeoutSeconds: config.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_SECS,
            // Marker last, so a caller's own metadata can never overwrite it and
            // hide the sandbox from `list`.
            metadata: { ...(options?.metadata ?? {}), purpose: SANDBOX_METADATA_MARKER },
            firewall: config.firewall ?? ALLOW_ALL_OUTBOUND,
          });
          return { sandbox: vm, sandboxId: vmId };
        } catch (error) {
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
      },

      getById: async (config: FreestyleConfig, sandboxId: string) => {
        const client = clientFor(resolveConfig(config));
        try {
          // Confirm it exists (and is this account's) before handing back a handle.
          await client.vms.get(sandboxId);
          return { sandbox: client.vms.ref(sandboxId), sandboxId };
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
        return vms.map((vm) => ({ sandbox: client.vms.ref(vm.id), sandboxId: vm.id }));
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
          const result = await sandbox.exec({
            // Freestyle runs this through the guest's shell and applies env natively.
            command: buildCommand(command, options),
            linuxUser: RUNTIME_USER,
            env: options?.env,
            timeoutMs: options?.timeout ?? DEFAULT_TIMEOUT_MS,
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

      getInfo: async (sandbox: Vm): Promise<SandboxInfo> => {
        const data = await sandbox.data();
        const status: SandboxInfo['status'] =
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
    },
  },
});

export type { Vm as FreestyleSandbox };
