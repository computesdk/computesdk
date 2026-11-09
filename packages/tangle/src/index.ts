/**
 * Tangle Sandbox provider for ComputeSDK, a thin adapter over @tangle-network/sandbox.
 */

import { randomUUID } from 'node:crypto';
import { NotFoundError, Sandbox, SandboxError, type CreateSandboxOptions, type SandboxInstance, type SandboxStatus } from '@tangle-network/sandbox';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, CreateInstanceOptions, FileEntry, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

const DEFAULT_BASE_URL = 'https://sandbox.tangle.tools';
/** The runtime's per-command ceiling (whole ms, 100 to 600000); the SDK default would be 30 s. */
const EXEC_TIMEOUT_MS = 600_000;
/** Every status that still holds a sandbox; `expired` and `deleted` records are history. */
const LISTED_STATUSES: SandboxStatus[] = ['pending', 'provisioning', 'running', 'stopped', 'failed'];
/** Create failures that leave the request's outcome unknown, so a sandbox may exist. */
const UNKNOWN_CREATE_OUTCOME = new Set<string>(['TIMEOUT', 'NETWORK_ERROR']);

export interface TangleConfig {
  /** API key; falls back to TANGLE_API_KEY. */
  apiKey?: string;
  /** Sandbox API endpoint; falls back to TANGLE_SANDBOX_BASE_URL, then https://sandbox.tangle.tools. */
  baseUrl?: string;
  /** Default environment ID or OCI image reference, e.g. `node:22`. */
  image?: string;
  /** Default CPU cores. */
  cpu?: number;
  /** Default memory in MB. */
  memory?: number;
  /** Default disk in GB. */
  disk?: number;
  /** Default maximum sandbox lifetime in milliseconds. */
  timeout?: number;
}

const env = (name: string): string | undefined =>
  typeof process !== 'undefined' ? process.env?.[name] : undefined;

/** Credentials are checked when a call needs them; constructing the SDK client does no I/O. */
function client(config: TangleConfig): Sandbox {
  const apiKey = (config.apiKey ?? env('TANGLE_API_KEY'))?.trim();
  if (!apiKey) {
    throw new Error('Missing Tangle API key: pass tangle({ apiKey }) or set TANGLE_API_KEY. Create one at https://sandbox.tangle.tools.');
  }
  return new Sandbox({ apiKey, baseUrl: config.baseUrl || env('TANGLE_SANDBOX_BASE_URL') || DEFAULT_BASE_URL });
}

