/**
 * Sandock provider for ComputeSDK.
 *
 * Sandock (https://sandock.ai) runs Docker-based sandboxes for AI agents. Every
 * operation goes through the Sandock SDK (`sandock`).
 */

import { defineProvider, escapeShellArg, TIMEOUT_EXIT_CODE } from '@computesdk/provider';
import type {
  CommandResult,
  CreateInstanceOptions,
  FileEntry,
  InstanceInfo,
  RunCommandOptions,
} from '@computesdk/provider';
import { createSandockClient } from 'sandock';
import type { ExecutionResult, SandboxItem, SandockClient } from 'sandock';

export interface SandockConfig {
  /** Sandock API key - if not provided, will use the SANDOCK_API_KEY env var */
  apiKey?: string;
  /** Sandock API URL - if not provided, will use SANDOCK_BASE_URL, then https://sandock.ai */
  baseUrl?: string;
  /** Space to create and look up sandboxes in - if not provided, will use SANDOCK_SPACE_ID, then your personal space */
  spaceId?: string;
  /** Docker image `create()` uses when it names none. Default: `sandockai/sandock-code:latest` */
  image?: string;
  /** Sandbox lifetime in milliseconds when `create()` sets none. Default: Sandock's (30 minutes) */
  timeout?: number;
  /** Bound on a command that sets no `timeout`, in milliseconds. Default: 300000 (5 minutes) */
  commandTimeout?: number;
  /** CPU shares for new sandboxes */
  cpu?: number;
  /** Memory limit for new sandboxes, in MB */
  memory?: number;
  /** Minutes until a stopped sandbox is deleted (-1: never, 0: at once). Default: Sandock's (1 day) */
  autoDeleteInterval?: number;
  /** A Sandock SDK client to use instead of one built from `apiKey` and `baseUrl` */
  client?: SandockClient;
}

/** What `sandbox.getInstance()` returns. */
export interface SandockInstance {
  /** The Sandock sandbox id */
  id: string;
  /** The Sandock SDK client the sandbox is reached through */
  client: SandockClient;
  /** The provider config */
  config: SandockConfig;
  /** Sandock's status for the sandbox when it was last fetched (e.g. `RUNNING`, `STOPPED`) */
  status: string;
  /** When the sandbox was created; the epoch when Sandock did not report it */
  createdAt: Date;
  /** Sandbox lifetime in milliseconds */
  timeout: number;
  /** The Docker image, when known */
  image?: string;
}

const PROVIDER = 'sandock';
const DEFAULT_BASE_URL = 'https://sandock.ai';
const DEFAULT_IMAGE = 'sandockai/sandock-code:latest';
/** Sandock's own default sandbox lifetime (`activeDeadlineSeconds`: 1800). */
const DEFAULT_LIFETIME_MS = 1_800_000;
/** Sandock's upper bound on a sandbox lifetime (`activeDeadlineSeconds`: 86400). */
const MAX_LIFETIME_SECONDS = 86_400;
/**
 * The Sandock SDK bounds every command at 30 s unless told otherwise, which is
 * too short for installs and builds; ComputeSDK commands get this instead.
 */
const DEFAULT_COMMAND_TIMEOUT_MS = 300_000;

