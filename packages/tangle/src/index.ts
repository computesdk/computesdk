/**
 * Tangle Sandbox provider for ComputeSDK, a thin adapter over @tangle-network/sandbox.
 */

import { createHash, randomUUID } from 'node:crypto';
import { NotFoundError, Sandbox, SandboxError, type CreateSandboxOptions, type SandboxInstance, type SandboxStatus } from '@tangle-network/sandbox';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type { CommandResult, CreateInstanceOptions, FileEntry, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

const DEFAULT_BASE_URL = 'https://sandbox.tangle.tools';
/** The most the runtime allows per command; the SDK accepts whole ms from 100 to 600000 and defaults to 30 s. */
const EXEC_TIMEOUT_MS = 600_000;
/** Every status `getById` returns; `deleted` records are history. */
const LISTED_STATUSES: SandboxStatus[] = ['pending', 'provisioning', 'running', 'stopped', 'failed', 'expired'];
/** Statuses a sandbox does not leave for `running` on its own. */
const ENDED = new Set<SandboxStatus>(['stopped', 'expired', 'deleted']);
/** 503 codes the SDK gives up on when no host has room; such a refusal allocated nothing. */
const NO_ROOM = new Set<string>(['CAPACITY_EXHAUSTED', 'HOST_PRESSURE']);

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
  const apiKey = (config.apiKey || env('TANGLE_API_KEY'))?.trim();
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
  // A saved template brings its own image, so the configured default image does not override it.
  const environment = options.image ?? (options.templateId === undefined ? config.image : undefined);
  const cpuCores = options.cpu ?? config.cpu;
  const memoryMB = options.memory ?? config.memory;
  const diskGB = options.disk ?? config.disk;
  const timeout = options.timeout ?? config.timeout;
  // Always keyed, so a create whose outcome is unknown can be joined. The default name comes from the
  // key, so a create sent again with the same key carries the same body.
  const idempotencyKey = typeof options.idempotencyKey === 'string' ? options.idempotencyKey : randomUUID();
  return {
    name: options.name ?? `computesdk-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 8)}`,
    agent: false,
    ...(environment !== undefined ? { environment } : {}),
    ...(options.templateId !== undefined ? { templateId: options.templateId } : {}),
    ...(cpuCores !== undefined || memoryMB !== undefined || diskGB !== undefined
      ? { resources: { cpuCores, memoryMB, diskGB } } : {}),
    ...(timeout !== undefined ? { maxLifetimeSeconds: Math.ceil(timeout / 1000) } : {}),
    ...(options.ephemeral !== undefined ? { ephemeral: options.ephemeral } : {}),
    ...(options.envs ? { env: options.envs } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
    idempotencyKey,
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

/** Deletes a sandbox that did not start, keeping the start failure as the error. */
async function discard(sdk: Sandbox, id: string, failure: unknown): Promise<void> {
  await remove(sdk, id).catch((cleanup: unknown) => {
    const message = `Tangle sandbox ${id} did not start (${String(failure)}) and was not deleted (${String(cleanup)}).`;
    throw Object.assign(new Error(message), { cause: failure });
  });
}

/** Only a refusal shows a failed create left nothing behind; without a sandbox id, anything else is unknown. */
function outcomeUnknown(error: unknown): boolean {
  if (!(error instanceof SandboxError)) return true;
  if (error.allocationId !== undefined || error.createFailureDisposition === 'not-admitted' || NO_ROOM.has(error.code)) return false;
  return !(error.status >= 400 && error.status < 500 && !error.retryable);
}

/** Sends the create once more when its outcome is unknown; the same idempotency key joins the first attempt. */
async function admit(sdk: Sandbox, request: CreateSandboxOptions): Promise<SandboxInstance> {
  try {
    return await sdk.create(request);
  } catch (error) {
    if (!outcomeUnknown(error)) throw error;
    return sdk.create(request).catch((joined: unknown) => {
      // Keep the first failure reachable when the second fails too, unless the second carries its own cause.
      if (joined instanceof Error && !('cause' in joined)) Object.assign(joined, { cause: error });
      throw joined;
    });
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
        // A rejected create returns no id, so the caller could never delete what it left behind. With a
        // caller's key the platform can return a sandbox another call allocated, so delete only one under
        // the provider's own key or one the platform says this call created.
        const owned = (receipt: { outcome: string } | null | undefined): boolean =>
          typeof options.idempotencyKey !== 'string' || receipt?.outcome === 'created';
        let sandbox: SandboxInstance;
        try {
          sandbox = await admit(sdk, request);
        } catch (error) {
          // The SDK names the sandbox a failed readiness wait leaves behind.
          if (error instanceof SandboxError && error.allocationId !== undefined && owned(error.createReceipt)) {
            await discard(sdk, error.allocationId, error);
          }
          throw error;
        }
        try {
          if (ENDED.has(sandbox.status)) throw new Error(`Tangle sandbox ${sandbox.id} is ${sandbox.status}.`);
          // create() waits only while pending or provisioning; this also waits for the filesystem.
          await sandbox.waitFor('running');
        } catch (error) {
          if (owned(sandbox.createReceipt())) await discard(sdk, sandbox.id, error);
          throw error;
        }
        // The factory destroys an instance whose create resolves after an abort, so keep one this call
        // did not create from reaching it.
        if (options.signal?.aborted && !owned(sandbox.createReceipt())) {
          throw new Error(`Create aborted; Tangle sandbox ${sandbox.id} may belong to another create with this idempotencyKey, so it is left running.`);
        }
        return { instance: sandbox, instanceId: sandbox.id };
      },

      getById: async (config, instanceId) => {
        const sandbox = await client(config).get(instanceId);
        return sandbox && sandbox.status !== 'deleted' ? { instance: sandbox, instanceId: sandbox.id } : null;
      },

      // Without a limit the API returns every match, so one request lists every sandbox not deleted.
      list: async (config) =>
        (await client(config).list({ status: LISTED_STATUSES })).map((sandbox) => ({ instance: sandbox, instanceId: sandbox.id })),

      destroy: async (config, instanceId) => remove(client(config), instanceId),

      runCommand: async (sandbox, command, options: RunCommandOptions = {}): Promise<CommandResult> => {
        const start = Date.now();
        // The runtime's cwd field only accepts paths inside the workspace, so change directory in the shell.
        const script = options.cwd ? `cd "${escapeShellArg(options.cwd)}" || exit $?\n${command}` : command;
        if (options.background) {
          // 0 is no limit: a background command runs until it exits or the sandbox stops.
          await sandbox.process.spawn(script, { env: options.env, timeoutMs: options.timeout ?? 0 });
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
          // Each start or resume begins a new lifetime interval.
          timeout: sandbox.expiresAt ? Math.max(0, sandbox.expiresAt.getTime() - (sandbox.startedAt ?? sandbox.createdAt).getTime()) : 0,
          metadata: { ...sandbox.metadata, name: sandbox.name, resources: sandbox.resources },
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