function createOptions(config: TangleConfig, options: CreateInstanceOptions): CreateSandboxOptions {
  if (options.snapshotId !== undefined) {
    throw new Error('The Tangle provider does not restore snapshots; use getInstance() for native snapshot APIs.');
  }
  if (options.runtime !== undefined) {
    throw new Error('Tangle does not map runtime names; select an image such as "node:22" or "python:3.12-slim".');
  }
  const environment = options.image ?? options.templateId ?? config.image;
  const cpuCores = options.cpu ?? config.cpu;
  const memoryMB = options.memory ?? config.memory;
  const diskGB = options.disk ?? config.disk;
  const timeout = options.timeout ?? config.timeout;
  return {
    name: options.name ?? `computesdk-${randomUUID().slice(0, 8)}`,
    agent: false,
    ...(environment !== undefined ? { environment } : {}),
    ...(cpuCores !== undefined || memoryMB !== undefined || diskGB !== undefined
      ? { resources: { cpuCores, memoryMB, diskGB } } : {}),
    ...(timeout !== undefined ? { maxLifetimeSeconds: Math.ceil(timeout / 1000) } : {}),
    ...(options.ephemeral !== undefined ? { ephemeral: options.ephemeral } : {}),
    ...(options.envs ? { env: options.envs } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
    // Always keyed, so a create whose outcome is unknown can be joined and cleaned up.
    idempotencyKey: typeof options.idempotencyKey === 'string' ? options.idempotencyKey : randomUUID(),
  };
}

/** A sandbox that is already gone counts as deleted. */
async function remove(sdk: Sandbox, id: string): Promise<void> {
  try {
    await sdk.delete(id);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
}

/**
 * The sandbox a failed create left behind, if any: the allocation the SDK names, or, when the outcome
 * is unknown (a timeout or network failure), the result of joining the request once by its key.
 */
async function leftover(sdk: Sandbox, request: CreateSandboxOptions, error: unknown): Promise<string | undefined> {
  if (!(error instanceof SandboxError)) return undefined;
  if (error.allocationId !== undefined) return error.allocationId;
  if (!UNKNOWN_CREATE_OUTCOME.has(error.catalogCode) || error.createFailureDisposition === 'not-admitted') return undefined;
  try {
    return (await sdk.create(request)).id;
  } catch (joined) {
    return joined instanceof SandboxError ? joined.allocationId : undefined;
  }
}

function status(sandbox: SandboxInstance): InstanceInfo['status'] {
  switch (sandbox.status) {
    case 'pending':
    case 'provisioning':
    case 'running':
      return 'running';
    case 'failed':
      return 'error';
    default:
      return 'stopped';
  }
}

export const tangle = defineProvider<SandboxInstance, TangleConfig>({
  name: 'tangle',
  methods: {
    instances: {
      create: async (config, options = {}) => {
        const sdk = client(config);
        const request = createOptions(config, options);
        let id: string | undefined;
        try {
          // create() waits for readiness itself. Abort is left to the factory, which destroys an
          // instance whose create resolves after an abort; an aborted request has no id to delete.
          const sandbox = await sdk.create(request);
          id = sandbox.id;
          if (sandbox.status !== 'running') await sandbox.waitFor('running');
          return { instance: sandbox, instanceId: sandbox.id };
        } catch (error) {
          // A rejected create returns no id, so the caller could never delete the sandbox.
          const allocated = id ?? (await leftover(sdk, request, error));
          if (allocated !== undefined) {
            await remove(sdk, allocated).catch((cleanup: unknown) => {
              const message = `Tangle sandbox ${allocated} did not start (${String(error)}) and was not deleted (${String(cleanup)}).`;
              throw Object.assign(new Error(message), { cause: error });
            });
          }
          throw error;
        }
      },

      getById: async (config, instanceId) => {
        const sandbox = await client(config).get(instanceId);
        return sandbox && sandbox.status !== 'deleted' ? { instance: sandbox, instanceId: sandbox.id } : null;
      },

      // Without a limit the API returns every match, so one request lists the live sandboxes.
      list: async (config) =>
        (await client(config).list({ status: LISTED_STATUSES })).map((sandbox) => ({ instance: sandbox, instanceId: sandbox.id })),

      destroy: (config, instanceId) => remove(client(config), instanceId),

      runCommand: async (sandbox, command, options: RunCommandOptions = {}): Promise<CommandResult> => {
        const start = Date.now();
        // The runtime's cwd field only accepts paths inside the workspace, so change directory in the shell.
        const script = options.cwd ? `cd "${escapeShellArg(options.cwd)}" || exit $?\n${command}` : command;
        if (options.background) {
          await sandbox.process.spawn(script, { env: options.env });
          return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - start };
        }
        const result = await sandbox.exec(script, { env: options.env, timeoutMs: options.timeout ?? EXEC_TIMEOUT_MS });
        return { ...result, durationMs: Date.now() - start };
      },

      getInfo: async (sandbox): Promise<InstanceInfo> => {
        await sandbox.refresh();
        return {
          id: sandbox.id,
          provider: 'tangle',
          status: status(sandbox),
          createdAt: sandbox.createdAt,
          timeout: sandbox.expiresAt ? Math.max(0, sandbox.expiresAt.getTime() - sandbox.createdAt.getTime()) : 0,
          metadata: { name: sandbox.name, resources: sandbox.resources, ...sandbox.metadata },
        };
      },

      getUrl: async (sandbox, { port, protocol }) => {
        const url = new URL(await sandbox.network.exposePort(port));
        if (protocol) url.protocol = `${protocol}:`;
        return url.toString();
      },

      getInstance: (sandbox) => sandbox,

      filesystem: {
        readFile: (sandbox, path) => sandbox.read(path),
        writeFile: async (sandbox, path, content) => { await sandbox.write(path, content); },
        mkdir: (sandbox, path) => sandbox.fs.mkdir(path, { recursive: true }),
        readdir: async (sandbox, path): Promise<FileEntry[]> => (await sandbox.fs.list(path)).map((entry) => ({
          name: entry.name,
          type: entry.isDir ? 'directory' : 'file',
          size: entry.size,
          modified: entry.modTime,
        })),
        exists: (sandbox, path) => sandbox.fs.exists(path),
        remove: (sandbox, path) => sandbox.fs.delete(path, { recursive: true }),
      },
    },
  },
});
