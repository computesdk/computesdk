/**
 * Render Provider - Factory-based Implementation
 *
 * Wraps the Render Sandboxes API (public beta) through the official `@renderinc/sdk`.
 * Commands stream over the SDK's exec endpoint (run through `bash -c`), files move with
 * the SDK's upload/download, and snapshots capture a running sandbox's filesystem and memory.
 */

import { ClientError, Render } from '@renderinc/sdk';
import type { Sandbox as RenderSandboxData, SandboxesClient, SandboxSnapshot } from '@renderinc/sdk';
import { defineProvider, escapeShellArg, ShellFileSystem } from '@computesdk/provider';
import type {
  CommandResult,
  CreateInstanceOptions,
  CreateSnapshotOptions,
  InstanceInfo,
  ListSnapshotsOptions,
  RunCommandOptions,
} from '@computesdk/provider';

type OwnerId = `tea-${string}`;

export interface RenderConfig {
  /** Render API key - falls back to the RENDER_API_KEY environment variable */
  apiKey?: string;
  /** Workspace ID (`tea-...`) - falls back to the RENDER_WORKSPACE_ID environment variable */
  workspaceId?: string;
  /** Sandbox group for new sandboxes and snapshot lookups - defaults to the workspace's default group */
  sandboxGroupId?: string;
  /** Default compute plan for new sandboxes, e.g. `2c-4g` - defaults to Render's `1c-2g` */
  plan?: string;
}

export interface RenderSandbox {
  id: string;
  data: RenderSandboxData;
  client: SandboxesClient;
  ownerId?: OwnerId;
}

/** Render's runtime timeout range for nonzero values, in seconds. */
const MIN_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 30 * 86400;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const ACTIVE_STATUSES = ['creating', 'running', 'suspending', 'suspended', 'resuming'] as const;

interface Client {
  client: SandboxesClient;
  ownerId?: OwnerId;
}

function resolveClient(config: RenderConfig): Client {
  const apiKey = config.apiKey || process.env.RENDER_API_KEY;
  if (!apiKey) {
    throw new Error(
      `Missing Render API key. Provide 'apiKey' in config or set the RENDER_API_KEY environment variable. ` +
        `Create one on your Account Settings page in the Render Dashboard (https://dashboard.render.com).`,
    );
  }
  const workspaceId = config.workspaceId || process.env.RENDER_WORKSPACE_ID;
  if (!workspaceId) {
    throw new Error(
      `Missing Render workspace ID. Provide 'workspaceId' in config or set the RENDER_WORKSPACE_ID environment ` +
        `variable. It is shown at the top of your workspace's Settings page in the Render Dashboard.`,
    );
  }
  const ownerId = workspaceId as OwnerId;
  return { client: new Render({ token: apiKey, ownerId }).sandboxes, ownerId };
}

const isNotFound = (error: unknown) => error instanceof ClientError && error.statusCode === 404;

const PAGE_SIZE = 100;

/** Follows Render's cursor pagination until a short page, `max` rows, or no cursor. */
async function paginate<T extends { cursor?: string }>(
  fetchPage: (cursor: string | undefined, limit: number) => Promise<T[]>,
  max = Infinity,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  while (rows.length < max) {
    const page = await fetchPage(cursor, PAGE_SIZE);
    rows.push(...page);
    cursor = page[page.length - 1]?.cursor;
    if (page.length < PAGE_SIZE || !cursor) break;
  }
  return rows.slice(0, max);
}

function toInstance(auth: Client, data: RenderSandboxData): RenderSandbox {
  return { id: data.id, data, client: auth.client, ownerId: auth.ownerId };
}

/** Maps ComputeSDK's create options onto Render's `sandboxes.create` input. */
export function createInput(config: RenderConfig, options: CreateInstanceOptions = {}) {
  const input: Record<string, unknown> = { wait: true };
  const sandboxGroupId = options.sandboxGroupId ?? config.sandboxGroupId;
  if (sandboxGroupId) input.sandboxGroupId = sandboxGroupId;
  const plan = options.plan ?? config.plan;
  if (plan) input.plan = plan;
  if (options.name) input.name = options.name;
  if (options.envs) input.env = options.envs;
  if (options.snapshotId) input.snapshotId = options.snapshotId;
  else if (options.image ?? options.templateId) input.image = options.image ?? options.templateId;
  if (typeof options.timeout === 'number' && options.timeout > 0) {
    input.timeoutSeconds = Math.min(MAX_TIMEOUT_S, Math.max(MIN_TIMEOUT_S, Math.ceil(options.timeout / 1000)));
  }
  if (typeof options.idleTimeoutSeconds === 'number') input.idleTimeoutSeconds = options.idleTimeoutSeconds;
  if (options.networkPolicy) input.networkPolicy = options.networkPolicy;
  return input;
}

