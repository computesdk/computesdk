/**
 * Run Cloud provider for ComputeSDK.
 *
 * Maps ComputeSDK's sandbox interface to the official `@run-cloud/sdk`
 * Firecracker microVM API.
 */

import { Client, RunCloudError } from '@run-cloud/sdk';
import type {
  Sandbox as NativeSandbox,
  SandboxTunnel as NativeTunnel,
  Snapshot as NativeSnapshot,
} from '@run-cloud/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  CommandResult,
  CreateSandboxOptions,
  CreateSnapshotOptions,
  FileEntry,
  ListSnapshotsOptions,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';

const DEFAULT_IMAGE = 'runcloud/agent-base';
const DEFAULT_COMMAND_TIMEOUT_MS = 300_000;
const DEFAULT_TUNNEL_TTL_SECONDS = 3_600;
/** Refresh a cached tunnel slightly before it expires. */
const TUNNEL_REFRESH_MARGIN_MS = 30_000;

export interface RunCloudConfig {
  /** API key. Falls back to RUN_CLOUD_API_KEY, then RUN_CLOUD_API_TOKEN. */
  apiKey?: string;
  /** API origin. Falls back to RUN_CLOUD_API_URL, then https://api.run.cloud. */
  apiUrl?: string;
  /** Custom fetch implementation, useful in proxies and tests. */
  fetch?: typeof fetch;
  /** Default OCI image registered with Run Cloud. */
  image?: string;
  /** Default vCPU allocation. Fractional values are supported. */
  cpu?: number;
  /** Default memory allocation in MiB. */
  memory?: number;
  /** Default writable disk quota in GiB. */
  disk?: number;
  /** Default automatic idle-pause delay in seconds. Set 0 to disable. */
  idlePauseSeconds?: number;
  /** Default sandbox lifetime in milliseconds. Set 0 to disable. */
  timeout?: number;
  /** Default region. */
  region?: string;
  /** Default organization ID. */
  orgId?: string;
  /** Default command timeout in milliseconds. */
  commandTimeout?: number;
  /** Lifetime of public port URLs in seconds. Defaults to one hour. */
  tunnelTtlSeconds?: number;
}

/**
 * Native Run Cloud handle returned by `sandbox.getInstance()`.
 *
 * The official SDK models sandboxes as records plus methods on `Client`, so
 * the handle keeps both together and refreshes `sandbox` in `getInfo()`.
 */
export interface RunCloudSandbox {
  readonly client: Client;
  sandbox: NativeSandbox;
  readonly commandTimeout: number;
  readonly getTunnelUrl: (port: number) => Promise<string>;
}

export interface RunCloudSnapshot {
  id: string;
  provider: 'run-cloud';
  createdAt: Date;
  metadata: Record<string, unknown>;
}

function env(name: string): string | undefined {
  const value = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  return value && value.trim() ? value.trim() : undefined;
}

function resolveApiKey(config: RunCloudConfig): string {
  const apiKey =
    config.apiKey ||
    env('RUN_CLOUD_API_KEY') ||
    env('RUN_CLOUD_API_TOKEN');
  if (!apiKey) {
    throw new Error(
      'Missing Run Cloud API key. Pass runCloud({ apiKey }) or set ' +
        'RUN_CLOUD_API_KEY (RUN_CLOUD_API_TOKEN is also supported).',
    );
  }
  return apiKey;
}

function createClient(config: RunCloudConfig): Client {
  return new Client({
    apiKey: resolveApiKey(config),
    apiUrl: config.apiUrl || env('RUN_CLOUD_API_URL'),
    fetch: config.fetch,
  });
}

function resolveTunnelTtlSeconds(config: RunCloudConfig): number {
  const ttlSeconds =
    optionalNumber(
      'tunnelTtlSeconds',
      config.tunnelTtlSeconds ?? DEFAULT_TUNNEL_TTL_SECONDS,
    ) ?? DEFAULT_TUNNEL_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400) {
    throw new Error(
      'Run Cloud tunnelTtlSeconds must be an integer from 60 to 86400.',
    );
  }
  return ttlSeconds;
}

