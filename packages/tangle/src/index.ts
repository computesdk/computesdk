/**
 * Tangle Sandbox provider for ComputeSDK, a thin adapter over @tangle-network/sandbox.
 */

import { randomUUID } from 'node:crypto';
import { NotFoundError, Sandbox, type CreateSandboxOptions, type SandboxInstance } from '@tangle-network/sandbox';
import { defineProvider } from '@computesdk/provider';
import type { CommandResult, CreateInstanceOptions, FileEntry, InstanceInfo, RunCommandOptions } from '@computesdk/provider';

const DEFAULT_BASE_URL = 'https://sandbox.tangle.tools';

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

const clients = new Map<string, Sandbox>();

/** One SDK client per key and endpoint; credentials are checked when a call needs them. */
function client(config: TangleConfig): Sandbox {
  const apiKey = (config.apiKey ?? env('TANGLE_API_KEY'))?.trim();
  if (!apiKey) {
    throw new Error(
      'Missing Tangle API key.\n\n' +
      'Create a key at https://sandbox.tangle.tools\n' +
      'Then pass it: tangle({ apiKey: "sk-tan-..." })\n' +
      'Or set TANGLE_API_KEY in your environment.',
    );
  }
  const baseUrl = config.baseUrl ?? env('TANGLE_SANDBOX_BASE_URL') ?? DEFAULT_BASE_URL;
  const cacheKey = `${baseUrl}\n${apiKey}`;
  let sdk = clients.get(cacheKey);
  if (!sdk) {
    sdk = new Sandbox({ apiKey, baseUrl });
    clients.set(cacheKey, sdk);
  }
  return sdk;
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
    ...(typeof options.idempotencyKey === 'string' ? { idempotencyKey: options.idempotencyKey } : {}),
  };
}

function status(sandbox: SandboxInstance): InstanceInfo['status'] {
  if (sandbox.status === 'running') return 'running';
  if (sandbox.status === 'failed') return 'error';
  return 'stopped';
}

export const tangle = defineProvider<SandboxInstance, TangleConfig>({
  name: 'tangle',
  methods: {
    instances: {
      create: async (config, options = {}) => {
        const sandbox = await client(config).create(createOptions(config, options), { signal: options.signal });
        if (sandbox.status !== 'running') await sandbox.waitFor('running');
        return { instance: sandbox, instanceId: sandbox.id };
      },

      getById: async (config, instanceId) => {
        const sandbox = await client(config).get(instanceId);
        return sandbox ? { instance: sandbox, instanceId: sandbox.id } : null;
      },

      list: async (config) => {
        const sdk = client(config);
        const all: Array<{ instance: SandboxInstance; instanceId: string }> = [];
        const limit = 100;
        for (let offset = 0; ; offset += limit) {
          const page = await sdk.list({ limit, offset });
          all.push(...page.map((sandbox) => ({ instance: sandbox, instanceId: sandbox.id })));
          if (page.length < limit) return all;
        }
      },

      destroy: async (config, instanceId) => {
        try {
          await client(config).delete(instanceId);
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
      },

      runCommand: async (sandbox, command, options: RunCommandOptions = {}): Promise<CommandResult> => {
        const start = Date.now();
        if (options.background) {
          await sandbox.process.spawn(command, { cwd: options.cwd, env: options.env });
          return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - start };
        }
        const result = await sandbox.exec(command, { cwd: options.cwd, env: options.env, timeoutMs: options.timeout });
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
