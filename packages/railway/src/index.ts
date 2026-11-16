/**
 * Railway Provider - Factory-based Implementation
 *
 * Wraps Railway Sandboxes (https://docs.railway.com/sandboxes) using the
 * ComputeSDK provider factory. Commands run over `sandbox.exec`, files over
 * `sandbox.files`, and snapshots are Railway sandbox checkpoints (a named,
 * bootable copy of the sandbox's disk). Railway has no per-port URL API, so
 * `getUrl` throws.
 */

import {
  RailwayConnectionError,
  RailwayGraphQLError,
  Sandbox,
  SandboxFileNotFoundError,
  SandboxNotFoundError,
} from 'railway';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, RunCommandOptions, InstanceInfo } from '@computesdk/provider';
import type { CreateInstanceOptions, FileEntry, Snapshot } from 'computesdk';

type RailwaySandbox = Sandbox;

type CommandRunner = (
  sandbox: RailwaySandbox,
  command: string,
  options?: RunCommandOptions
) => Promise<CommandResult>;

/**
 * Railway-specific configuration options
 */
export interface RailwayConfig {
  /** Railway API token - falls back to the RAILWAY_API_TOKEN environment variable */
  token?: string;
  /** Railway environment ID - falls back to the RAILWAY_ENVIRONMENT_ID environment variable */
  environmentId?: string;
}

/** Native Railway resource overrides, applied when the sandbox is created. */
export interface RailwayResources {
  /** Positive vCPUs; fractional values are supported. */
  cpu?: number;
  /** Decimal GB (1 GB = 1,000,000,000 bytes), not GiB. */
  memoryGB?: number;
}

/** Validate before JSON serialization can turn NaN/Infinity into vendor defaults. */
function validateResources(resources: Record<string, unknown>): RailwayResources {
  const validated: RailwayResources = {};
  for (const key of ['cpu', 'memoryGB'] as const) {
    const value = resources[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new TypeError(`resources.${key} must be a positive finite number.`);
    }
    validated[key] = value;
  }
  return validated;
}

/** Options accepted by the Railway SDK's create/connect/list calls. */
interface RailwayClientOptions {
  token: string;
  environmentId?: string;
}

const DEFAULT_TIMEOUT_MS = 300000;

/**
 * Resolve and validate credentials, falling back to environment variables.
 * Throws a helpful error when the token is missing.
 */
function resolveClientOptions(config: RailwayConfig): RailwayClientOptions {
  const token =
    config.token || (typeof process !== 'undefined' ? process.env?.RAILWAY_API_TOKEN : undefined);

  if (!token) {
    throw new Error(
      'Missing Railway API token.\n\n' +
        'Create a token at https://railway.com/account/tokens\n' +
        "Then pass it: railway({ token: 'xxx' })\n" +
        'Or set RAILWAY_API_TOKEN in your environment.'
    );
  }

  const environmentId =
    config.environmentId ||
    (typeof process !== 'undefined' ? process.env?.RAILWAY_ENVIRONMENT_ID : undefined);

  return { token, environmentId };
}

/** Map Railway's sandbox status onto the ComputeSDK status enum. */
function mapStatus(status: string): InstanceInfo['status'] {
  switch (status) {
    case 'RUNNING':
    case 'CREATING':
      return 'running';
    case 'DESTROYING':
    case 'DESTROYED':
      return 'stopped';
    case 'FAILED':
      return 'error';
    default:
      return 'running';
  }
}

const DEFAULT_GRAPHQL_ENDPOINT = 'https://backboard.railway.com/graphql/v2';

/** How long a sandbox restored from a checkpoint may take to reach RUNNING. */
const RESTORE_READY_TIMEOUT_MS = 300000;

interface RailwayCheckpoint {
  id: string;
  key: string;
  environmentId: string;
  createdAt: string;
}

const CHECKPOINT_FIELDS = 'id key environmentId createdAt';