async function openTunnel(
  client: Client,
  config: RunCloudConfig,
  sandboxId: string,
  port: number,
): Promise<NativeTunnel> {
  const tunnel = await client.sandboxes.openTunnel(sandboxId, port, {
    ttlSeconds: resolveTunnelTtlSeconds(config),
  });
  if (
    typeof tunnel?.id !== 'string' ||
    typeof tunnel.url !== 'string' ||
    !tunnel.url.startsWith('https://') ||
    typeof tunnel.expiresAt !== 'string'
  ) {
    throw new Error('Run Cloud tunnel creation returned an invalid response.');
  }
  return tunnel;
}

function isNotFound(error: unknown): boolean {
  return (
    (error instanceof RunCloudError && error.status === 404) ||
    (
      error !== null &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: unknown }).status === 404
    )
  );
}

function millisecondsToSeconds(
  name: string,
  value: unknown,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Run Cloud ${name} must be a non-negative number of milliseconds.`);
  }
  return value === 0 ? 0 : Math.max(1, Math.ceil(value / 1_000));
}

function optionalNumber(
  name: string,
  value: unknown,
  options: { allowZero?: boolean } = {},
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const minimum = options.allowZero ? 0 : Number.MIN_VALUE;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    const qualifier = options.allowZero ? 'non-negative' : 'positive';
    throw new Error(`Run Cloud ${name} must be a ${qualifier} number.`);
  }
  return value;
}

function optionalString(name: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Run Cloud ${name} must be a non-empty string.`);
  }
  return value;
}