function fromEnv(name: string): string | undefined {
  const value = typeof process === 'undefined' ? undefined : process.env?.[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

const clients = new WeakMap<SandockConfig, SandockClient>();

/** The SDK client for one provider config, built (and the API key checked) on first use. */
function clientFor(config: SandockConfig): SandockClient {
  if (config.client) return config.client;
  const cached = clients.get(config);
  if (cached) return cached;
  const apiKey = config.apiKey?.trim() || fromEnv('SANDOCK_API_KEY');
  if (!apiKey) {
    throw new Error(
      'Missing Sandock API key.\n\n' +
        'Get your key at https://sandock.ai\n' +
        "Then pass it: sandock({ apiKey: 'xxx' })\n" +
        'Or set SANDOCK_API_KEY in your environment.'
    );
  }
  const baseUrl = (config.baseUrl?.trim() || fromEnv('SANDOCK_BASE_URL') || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const client = createSandockClient({ baseUrl, headers: { Authorization: `Bearer ${apiKey}` } });
  clients.set(config, client);
  return client;
}

function spaceIdFor(config: SandockConfig): string | undefined {
  return config.spaceId?.trim() || fromEnv('SANDOCK_SPACE_ID');
}

const TRANSIENT = /ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|EAI_AGAIN|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|other side closed|socket hang up|fetch failed|^terminated$/i;

function isTransient(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (TRANSIENT.test(current.message) || (typeof code === 'string' && TRANSIENT.test(code))) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Retries a call that is safe to repeat (reads, delete) when the connection
 * dropped. Commands and `create` are never retried: they may already have run.
 */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !isTransient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
    }
  }
}

/** Looks a sandbox up by id; `null` when it does not exist, was deleted, or is not the caller's. */
async function findSandbox(config: SandockConfig, id: string): Promise<SandboxItem | null> {
  return withRetry(() => clientFor(config).sandbox.getById(id));
}

/** `activeDeadlineSeconds` from a lookup, in ms; older Sandock servers don't send it. */
function lifetimeFromItem(item: SandboxItem): number | undefined {
  const seconds = (item as SandboxItem & { activeDeadlineSeconds?: unknown }).activeDeadlineSeconds;
  return typeof seconds === 'number' && seconds > 0 ? seconds * 1000 : undefined;
}

function toInstance(config: SandockConfig, item: SandboxItem, known?: Partial<SandockInstance>): SandockInstance {
  const createdAt = item.createdAt ? new Date(item.createdAt) : undefined;
  return {
    id: item.id,
    client: clientFor(config),
    config,
    status: item.status,
    createdAt:
      createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : (known?.createdAt ?? new Date(0)),
    // Sandock reports the create-time lifetime on lookup; older servers omit it, so fall back.
    timeout:
      lifetimeFromItem(item) ?? known?.timeout ?? config.timeout ?? DEFAULT_LIFETIME_MS,
    image: item.image ?? known?.image,
  };
}

function toStatus(status: string | undefined): InstanceInfo['status'] {
  switch ((status ?? '').toUpperCase()) {
    case 'RUNNING':
    case 'PENDING':
    case 'CREATING':
    case 'STARTING':
      return 'running';
    case 'ERROR':
    case 'FAILED':
      return 'error';
    default:
      return 'stopped';
  }
}

function lifetimeSeconds(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error(`Sandock: 'timeout' must be a number of milliseconds above 0, got ${String(ms)}`);
  }
  return Math.min(MAX_LIFETIME_SECONDS, Math.max(1, Math.ceil(ms / 1000)));
}

/** Sandock's result, with a timeout reported as exit code 124. */
function toCommandResult(data: ExecutionResult, startedAt: number): CommandResult {
  const exitCode = data.timedOut ? TIMEOUT_EXIT_CODE : (data.exitCode ?? -1);
  return { stdout: data.stdout ?? '', stderr: data.stderr ?? '', exitCode, durationMs: Date.now() - startedAt };
}

function shellOptions(inst: SandockInstance, cmd: string, options?: RunCommandOptions) {
  return {
    cmd,
    timeoutMs: options?.timeout ?? inst.config.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT_MS,
    ...(options?.cwd ? { workdir: options.cwd } : {}),
    ...(options?.env && Object.keys(options.env).length > 0 ? { env: options.env } : {}),
  };
}