function requireEnvironmentId(client: RailwayClientOptions): string {
  if (!client.environmentId) {
    throw new Error(
      'Missing Railway environment ID.\n\n' +
        "Pass it: railway({ environmentId: 'xxx' })\n" +
        'Or set RAILWAY_ENVIRONMENT_ID in your environment.'
    );
  }
  return client.environmentId;
}

/**
 * Call Railway's public GraphQL API directly, for operations (checkpoints,
 * create-from-checkpoint) this version of the `railway` SDK does not wrap.
 */
async function railwayGraphQL<T>(
  client: RailwayClientOptions,
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const response = await fetch(DEFAULT_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${client.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json().catch(() => undefined)) as
    | { data?: T; errors?: Array<{ message?: string }> }
    | undefined;
  const errors = body?.errors ?? [];
  if (!response.ok || errors.length > 0 || !body?.data) {
    throw new RailwayGraphQLError({
      message: errors[0]?.message ?? `Railway GraphQL request failed with HTTP ${response.status}.`,
      status: response.status,
      errors: errors as never,
      responseBody: body,
    });
  }
  return body.data;
}

async function listCheckpoints(client: RailwayClientOptions): Promise<RailwayCheckpoint[]> {
  const data = await railwayGraphQL<{ sandboxCheckpoints: RailwayCheckpoint[] }>(
    client,
    `query RailwaySandboxCheckpoints($environmentId: String!) { sandboxCheckpoints(environmentId: $environmentId) { ${CHECKPOINT_FIELDS} } }`,
    { environmentId: requireEnvironmentId(client) }
  );
  return data.sandboxCheckpoints;
}

function toSnapshot(checkpoint: RailwayCheckpoint): Snapshot {
  return {
    // Sandboxes boot from a checkpoint by its name, so the name is the snapshot id.
    id: checkpoint.key,
    provider: 'railway',
    createdAt: new Date(checkpoint.createdAt),
    metadata: { checkpointId: checkpoint.id, environmentId: checkpoint.environmentId },
  };
}

/** Wait for a sandbox to reach RUNNING, as `Sandbox.create` does for fresh ones. */
async function waitForRunning(sandbox: RailwaySandbox): Promise<RailwaySandbox> {
  const deadline = Date.now() + RESTORE_READY_TIMEOUT_MS;
  let delay = 250;
  while (sandbox.status !== 'RUNNING') {
    if (['FAILED', 'DESTROYING', 'DESTROYED'].includes(sandbox.status)) {
      throw new Error(`Railway sandbox ${sandbox.id} reached ${sandbox.status} before RUNNING`);
    }
    if (Date.now() > deadline) {
      throw new Error(`Railway sandbox ${sandbox.id} was not RUNNING after ${RESTORE_READY_TIMEOUT_MS}ms (status ${sandbox.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 2000);
    await sandbox.refresh();
  }
  return sandbox;
}

/**
 * The installed SDK does not forward resource overrides. Use the public
 * sandboxCreate mutation for sized creates and named checkpoint restores.
 */
async function createThroughAPI(
  client: RailwayClientOptions,
  options?: CreateInstanceOptions
): Promise<RailwaySandbox> {
  const resources = options?.resources === undefined
    ? undefined
    : validateResources(options.resources);
  const data = await railwayGraphQL<{ sandboxCreate: { id: string } }>(
    client,
    'mutation RailwaySandboxCreate($input: SandboxCreateInput!) { sandboxCreate(input: $input) { id status } }',
    {
      input: {
        environmentId: requireEnvironmentId(client),
        ...(options?.snapshotId ? { template: { name: options.snapshotId } } : {}),
        ...(resources === undefined ? {} : { resources }),
        ...(options?.envs ? { variables: options.envs } : {}),
        ...(options?.idleTimeoutMinutes !== undefined
          ? { idleTimeoutMinutes: options.idleTimeoutMinutes }
          : {}),
        ...(options?.networkIsolation !== undefined
          ? { networkIsolation: options.networkIsolation }
          : {}),
      },
    }
  );
  return waitForRunning(await Sandbox.connect(data.sandboxCreate.id, client));
}

/** Valid POSIX shell environment variable name. Keys cannot be quoted in an
 * assignment prefix, so anything outside this set is rejected rather than escaped. */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Quote a string as one POSIX shell word. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Validate env names and apply the background option. `env` and `cwd` go to
 * `sandbox.exec`, which runs the command as `cd <cwd> && K=v sh -c '<command>'`
 * so the variables reach every part of a compound command.
 */
function composeCommand(command: string, options?: RunCommandOptions): string {
  for (const k of Object.keys(options?.env ?? {})) {
    if (!ENV_KEY_PATTERN.test(k)) {
      throw new Error(
        `Invalid environment variable name "${k}". Names must match ${ENV_KEY_PATTERN}.`
      );
    }
  }

  if (options?.background) {
    return `nohup sh -c ${shellQuote(command)} > /dev/null 2>&1 &`;
  }

  return command;
}

/** How long to wait for the exit after a timeout kill before giving up on the stream. */
const KILL_GRACE_MS = 5000;

/** Attempts for an exec whose session never opened (the command did not start). */
const EXEC_CONNECT_ATTEMPTS = 5;

/**
 * Whether an exec failed before the command was sent: the exec WebSocket never
 * opened, or minting its shell token hit a rate limit or server error. Either
 * way nothing ran in the sandbox, so trying again cannot run it twice.
 */
function isRetryableExecError(error: unknown): boolean {
  if (error instanceof RailwayConnectionError) {
    return /exec WebSocket (connection failed|closed before opening)/.test(error.message);
  }
  if (error instanceof RailwayGraphQLError) {
    return error.status === 429 || error.status >= 500;
  }
  return false;
}

/**
 * Run a composed command through `sandbox.exec`, forwarding live output.
 *
 * The SDK's own `timeoutSec` only closes the client's session, which can leave
 * the command running in the sandbox, so the deadline here kills the process
 * group instead. The deadline covers the command's run, so it restarts when a
 * session that never opened is retried.
 */
async function execCommand(
  sandbox: RailwaySandbox,
  fullCommand: string,
  options?: RunCommandOptions
): Promise<CommandResult> {
  const startTime = Date.now();

  for (let attempt = 1; ; attempt += 1) {
    const handle = sandbox.exec(fullCommand, {
      ...(options?.env && Object.keys(options.env).length > 0
        ? { env: Object.fromEntries(Object.entries(options.env).map(([k, v]) => [k, String(v)])) }
        : {}),
      ...(options?.cwd ? { cwd: options.cwd } : {}),
      ...(options?.onStdout ? { onStdout: options.onStdout } : {}),
      ...(options?.onStderr ? { onStderr: options.onStderr } : {}),
    });

    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeout) {
      killTimer = setTimeout(() => {
        timedOut = true;
        void handle.kill('KILL').catch(() => false);
        graceTimer = setTimeout(() => {
          void handle.detach().catch(() => undefined);
        }, KILL_GRACE_MS);
      }, options.timeout);
    }

    try {
      const result = await handle;
      const stderr = timedOut
        ? `${result.stderr}${result.stderr && !result.stderr.endsWith('\n') ? '\n' : ''}Command timed out after ${options?.timeout}ms`
        : result.stderr;
      return {
        stdout: result.stdout,
        stderr,
        // exitCode is -1 or null when a signal ended the command
        exitCode: timedOut ? 124 : (result.exitCode ?? -1),
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      // A session that never opened ran nothing, even if the deadline fired while it was connecting.
      if (attempt >= EXEC_CONNECT_ATTEMPTS || !isRetryableExecError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    } finally {
      if (killTimer) clearTimeout(killTimer);
      if (graceTimer) clearTimeout(graceTimer);
    }
  }
}

/**
 * Whether a `sandbox.files` call failed before its request reached the sandbox
 * (the files WebSocket never opened, or minting its token was throttled). The
 * calls wrapped here are idempotent, so retrying is safe.
 */
function isRetryableFilesError(error: unknown): boolean {
  if (error instanceof RailwayConnectionError) {
    return /files WebSocket (connection failed|closed before opening)/.test(error.message);
  }
  if (error instanceof RailwayGraphQLError) {
    return error.status === 429 || error.status >= 500;
  }
  return false;
}

async function withFilesRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= EXEC_CONNECT_ATTEMPTS || !isRetryableFilesError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
}

export const railway = defineProvider<RailwaySandbox, RailwayConfig>({
  name: 'railway',
  methods: {
    instances: {
      create: async (config: RailwayConfig, options?: CreateInstanceOptions) => {
        const client = resolveClientOptions(config);

        try {
          if (options?.snapshotId || options?.resources !== undefined) {
            const sandbox = await createThroughAPI(client, options);
            return { instance: sandbox, instanceId: sandbox.id };
          }
          const sandbox = await Sandbox.create({
            token: client.token,
            environmentId: client.environmentId,
            ...(options?.envs ? { env: options.envs } : {}),
            ...(options?.idleTimeoutMinutes !== undefined
              ? { idleTimeoutMinutes: options.idleTimeoutMinutes }
              : {}),
            ...(options?.networkIsolation !== undefined
              ? { networkIsolation: options.networkIsolation }
              : {}),
          });

          return { instance: sandbox, instanceId: sandbox.id };
        } catch (error) {
          throw new Error(
            `Failed to create Railway sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: RailwayConfig, sandboxId: string) => {
        const client = resolveClientOptions(config);
        try {
          const sandbox = await Sandbox.connect(sandboxId, client);
          return { instance: sandbox, instanceId: sandboxId };
        } catch (error) {
          // Only a missing sandbox maps to null; surface auth/network/config errors.
          if (error instanceof SandboxNotFoundError) return null;
          throw error;
        }
      },

      list: async (config: RailwayConfig) => {
        const client = resolveClientOptions(config);
        try {
          const infos = await Sandbox.list(client);
          const connected = await Promise.allSettled(
            infos.map(async (info) => {
              const sandbox = await Sandbox.connect(info.id, client);
              return { instance: sandbox, instanceId: info.id };
            })
          );
          return connected
            .filter(
              (r): r is PromiseFulfilledResult<{ instance: RailwaySandbox; instanceId: string }> =>
                r.status === 'fulfilled'
            )
            .map((r) => r.value);
        } catch {
          return [];
        }
      },

      destroy: async (config: RailwayConfig, sandboxId: string) => {
        const client = resolveClientOptions(config);
        try {
          const sandbox = await Sandbox.connect(sandboxId, client);
          await sandbox.destroy();
        } catch {
          /* already destroyed or unreachable */
        }
      },

      runCommand: async (
        sandbox: RailwaySandbox,
        command: string,
        options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          return await execCommand(sandbox, composeCommand(command, options), options);
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      // `sandbox.exec` streams every command over a WebSocket, so chunks reach
      // the callbacks while the command runs.
      streamCommand: async (
        sandbox: RailwaySandbox,
        command: string,
        options: RunCommandOptions
      ): Promise<CommandResult> => execCommand(sandbox, composeCommand(command, options), options),

      getInfo: async (sandbox: RailwaySandbox): Promise<InstanceInfo> => ({
        id: sandbox.id,
        provider: 'railway',
        status: mapStatus(sandbox.status),
        createdAt: new Date(sandbox.createdAt),
        timeout: DEFAULT_TIMEOUT_MS,
        metadata: { networkIsolation: sandbox.networkIsolation },
      }),

      getUrl: async (_sandbox: RailwaySandbox, _options: { port: number; protocol?: string }): Promise<string> => {
        throw new Error(
          'Railway sandboxes do not support exposing ports / public URLs. ' +
            'Use sandbox-to-sandbox networking within a Railway environment instead.'
        );
      },

      filesystem: {
        readFile: async (sandbox: RailwaySandbox, path: string): Promise<string> => {
          try {
            return await withFilesRetry(() => sandbox.files.read(path));
          } catch (error) {
            if (error instanceof SandboxFileNotFoundError) throw new Error(`File not found: ${path}`);
            throw error;
          }
        },

        writeFile: async (sandbox: RailwaySandbox, path: string, content: string): Promise<void> => {
          await withFilesRetry(() => sandbox.files.write(path, content));
        },

        mkdir: async (sandbox: RailwaySandbox, path: string): Promise<void> => {
          await withFilesRetry(() => sandbox.files.mkdir(path));
        },

        readdir: async (sandbox: RailwaySandbox, path: string): Promise<FileEntry[]> => {
          const entries = await withFilesRetry(() => sandbox.files.list(path));
          return entries
            .filter((entry) => entry.name && entry.name !== '.' && entry.name !== '..')
            .map((entry) => ({
              name: entry.name,
              type: entry.isDir ? ('directory' as const) : ('file' as const),
              size: entry.size,
              modified: entry.modTime ? new Date(entry.modTime) : new Date(),
            }));
        },

        exists: async (sandbox: RailwaySandbox, path: string): Promise<boolean> =>
          withFilesRetry(() => sandbox.files.exists(path)),

        // `files.remove` only deletes files and empty directories; removal is recursive here.
        remove: async (sandbox: RailwaySandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          const result = await runCommand(sandbox, `rm -rf "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) throw new Error(`Failed to remove ${path}: ${result.stderr}`);
        },
      },

      getInstance: (sandbox: RailwaySandbox): RailwaySandbox => sandbox,
    },

    snapshot: {
      // A checkpoint copies the sandbox's whole disk while the source keeps
      // running; a sandbox booted from it starts fresh, so processes are not kept.
      capabilities: { scope: 'rootfs', memory: false, destroysSource: false },

      create: async (
        config: RailwayConfig,
        sandboxId: string,
        options?: { name?: string }
      ): Promise<Snapshot> => {
        const client = resolveClientOptions(config);
        const name =
          options?.name?.trim() || `computesdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const data = await railwayGraphQL<{ sandboxCheckpointCreate: RailwayCheckpoint }>(
          client,
          `mutation RailwaySandboxCheckpointCreate($environmentId: String!, $name: String!, $sandboxId: String!) { sandboxCheckpointCreate(environmentId: $environmentId, name: $name, sandboxId: $sandboxId) { ${CHECKPOINT_FIELDS} } }`,
          { environmentId: requireEnvironmentId(client), name, sandboxId }
        );
        return toSnapshot(data.sandboxCheckpointCreate);
      },

      list: async (config: RailwayConfig): Promise<Snapshot[]> =>
        (await listCheckpoints(resolveClientOptions(config))).map(toSnapshot),

      delete: async (config: RailwayConfig, snapshotId: string): Promise<void> => {
        const client = resolveClientOptions(config);
        const checkpoint = (await listCheckpoints(client)).find(
          (c) => c.key === snapshotId || c.id === snapshotId
        );
        if (!checkpoint) return;
        await railwayGraphQL(
          client,
          'mutation RailwaySandboxCheckpointDelete($environmentId: String!, $id: ID!) { sandboxCheckpointDelete(environmentId: $environmentId, id: $id) }',
          { environmentId: requireEnvironmentId(client), id: checkpoint.id }
        );
      },
    },
  },
});

export type { Sandbox as RailwaySandbox } from 'railway';