function generatedIdempotencyKey(): string {
  return `computesdk_${globalThis.crypto.randomUUID()}`;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Run Cloud sandbox creation was aborted.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

function makeHandle(
  client: Client,
  sandbox: NativeSandbox,
  config: RunCloudConfig,
): RunCloudSandbox {
  const tunnels = new Map<number, Promise<NativeTunnel>>();
  return {
    client,
    sandbox,
    commandTimeout: config.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
    getTunnelUrl: async (port) => {
      let pending = tunnels.get(port);
      if (pending) {
        const existing = await pending;
        if (
          new Date(existing.expiresAt).getTime() >
          Date.now() + TUNNEL_REFRESH_MARGIN_MS
        ) {
          return existing.url;
        }
        tunnels.delete(port);
        // Active tunnels are capped per sandbox and per organization, so
        // release the expiring one rather than waiting out its TTL.
        void client.sandboxes
          .closeTunnel(sandbox.id, existing.id)
          .catch(() => undefined);
      }
      pending = openTunnel(client, config, sandbox.id, port);
      tunnels.set(port, pending);
      try {
        return (await pending).url;
      } catch (error) {
        tunnels.delete(port);
        throw error;
      }
    },
  };
}

function createOptions(
  config: RunCloudConfig,
  options?: CreateSandboxOptions,
) {
  if (options?.envs && Object.keys(options.envs).length > 0) {
    throw new Error(
      'Run Cloud does not support sandbox-level envs yet. ' +
        'Pass environment variables to sandbox.runCommand(..., { env }).',
    );
  }

  const providerOptions = options as Record<string, unknown> | undefined;
  const timeoutSeconds =
    providerOptions?.timeoutSeconds === undefined
      ? millisecondsToSeconds('timeout', options?.timeout ?? config.timeout)
      : optionalNumber('timeoutSeconds', providerOptions.timeoutSeconds, {
          allowZero: true,
        });

  return {
    image: options?.image || options?.templateId || config.image || DEFAULT_IMAGE,
    cpu: optionalNumber('cpu', options?.cpu ?? config.cpu),
    memory: optionalNumber('memory', options?.memory ?? config.memory),
    disk: optionalNumber('disk', providerOptions?.disk ?? config.disk),
    idlePauseSeconds: optionalNumber(
      'idlePauseSeconds',
      providerOptions?.idlePauseSeconds ?? config.idlePauseSeconds,
      { allowZero: true },
    ),
    timeoutSeconds,
    region: options?.region ?? config.region,
    name: options?.name,
    orgId: optionalString('orgId', providerOptions?.orgId ?? config.orgId),
    idempotencyKey: optionalString(
      'idempotencyKey',
      providerOptions?.idempotencyKey,
    ) ?? generatedIdempotencyKey(),
  };
}

function mapStatus(state: string): SandboxInfo['status'] {
  if (state === 'running') return 'running';
  if (state === 'interrupted' || state === 'failed') return 'error';
  return 'stopped';
}

/** Safely wrap a complete command for detached execution through `/bin/sh -c`. */
function singleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function snapshotDate(snapshot: NativeSnapshot): Date {
  const record = snapshot as Record<string, unknown>;
  const value = record.createdAt ?? record.created_at;
  return typeof value === 'string' || typeof value === 'number'
    ? new Date(value)
    : new Date();
}

function mapSnapshot(snapshot: NativeSnapshot): RunCloudSnapshot {
  return {
    id: snapshot.id,
    provider: 'run-cloud',
    createdAt: snapshotDate(snapshot),
    metadata: { ...(snapshot as Record<string, unknown>) },
  };
}

async function createSandbox(
  config: RunCloudConfig,
  options?: CreateSandboxOptions,
) {
  throwIfAborted(options?.signal);
  const client = createClient(config);
  let sandbox: NativeSandbox;

  if (options?.snapshotId) {
    sandbox = await client.snapshots.restore(options.snapshotId, {
      name: options.name,
      region: options.region ?? config.region,
    });
  } else {
    sandbox = await client.sandboxes.create(createOptions(config, options));
  }

  if (options?.signal?.aborted) {
    await client.sandboxes.destroy(sandbox.id).catch(() => undefined);
    throw abortError(options.signal);
  }

  return {
    sandbox: makeHandle(client, sandbox, config),
    sandboxId: sandbox.id,
  };
}

const _provider = defineProvider<
  RunCloudSandbox,
  RunCloudConfig,
  never,
  RunCloudSnapshot
>({
  name: 'run-cloud',
  methods: {
    sandbox: {
      create: createSandbox,

      getById: async (config, sandboxId) => {
        const client = createClient(config);
        try {
          const sandbox = await client.sandboxes.get(sandboxId);
          return {
            sandbox: makeHandle(client, sandbox, config),
            sandboxId,
          };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const sandboxes = await client.sandboxes.list({ state: 'running' });
        return sandboxes.map((sandbox) => ({
          sandbox: makeHandle(client, sandbox, config),
          sandboxId: sandbox.id,
        }));
      },

      destroy: async (config, sandboxId) => {
        try {
          await createClient(config).sandboxes.destroy(sandboxId);
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      },

      runCommand: async (
        handle,
        command,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startedAt = Date.now();
        const timeout = options?.timeout ?? handle.commandTimeout;
        const fullCommand = options?.background
          ? `nohup sh -c ${singleQuote(command)} >/dev/null 2>&1 &`
          : command;
        const result = await handle.client.sandboxes.exec(
          handle.sandbox.id,
          fullCommand,
          {
            cwd: options?.cwd,
            env: options?.env,
            timeoutSeconds: millisecondsToSeconds('command timeout', timeout),
          },
        );
        if (result.stdout && options?.onStdout) options.onStdout(result.stdout);
        if (result.stderr && options?.onStderr) options.onStderr(result.stderr);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: Date.now() - startedAt,
        };
      },

      getInfo: async (handle): Promise<SandboxInfo> => {
        handle.sandbox = await handle.client.sandboxes.get(handle.sandbox.id);
        const sandbox = handle.sandbox;
        return {
          id: sandbox.id,
          provider: 'run-cloud',
          status: mapStatus(sandbox.state),
          createdAt: sandbox.createdAt
            ? new Date(sandbox.createdAt)
            : new Date(),
          timeout: handle.commandTimeout,
          metadata: {
            state: sandbox.state,
            image: sandbox.image,
            region: sandbox.region,
            sizeClass: sandbox.sizeClass,
            milliCpu: sandbox.milliCpu,
            memMb: sandbox.memMb,
            hostId: sandbox.hostId,
            idlePauseSeconds: sandbox.idlePauseSeconds,
            timeoutSeconds: sandbox.timeoutSeconds,
            lastActiveAt: sandbox.lastActiveAt,
            stateChangedAt: sandbox.stateChangedAt,
          },
        };
      },

      getUrl: async (handle, options): Promise<string> =>
        handle.getTunnelUrl(options.port),

      getInstance: (handle): RunCloudSandbox => handle,

      filesystem: {
        readFile: async (handle, path): Promise<string> => {
          const bytes = await handle.client.sandboxes.readFile(
            handle.sandbox.id,
            path,
          );
          return new TextDecoder().decode(bytes);
        },

        writeFile: async (handle, path, content, runCommand): Promise<void> => {
          const encoded = Buffer.from(content, 'utf8').toString('base64');
          const quotedPath = `"${escapeShellArg(path)}"`;
          const result = await runCommand(
            handle,
            `mkdir -p "$(dirname ${quotedPath})" && ` +
              `printf '%s' "${encoded}" | base64 -d > ${quotedPath}`,
          );
          if (result.exitCode !== 0) {
            throw new Error(
              `Run Cloud writeFile failed for ${path}: ` +
                (result.stderr || `exit ${result.exitCode}`),
            );
          }
        },

        mkdir: async (handle, path, runCommand): Promise<void> => {
          const result = await runCommand(
            handle,
            `mkdir -p "${escapeShellArg(path)}"`,
          );
          if (result.exitCode !== 0) {
            throw new Error(
              `Run Cloud mkdir failed for ${path}: ` +
                (result.stderr || `exit ${result.exitCode}`),
            );
          }
        },

        readdir: async (handle, path, runCommand): Promise<FileEntry[]> => {
          const result = await runCommand(
            handle,
            `find "${escapeShellArg(path)}" -mindepth 1 -maxdepth 1 ` +
              `-printf '%f\\t%y\\t%s\\t%T@\\n'`,
          );
          if (result.exitCode !== 0) {
            throw new Error(
              `Run Cloud readdir failed for ${path}: ` +
                (result.stderr || `exit ${result.exitCode}`),
            );
          }
          return result.stdout
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const [name = '', kind = 'f', size = '0', modified = '0'] =
                line.split('\t');
              return {
                name,
                type: kind === 'd' ? 'directory' as const : 'file' as const,
                size: Number(size) || 0,
                modified: new Date((Number(modified) || 0) * 1_000),
              };
            });
        },

        exists: async (handle, path, runCommand): Promise<boolean> => {
          const result = await runCommand(
            handle,
            `test -e "${escapeShellArg(path)}"`,
          );
          return result.exitCode === 0;
        },

        remove: async (handle, path, runCommand): Promise<void> => {
          const result = await runCommand(
            handle,
            `rm -rf "${escapeShellArg(path)}"`,
          );
          if (result.exitCode !== 0) {
            throw new Error(
              `Run Cloud remove failed for ${path}: ` +
                (result.stderr || `exit ${result.exitCode}`),
            );
          }
        },
      },
    },

    snapshot: {
      create: async (
        config,
        sandboxId,
        options?: CreateSnapshotOptions,
      ): Promise<RunCloudSnapshot> => {
        const snapshot = await createClient(config).sandboxes.snapshot(
          sandboxId,
          { label: options?.name },
        );
        return mapSnapshot(snapshot);
      },

      list: async (
        config,
        options?: ListSnapshotsOptions,
      ): Promise<RunCloudSnapshot[]> => {
        const snapshots = await createClient(config).snapshots.list({
          sandboxId: options?.sandboxId,
        });
        const mapped = snapshots.map(mapSnapshot);
        return options?.limit === undefined
          ? mapped
          : mapped.slice(0, options.limit);
      },

      delete: async (config, snapshotId): Promise<void> => {
        try {
          await createClient(config).snapshots.delete(snapshotId);
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      },
    },
  },
});

export const runCloud = (config: RunCloudConfig = {}) => _provider(config);