/** Builds the `bash -c` script for a ComputeSDK command and its options. */
export function buildCommand(command: string, options?: RunCommandOptions): string {
  let cmd = command;
  if (options?.cwd) cmd = `cd "${escapeShellArg(options.cwd)}" || exit 1; ${cmd}`;
  if (options?.env) {
    const exports = Object.entries(options.env).map(([key, value]) => {
      if (!ENV_NAME.test(key)) throw new Error(`Invalid environment variable name: ${key}`);
      return `export ${key}="${escapeShellArg(value)}"`;
    });
    if (exports.length > 0) cmd = `${exports.join('; ')}; ${cmd}`;
  }
  if (options?.background) return `nohup bash -c "${escapeShellArg(cmd)}" >/dev/null 2>&1 &`;
  if (options?.timeout && options.timeout > 0) {
    // Disconnecting does not stop a Render command, so the deadline is enforced in the sandbox.
    const seconds = Math.max(1, Math.ceil(options.timeout / 1000));
    return `timeout -k 5 ${seconds} bash -c "${escapeShellArg(cmd)}"`;
  }
  return cmd;
}

async function execute(sandbox: RenderSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> {
  const start = Date.now();
  // The command is stopped in the sandbox at the deadline; the stream gets a grace period on top.
  const signal = options?.timeout && options.timeout > 0 && !options.background
    ? AbortSignal.timeout(options.timeout + 30_000)
    : undefined;
  const events = await sandbox.client.exec(sandbox.id, buildCommand(command, options), sandbox.ownerId, signal);
  let stdout = '';
  let stderr = '';
  let exitCode = -1;
  for await (const event of events) {
    if (event.type === 'output') {
      if (event.stream === 'stderr') {
        stderr += event.data;
        options?.onStderr?.(event.data);
      } else {
        stdout += event.data;
        options?.onStdout?.(event.data);
      }
    } else if (event.type === 'exit') {
      exitCode = event.exit_code;
    }
  }
  return { stdout, stderr, exitCode, durationMs: Date.now() - start };
}

function infoStatus(status: RenderSandboxData['status']): InstanceInfo['status'] {
  if (status === 'running') return 'running';
  if (status === 'errored') return 'error';
  // creating, suspending, suspended, resuming and terminated. A suspended sandbox resumes on its next command.
  return 'stopped';
}

async function resolveGroupId(config: RenderConfig, auth: Client): Promise<string> {
  if (config.sandboxGroupId) return config.sandboxGroupId;
  const groups = await paginate((cursor, limit) => auth.client.listGroups({ ownerId: auth.ownerId, cursor, limit }));
  const group = groups.find((g) => g.sandboxGroup.isDefault);
  if (!group) throw new Error('Render workspace has no default sandbox group; set `sandboxGroupId` in config.');
  return group.sandboxGroup.id;
}

function toSnapshot(snapshot: SandboxSnapshot) {
  return {
    id: snapshot.id,
    provider: 'render',
    createdAt: new Date(snapshot.capturedAt ?? snapshot.requestedAt),
    metadata: {
      name: snapshot.name ?? undefined,
      sandboxId: snapshot.sourceSandboxId,
      sandboxGroupId: snapshot.sandboxGroupId,
      kind: snapshot.kind,
      status: snapshot.status,
      plan: snapshot.plan,
      sizeBytes: snapshot.sizeBytes ?? undefined,
      expiresAt: snapshot.expiresAt,
    },
  };
}

type Runner = (sandbox: RenderSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

const shellFs = (sandbox: RenderSandbox, run: Runner) =>
  new ShellFileSystem((command, options) => run(sandbox, command, options));

export const render = defineProvider<RenderSandbox, RenderConfig>({
  name: 'render',
  methods: {
    instances: {
      create: async (config: RenderConfig, options?: CreateInstanceOptions) => {
        const auth = resolveClient(config);
        const data = await auth.client.create(createInput(config, options) as Parameters<SandboxesClient['create']>[0]);
        return { instance: toInstance(auth, data), instanceId: data.id };
      },

      getById: async (config: RenderConfig, instanceId: string) => {
        const auth = resolveClient(config);
        try {
          const data = await auth.client.get(instanceId, auth.ownerId);
          if (data.status === 'terminated') return null;
          return { instance: toInstance(auth, data), instanceId: data.id };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },

      list: async (config: RenderConfig) => {
        const auth = resolveClient(config);
        const rows = await paginate((cursor, limit) =>
          auth.client.list({
            ownerId: auth.ownerId,
            sandboxGroupId: config.sandboxGroupId,
            status: [...ACTIVE_STATUSES],
            cursor,
            limit,
          }),
        );
        return rows.map(({ sandbox }) => ({ instance: toInstance(auth, sandbox), instanceId: sandbox.id }));
      },

      destroy: async (config: RenderConfig, instanceId: string) => {
        const auth = resolveClient(config);
        try {
          await auth.client.terminate(instanceId, auth.ownerId);
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      },

      runCommand: (sandbox, command, options) => execute(sandbox, command, options),

      // Render streams exec output as it arrives, so live callbacks are served natively.
      streamCommand: (sandbox, command, options) => execute(sandbox, command, options),

      getInfo: async (sandbox: RenderSandbox): Promise<InstanceInfo> => {
        try {
          sandbox.data = await sandbox.client.get(sandbox.id, sandbox.ownerId);
        } catch (error) {
          if (!isNotFound(error)) throw error;
          sandbox.data = { ...sandbox.data, status: 'terminated' };
        }
        const data = sandbox.data;
        return {
          id: sandbox.id,
          provider: 'render',
          status: infoStatus(data.status),
          createdAt: new Date(data.createdAt),
          timeout: data.timeoutSeconds * 1000,
          metadata: {
            status: data.status,
            name: data.name ?? undefined,
            sandboxGroupId: data.sandboxGroupId,
            plan: data.plan,
            region: data.region,
            idleTimeoutSeconds: data.idleTimeoutSeconds,
          },
        };
      },

      getUrl: async () => {
        throw new Error('Render Sandboxes do not provide public URLs yet (public beta limitation).');
      },

      getInstance: (sandbox: RenderSandbox): RenderSandbox => sandbox,

      filesystem: {
        readFile: async (sandbox, path) => {
          const file = await sandbox.client.download(sandbox.id, path, sandbox.ownerId);
          return file.data.toString('utf8');
        },
        writeFile: async (sandbox, path, content, run) => {
          const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
          if (dir) await shellFs(sandbox, run).mkdir(dir);
          await sandbox.client.upload(sandbox.id, path, content, sandbox.ownerId);
        },
        mkdir: (sandbox, path, run) => shellFs(sandbox, run).mkdir(path),
        readdir: (sandbox, path, run) => shellFs(sandbox, run).readdir(path),
        exists: (sandbox, path, run) => shellFs(sandbox, run).exists(path),
        remove: (sandbox, path, run) => shellFs(sandbox, run).remove(path),
      },
    },

    snapshot: {
      // Runtime snapshots keep the writable filesystem, memory and processes; the source keeps running.
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false, fork: true },
      create: async (config: RenderConfig, instanceId: string, options?: CreateSnapshotOptions) => {
        const auth = resolveClient(config);
        const snapshot = await auth.client.snapshots.create({
          sandboxId: instanceId,
          name: options?.name,
          ownerId: auth.ownerId,
          wait: true,
        });
        return toSnapshot(snapshot);
      },
      list: async (config: RenderConfig, options?: ListSnapshotsOptions) => {
        const auth = resolveClient(config);
        const sandboxGroupId = await resolveGroupId(config, auth);
        const instanceId = options?.instanceId ?? options?.sandboxId;
        const rows = await paginate((cursor, limit) =>
          auth.client.snapshots.list({ sandboxGroupId, ownerId: auth.ownerId, cursor, limit }),
        );
        const snapshots = rows
          .map(({ snapshot }) => snapshot)
          .filter((snapshot) => !instanceId || snapshot.sourceSandboxId === instanceId)
          .map(toSnapshot);
        return options?.limit !== undefined ? snapshots.slice(0, options.limit) : snapshots;
      },
      delete: async (config: RenderConfig, snapshotId: string) => {
        const auth = resolveClient(config);
        const sandboxGroupId = await resolveGroupId(config, auth);
        await auth.client.snapshots.delete({ sandboxGroupId, snapshotId, ownerId: auth.ownerId });
      },
    },
  },
});