type FsRunCommand = (inst: SandockInstance, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

async function runOrThrow(run: FsRunCommand, inst: SandockInstance, command: string, what: string): Promise<CommandResult> {
  const r = await run(inst, command);
  if (r.exitCode !== 0) throw new Error(`Sandock: ${what} failed (exit ${r.exitCode}): ${r.stderr.trim()}`);
  return r;
}

export const sandock = defineProvider<SandockInstance, SandockConfig>({
  name: PROVIDER,
  methods: {
    instances: {
      create: async (config: SandockConfig, options?: CreateInstanceOptions) => {
        const client = clientFor(config);
        if (options?.snapshotId) {
          throw new Error(
            'Sandock does not restore sandboxes from snapshots. Pass a Docker image as `image` (or `templateId`) instead.'
          );
        }
        options?.signal?.throwIfAborted();
        const image = options?.image ?? options?.templateId ?? config.image ?? DEFAULT_IMAGE;
        const lifetimeMs = options?.timeout ?? config.timeout;
        const activeDeadlineSeconds = lifetimeMs === undefined ? undefined : lifetimeSeconds(lifetimeMs);
        const cpu = options?.cpu ?? options?.cpus ?? config.cpu;
        const memory = options?.memory ?? options?.memoryMb ?? options?.memoryMiB ?? config.memory;
        const spaceId = spaceIdFor(config);
        const envs = options?.envs && Object.keys(options.envs).length > 0 ? options.envs : undefined;

        const created = await client.sandbox.create({
          image,
          ...(options?.name ? { title: options.name } : {}),
          ...(envs ? { env: envs } : {}),
          ...(cpu !== undefined ? { cpu } : {}),
          ...(memory !== undefined ? { memory } : {}),
          ...(spaceId ? { spaceId } : {}),
          ...(activeDeadlineSeconds !== undefined ? { activeDeadlineSeconds } : {}),
          ...(config.autoDeleteInterval !== undefined ? { autoDeleteInterval: config.autoDeleteInterval } : {}),
        });
        const id = created.data.id;
        if (!id) throw new Error('Sandock: sandbox create returned no sandbox id');

        if (options?.signal?.aborted) {
          // The caller gave up while the sandbox was being created: don't leave it running.
          await withRetry(() => client.sandbox.delete(id)).catch(() => undefined);
          options.signal.throwIfAborted();
        }

        // A new Sandock sandbox is running once `create` returns; no `start` call is needed.
        const instance: SandockInstance = {
          id,
          client,
          config,
          status: 'RUNNING',
          createdAt: new Date(),
          timeout: activeDeadlineSeconds !== undefined ? activeDeadlineSeconds * 1000 : DEFAULT_LIFETIME_MS,
          image,
        };
        return { instance, instanceId: id };
      },

      getById: async (config: SandockConfig, instanceId: string) => {
        const item = await findSandbox(config, instanceId);
        return item ? { instance: toInstance(config, item), instanceId: item.id } : null;
      },

      list: async (config: SandockConfig) => {
        const client = clientFor(config);
        const spaceId = spaceIdFor(config);
        const res = await withRetry(() => client.sandbox.list(spaceId ? { spaceId } : undefined));
        return res.data.items.map((item) => ({ instance: toInstance(config, item), instanceId: item.id }));
      },

      destroy: async (config: SandockConfig, instanceId: string) => {
        const client = clientFor(config);
        try {
          await withRetry(() => client.sandbox.delete(instanceId));
        } catch (error) {
          // Sandock answers a delete of an unknown id with a 500; already gone is what destroy asks for.
          if (!(await findSandbox(config, instanceId))) return;
          throw error;
        }
      },

      runCommand: async (inst: SandockInstance, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startedAt = Date.now();
        if (options?.background) {
          // Started and left running; its output is not collected.
          const cmd = `nohup sh -c "${escapeShellArg(command)}" > /dev/null 2>&1 &`;
          const res = await inst.client.sandbox.shell(inst.id, shellOptions(inst, cmd, options));
          return toCommandResult(res.data, startedAt);
        }
        const res = await inst.client.sandbox.shell(inst.id, shellOptions(inst, command, options));
        return toCommandResult(res.data, startedAt);
      },

      /**
       * Live output over Sandock's SSE shell stream. A command still running at
       * its `timeout` is stopped by Sandock and reported with exit code 124.
       */
      streamCommand: async (inst: SandockInstance, command: string, options: RunCommandOptions): Promise<CommandResult> => {
        const startedAt = Date.now();
        let streamError: unknown;
        const res = await inst.client.sandbox.shell(inst.id, shellOptions(inst, command, options), {
          onStdout: (chunk) => options.onStdout?.(chunk),
          onStderr: (chunk) => options.onStderr?.(chunk),
          onError: (error) => {
            streamError ??= error;
          },
        });
        if (res.data.exitCode === null && !res.data.timedOut && streamError) {
          throw streamError instanceof Error ? streamError : new Error(`Sandock: shell stream failed: ${String(streamError)}`);
        }
        return toCommandResult(res.data, startedAt);
      },

      getInfo: async (inst: SandockInstance): Promise<InstanceInfo> => {
        const item = await findSandbox(inst.config, inst.id);
        if (item) inst.status = item.status;
        return {
          id: inst.id,
          provider: PROVIDER,
          // Not listed any more means it was deleted.
          status: item ? toStatus(item.status) : 'stopped',
          createdAt: inst.createdAt,
          timeout: inst.timeout,
          metadata: {
            sandockStatus: item?.status ?? 'DELETED',
            ...(item?.image ?? inst.image ? { image: item?.image ?? inst.image } : {}),
          },
        };
      },

      /**
       * A signed preview URL for `port`: the access token is embedded, so it can
       * be opened or fetched directly. It expires after an hour.
       */
      getUrl: async (inst: SandockInstance, options: { port: number; protocol?: string }): Promise<string> => {
        const res = await withRetry(() => inst.client.sandbox.getSignedPreviewUrl(inst.id, { port: options.port }));
        const url = res.data.url;
        const protocol = options.protocol?.replace(/:$/, '');
        // Previews are served over TLS (plain http redirects to https, which a WebSocket
        // handshake does not follow), so an https URL maps to wss even when `ws` is asked for.
        if (protocol === 'ws' || protocol === 'wss') return url.replace(/^http/, 'ws');
        return url;
      },

      getInstance: (inst: SandockInstance): SandockInstance => inst,

      filesystem: {
        readFile: async (inst: SandockInstance, path: string): Promise<string> => {
          // Sandock rejects a read of a missing file.
          const res = await withRetry(() => inst.client.fs.read(inst.id, path));
          return res.data.content ?? '';
        },

        writeFile: async (inst: SandockInstance, path: string, content: string): Promise<void> => {
          // Creates missing parent directories.
          await withRetry(() => inst.client.fs.write(inst.id, path, content));
        },

        mkdir: async (inst: SandockInstance, path: string, run: FsRunCommand): Promise<void> => {
          await runOrThrow(run, inst, `mkdir -p "${escapeShellArg(path)}"`, `mkdir of ${path}`);
        },

        readdir: async (inst: SandockInstance, path: string, run: FsRunCommand): Promise<FileEntry[]> => {
          // Sandock's fs.list returns bare names, so type, size and mtime come from the shell.
          const q = escapeShellArg(path);
          const r = await runOrThrow(
            run,
            inst,
            `cd "${q}" && for f in * .[!.]* ..?*; do ` +
              `{ [ -e "$f" ] || [ -L "$f" ]; } || continue; ` +
              `if [ -d "$f" ]; then t=d; else t=f; fi; ` +
              `printf '%s\\000%s\\000%s\\000%s\\000' "$t" "$(stat -c %s "$f" 2>/dev/null || echo 0)" "$(stat -c %Y "$f" 2>/dev/null || echo 0)" "$f"; ` +
              `done`,
            `listing of ${path}`
          );
          // NUL-separated fields: a filename may contain tabs or newlines, never NUL.
          const fields = r.stdout.split('\0');
          const entries: FileEntry[] = [];
          for (let i = 0; i + 3 < fields.length; i += 4) {
            const [kind, size, mtime, name] = fields.slice(i, i + 4);
            entries.push({
              name,
              type: kind === 'd' ? 'directory' : 'file',
              size: Number.parseInt(size, 10) || 0,
              modified: new Date((Number.parseInt(mtime, 10) || 0) * 1000),
            });
          }
          return entries;
        },

        exists: async (inst: SandockInstance, path: string, run: FsRunCommand): Promise<boolean> => {
          const r = await run(inst, `test -e "${escapeShellArg(path)}"`);
          return r.exitCode === 0;
        },

        remove: async (inst: SandockInstance, path: string, run: FsRunCommand): Promise<void> => {
          await runOrThrow(run, inst, `rm -rf "${escapeShellArg(path)}"`, `remove of ${path}`);
        },
      },
    },
  },
});

export default sandock;

export { createSandockClient } from 'sandock';
export type { SandockClient } from 'sandock';
