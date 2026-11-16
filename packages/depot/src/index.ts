/**
 * Depot Sandboxes provider for ComputeSDK, a thin adapter over @depot/sandbox.
 */

import { Code, ConnectError } from '@connectrpc/connect';
import { createClient, Sandbox, type Architecture, type CreateSandboxOpts, type DirEntry, type SandboxClient, type SandboxStatus } from '@depot/sandbox';
import { defineProvider } from '@computesdk/provider';
import type { CommandResult, CreateInstanceOptions, CreateSnapshotOptions, FileEntry, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

/** Statuses a sandbox does not leave on its own. */
const ENDED = new Set<SandboxStatus>(['finished', 'cancelled', 'failed']);
const LIVE_STATUSES: SandboxStatus[] = ['created', 'assigned', 'starting', 'running'];
const READY_POLL_MS = 1_000;
const DEFAULT_READY_TIMEOUT_MS = 300_000;

export interface DepotConfig {
  /** Depot token; falls back to DEPOT_TOKEN. */
  token?: string;
  /** Organization ID, required for org/service tokens; falls back to DEPOT_ORG_ID. */
  orgId?: string;
  /** API endpoint; defaults to https://api.depot.dev. */
  endpoint?: string;
  /** Default CPU architecture: `amd64` (default) or `arm64`. */
  architecture?: Architecture;
  /** Default image reference; must be a Depot snapshot image on registry.depot.dev. */
  image?: string;
  /** Default vCPUs (2 to 64). */
  vcpus?: number;
  /** Default memory in MB. */
  memoryMb?: number;
  /** Default disk in GB. */
  diskGb?: number;
  /** Default sandbox lifetime in milliseconds, rounded up to whole minutes (server default 2 h, max 24 h). */
  timeout?: number;
  /** How long `create` waits for the sandbox to reach `running`, in milliseconds (default 300000). */
  readyTimeout?: number;
}

/** A Depot snapshot surfaced as a ComputeSDK snapshot. */
export interface DepotSnapshot {
  id: string;
  provider: 'depot';
  createdAt: Date;
  metadata: {
    sourceSandboxId: string;
    sizeBytes: number;
    fileCount: number;
    architecture?: Architecture;
  } & Record<string, unknown>;
}

const env = (name: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[name] : undefined;

function client(config: DepotConfig): SandboxClient {
  const token = (config.token || env('DEPOT_TOKEN'))?.trim();
  if (!token) {
    throw new Error(
      'Missing Depot token: pass depot({ token }) or set DEPOT_TOKEN. ' +
        'Create one at https://depot.dev (organization settings > API tokens).',
    );
  }
  const orgID = config.orgId || env('DEPOT_ORG_ID');
  return createClient({ token, ...(orgID ? { orgID } : {}), ...(config.endpoint ? { endpoint: config.endpoint } : {}) });
}

const isNotFound = (error: unknown): boolean => ConnectError.from(error).code === Code.NotFound;

function createOptions(config: DepotConfig, options: CreateInstanceOptions): CreateSandboxOpts {
  if (options.runtime !== undefined) {
    throw new Error('Depot does not map runtime names; pass an image (a Depot snapshot image on registry.depot.dev).');
  }
  const image = options.image ?? options.templateId ?? config.image;
  const vcpus = options.vcpus ?? options.cpu ?? config.vcpus;
  const memoryMb = options.memoryMb ?? options.memory ?? config.memoryMb;
  const diskGb = config.diskGb;
  const timeout = options.timeout ?? config.timeout;
  return {
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(image !== undefined ? { runtime: { imageRef: image } } : {}),
    ...(vcpus !== undefined || memoryMb !== undefined || diskGb !== undefined ? { resources: { vcpus, memoryMb, diskGb } } : {}),
    ...(options.envs ? { env: options.envs } : {}),
    ...(timeout !== undefined ? { timeoutMinutes: Math.max(1, Math.ceil(timeout / 60_000)) } : {}),
    ...(config.architecture !== undefined ? { architecture: config.architecture } : {}),
    ...(options.snapshotId !== undefined ? { snapshot: options.snapshotId } : {}),
  };
}

/** Kills a sandbox unless it has already ended or is gone. */
async function remove(sdk: SandboxClient, id: string): Promise<void> {
  try {
    const sandbox = await Sandbox.get(sdk, id);
    if (sandbox.status && ENDED.has(sandbox.status)) return;
    await sandbox.kill();
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

/** `Sandbox.create` returns before boot, so poll until the sandbox is running. */
async function waitForRunning(sdk: SandboxClient, sandbox: Sandbox, timeoutMs: number): Promise<Sandbox> {
  const deadline = Date.now() + timeoutMs;
  let current = sandbox;
  while (current.status !== 'running') {
    if (current.status && ENDED.has(current.status)) {
      throw new Error(`Depot sandbox ${current.sandboxId} is ${current.status}${current.errorMessage ? `: ${current.errorMessage}` : ''}.`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Depot sandbox ${current.sandboxId} did not start within ${timeoutMs} ms (status ${current.status ?? 'unknown'}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
    current = await Sandbox.get(sdk, current.sandboxId);
  }
  return current;
}

function status(sandbox: Sandbox): InstanceInfo['status'] {
  if (sandbox.status === 'failed') return 'error';
  return sandbox.status && ENDED.has(sandbox.status) ? 'stopped' : 'running';
}

export const depot = defineProvider<Sandbox, DepotConfig, any, DepotSnapshot>({
  name: 'depot',
  methods: {
    instances: {
      create: async (config, options = {}) => {
        const sdk = client(config);
        const created = await Sandbox.create(sdk, createOptions(config, options));
        try {
          const sandbox = await waitForRunning(sdk, created, config.readyTimeout ?? DEFAULT_READY_TIMEOUT_MS);
          return { instance: sandbox, instanceId: sandbox.sandboxId };
        } catch (error) {
          await remove(sdk, created.sandboxId).catch(() => {});
          throw error;
        }
      },

      getById: async (config, instanceId) => {
        try {
          const sandbox = await Sandbox.get(client(config), instanceId);
          return { instance: sandbox, instanceId: sandbox.sandboxId };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },

      list: async (config) => {
        const result: { instance: Sandbox; instanceId: string }[] = [];
        for await (const sandbox of Sandbox.listAll(client(config), { filter: { states: LIVE_STATUSES } })) {
          result.push({ instance: sandbox, instanceId: sandbox.sandboxId });
        }
        return result;
      },

      destroy: async (config, instanceId) => remove(client(config), instanceId),

      runCommand: async (sandbox, command, options: RunCommandOptions = {}): Promise<CommandResult> => {
        const start = Date.now();
        const execution = await sandbox.runCommand({
          cmd: '/bin/sh',
          args: ['-c', command],
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.env ? { env: options.env } : {}),
          detached: options.background === true,
        });
        if (options.background) {
          return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - start };
        }
        // Read both streams from the start while the command runs, so no early output is dropped.
        const [stdout, stderr, finished] = await Promise.all([execution.stdout(), execution.stderr(), execution.wait()]);
        return { stdout, stderr, exitCode: finished.exitCode, durationMs: Date.now() - start };
      },

      getInfo: async (sandbox): Promise<InstanceInfo> => {
        // The instance's fields are a snapshot from when it was fetched; re-read it with the client it holds.
        const fresh = await Sandbox.get(sandbox['client'], sandbox.sandboxId);
        const createdAt = fresh.createdAt ?? new Date();
        return {
          id: fresh.sandboxId,
          provider: 'depot',
          status: status(fresh),
          createdAt,
          timeout: fresh.expiresAt ? Math.max(0, fresh.expiresAt.getTime() - createdAt.getTime()) : 0,
          metadata: {
            name: fresh.name,
            depotStatus: fresh.status,
            organizationId: fresh.organizationId,
            architecture: fresh.architecture,
            resources: fresh.resources,
          },
        };
      },

      getUrl: async () => {
        throw new Error('Depot does not support public port URLs: the Depot sandbox SDK has no port-exposure API.');
      },

      getInstance: (sandbox) => sandbox,

      filesystem: {
        readFile: async (sandbox, path) => (await sandbox.fs().readFile(path, { encoding: 'utf8' })) as string,
        writeFile: (sandbox, path, content) => sandbox.fs().writeFile(path, content, { recursive: true }),
        mkdir: (sandbox, path) => sandbox.fs().mkdir(path, { recursive: true }),
        readdir: async (sandbox, path): Promise<FileEntry[]> => {
          const entries = (await sandbox.fs().readdir(path, { withFileTypes: true })) as DirEntry[];
          return entries.map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' }));
        },
        exists: (sandbox, path) => sandbox.fs().exists(path),
        remove: (sandbox, path) => sandbox.fs().rm(path, { recursive: true, force: true }),
      },
    },

    snapshot: {
      create: async (config, instanceId, options?: CreateSnapshotOptions): Promise<DepotSnapshot> => {
        const sandbox = await Sandbox.get(client(config), instanceId);
        const snapshot = await sandbox.snapshot();
        return {
          id: snapshot.snapshotId,
          provider: 'depot',
          createdAt: snapshot.createdAt ?? new Date(),
          metadata: {
            ...options?.metadata,
            sourceSandboxId: snapshot.sourceSandboxId,
            sizeBytes: snapshot.sizeBytes,
            fileCount: snapshot.fileCount,
            architecture: snapshot.architecture,
          },
        };
      },
      list: async () => {
        throw new Error('Depot does not support listing snapshots.');
      },
      delete: async () => {
        throw new Error('Depot does not support deleting snapshots.');
      },
    },
  },
});
