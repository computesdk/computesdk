/**
 * Maritime Provider - Factory-based Implementation
 *
 * Wraps `maritime-sdk` (the Sandboxes API) to expose the ComputeSDK provider interface.
 */

import { randomUUID } from 'node:crypto';
import { Maritime, MaritimeAuthError, MaritimeNotFoundError, MaritimeSandboxError } from 'maritime-sdk';
import type { CreateSandboxParams, Sandbox as MaritimeSandbox, SandboxData, SavedSnapshot } from 'maritime-sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type {
  CommandResult,
  CreateInstanceOptions,
  FileEntry,
  InstanceInfo,
  RunCommandOptions,
} from '@computesdk/provider';

export interface MaritimeConfig {
  /** Maritime API key (`mk_...`). Falls back to the `MARITIME_API_KEY` env var. */
  apiKey?: string;
  /** API base URL. Falls back to `MARITIME_API_URL`, then `https://api.maritime.sh` (both resolved by `maritime-sdk`). */
  baseUrl?: string;
  /** Default sandbox time limit in milliseconds (60s to 24h). Maritime kills the sandbox when it passes. */
  timeout?: number;
}

/** Maritime-native create fields accepted alongside the standard ComputeSDK options. */
const NATIVE_CREATE_KEYS = [
  'size', 'vcpu', 'memoryMib', 'diskGib', 'screen', 'network', 'endUser', 'forEndUser',
  'idleTimeoutSeconds', 'onIdle', 'keepAwake', 'failFast',
] as const satisfies ReadonlyArray<keyof CreateSandboxParams>;

/** Foreground commands default to Maritime's 60s limit when no timeout is set; raise it to the API maximum. */
const MAX_COMMAND_TIMEOUT_SECONDS = 3600;

const clients = new Map<string, Maritime>();

function getClient(config: MaritimeConfig): Maritime {
  const apiKey = config.apiKey || process.env.MARITIME_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing Maritime API key.\n\n' +
      'Create one in the Maritime dashboard (Settings -> API keys) at https://maritime.sh\n' +
      'Then pass it: maritime({ apiKey: "mk_..." })\n' +
      'Or set MARITIME_API_KEY in your environment.',
    );
  }
  const key = `${apiKey}\n${config.baseUrl ?? ''}`;
  let client = clients.get(key);
  if (!client) {
    client = new Maritime({ apiKey, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}) });
    clients.set(key, client);
  }
  return client;
}

function isNotFound(error: unknown): boolean {
  return error instanceof MaritimeNotFoundError ||
    (error instanceof MaritimeSandboxError && error.code === 'sandbox_not_found');
}

function rethrowFriendly(error: unknown, prefix: string): never {
  if (error instanceof MaritimeAuthError ||
    (error instanceof MaritimeSandboxError && (error.code === 'unauthenticated' || error.code === 'scope_missing'))) {
    throw new Error(
      'Maritime authentication failed. Check MARITIME_API_KEY and that the key has the `sandboxes` scope.',
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`${prefix}: ${message}`);
}

function toStringRecord(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
}

type CommandRunner = (sandbox: MaritimeSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

const runCommand: CommandRunner = async (sandbox, command, options) => {
  const startTime = Date.now();
  const params = {
    cwd: options?.cwd,
    env: options?.env,
    timeoutSeconds: options?.timeout !== undefined
      ? Math.min(MAX_COMMAND_TIMEOUT_SECONDS, Math.max(1, Math.ceil(options.timeout / 1000)))
      : MAX_COMMAND_TIMEOUT_SECONDS,
  };
  try {
    if (options?.background) {
      await sandbox.run(command, { ...params, timeoutSeconds: options.timeout !== undefined ? params.timeoutSeconds : undefined, background: true });
      return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
    }
    const result = await sandbox.run(command, {
      ...params,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      // A process ended by a signal has no exit code; report it like a shell does (128 + 9 for SIGKILL).
      exitCode: result.exitCode ?? 137,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    if (error instanceof MaritimeSandboxError && error.code === 'command_timeout') {
      return {
        stdout: error.command?.stdout ?? '',
        stderr: error.command?.stderr || `Command timed out after ${params.timeoutSeconds}s`,
        exitCode: 124,
        durationMs: Date.now() - startTime,
      };
    }
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 127,
      durationMs: Date.now() - startTime,
    };
  }
};

/** The Files API takes absolute paths; resolve relative ones against the directory commands run in. */
async function absolutePath(sandbox: MaritimeSandbox, path: string, run: CommandRunner): Promise<string> {
  if (path.startsWith('/')) return path;
  const result = await run(sandbox, 'pwd');
  const dir = result.exitCode === 0 && result.stdout.trim().startsWith('/') ? result.stdout.trim() : '/';
  return `${dir.replace(/\/$/, '')}/${path}`;
}

function toSnapshot(snapshot: SavedSnapshot) {
  return {
    id: snapshot.name,
    provider: 'maritime',
    createdAt: new Date(snapshot.createdAt),
    metadata: {
      sourceSandboxId: snapshot.sourceSandboxId,
      size: snapshot.size,
      storedBytes: snapshot.storedBytes,
    },
  };
}

export const maritime = defineProvider<MaritimeSandbox, MaritimeConfig>({
  name: 'maritime',
  methods: {
    instances: {
      create: async (config: MaritimeConfig, options?: CreateInstanceOptions) => {
        const client = getClient(config);
        const { timeout, envs, name, metadata, templateId, snapshotId, image } = options || {};
        const native: Partial<CreateSandboxParams> = {};
        for (const key of NATIVE_CREATE_KEYS) {
          if (options?.[key] !== undefined) (native as Record<string, unknown>)[key] = options[key];
        }
        const timeLimitMs = timeout ?? config.timeout;
        const from = snapshotId ?? templateId ?? image;
        try {
          const sandbox = await client.sandboxes.create({
            ...native,
            ...(name ? { name } : {}),
            ...(from ? { from } : {}),
            ...(envs ? { env: envs } : {}),
            ...(metadata ? { metadata: toStringRecord(metadata) } : {}),
            ...(timeLimitMs !== undefined
              ? { timeLimitSeconds: Math.min(86_400, Math.max(60, Math.ceil(timeLimitMs / 1000))) }
              : {}),
          });
          return { instance: sandbox, instanceId: sandbox.id };
        } catch (error) {
          rethrowFriendly(error, 'Failed to create Maritime sandbox');
        }
      },

      getById: async (config: MaritimeConfig, sandboxId: string) => {
        const client = getClient(config);
        try {
          const sandbox = await client.sandboxes.get(sandboxId);
          if (sandbox.state === 'ended') return null;
          return { instance: sandbox, instanceId: sandbox.id };
        } catch (error) {
          if (isNotFound(error)) return null;
          rethrowFriendly(error, 'Failed to get Maritime sandbox');
        }
      },

      list: async (config: MaritimeConfig) => {
        const client = getClient(config);
        const sandboxes: SandboxData[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.sandboxes.list({
            state: ['starting', 'running', 'pausing', 'paused', 'resuming', 'error'],
            limit: 100,
            cursor,
          });
          sandboxes.push(...page.data);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        // connect() with a Sandbox object makes a client without a request or a resume.
        return Promise.all(sandboxes.map(async (data) => ({
          instance: await client.sandboxes.connect(data),
          instanceId: data.id,
        })));
      },

      destroy: async (config: MaritimeConfig, sandboxId: string) => {
        const client = getClient(config);
        try {
          const sandbox = await client.sandboxes.get(sandboxId);
          // kill() is safe to repeat on an ended sandbox.
          await sandbox.kill();
        } catch (error) {
          if (isNotFound(error)) return;
          rethrowFriendly(error, 'Failed to destroy Maritime sandbox');
        }
      },

      runCommand,
      // Foreground runs stream stdout/stderr over Server-Sent Events from the sandbox's data plane.
      streamCommand: runCommand,

      getInfo: async (sandbox: MaritimeSandbox): Promise<InstanceInfo> => {
        const data = await sandbox.refresh();
        const status: InstanceInfo['status'] =
          data.state === 'running' ? 'running' :
          data.state === 'error' ? 'error' :
          'stopped';
        return {
          id: data.id,
          provider: 'maritime',
          status,
          createdAt: new Date(data.createdAt),
          timeout: (data.lifecycle?.timeLimitSeconds ?? 0) * 1000,
          metadata: {
            ...data.metadata,
            name: data.name,
            size: data.size,
            from: data.from,
            state: data.state,
          },
        };
      },

      getUrl: async (sandbox: MaritimeSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        // The default URL carries the sandbox's url token, so the port stays private.
        const url = await sandbox.url(options.port);
        return options.protocol ? url.replace(/^https/, options.protocol) : url;
      },

      filesystem: {
        readFile: async (sandbox: MaritimeSandbox, path: string, run: CommandRunner): Promise<string> => {
          const bytes = await sandbox.files.read(await absolutePath(sandbox, path, run));
          return new TextDecoder().decode(bytes);
        },

        writeFile: async (sandbox: MaritimeSandbox, path: string, content: string, run: CommandRunner): Promise<void> => {
          await sandbox.files.write(await absolutePath(sandbox, path, run), content);
        },

        mkdir: async (sandbox: MaritimeSandbox, path: string, run: CommandRunner): Promise<void> => {
          const result = await run(sandbox, `mkdir -p "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) {
            throw new Error(`mkdir failed: ${result.stderr || `exit code ${result.exitCode}`}`);
          }
        },

        readdir: async (sandbox: MaritimeSandbox, path: string, run: CommandRunner): Promise<FileEntry[]> => {
          const entries = await sandbox.files.list(await absolutePath(sandbox, path, run));
          return entries.map((entry) => ({
            name: entry.path.split('/').filter(Boolean).pop() ?? entry.path,
            type: entry.type === 'dir' ? 'directory' : 'file',
            size: entry.sizeBytes,
            modified: new Date(entry.modifiedAt),
          }));
        },

        exists: async (sandbox: MaritimeSandbox, path: string, run: CommandRunner): Promise<boolean> => {
          const result = await run(sandbox, `test -e "${escapeShellArg(path)}"`);
          return result.exitCode === 0;
        },

        remove: async (sandbox: MaritimeSandbox, path: string, run: CommandRunner): Promise<void> => {
          await sandbox.files.remove(await absolutePath(sandbox, path, run), { recursive: true });
        },
      },

      pause: async (sandbox: MaritimeSandbox): Promise<void> => {
        await sandbox.pause();
      },

      // Maritime has no resume call: the next data plane call resumes a paused sandbox, and a
      // foreground `run` retries `sandbox_paused` until it has resumed.
      resume: async (sandbox: MaritimeSandbox): Promise<void> => {
        const result = await sandbox.run('true', { timeoutSeconds: 60 });
        if (result.exitCode !== 0) {
          throw new Error(`Failed to resume Maritime sandbox ${sandbox.id}: ${result.stderr || `exit code ${result.exitCode}`}`);
        }
        await sandbox.refresh();
      },

      // A resume may restore only the disk (`restoredFrom: 'disk_only'`), so running processes are not promised.
      pauseCapabilities: { memory: false },

      getInstance: (sandbox: MaritimeSandbox): MaritimeSandbox => sandbox,
    },

    snapshot: {
      // `save` stores the disk and memory under a name; new sandboxes start from it with `snapshotId`.
      capabilities: { scope: 'rootfs', memory: true, destroysSource: false },
      create: async (config: MaritimeConfig, sandboxId: string, options?: { name?: string }) => {
        const client = getClient(config);
        try {
          const sandbox = await client.sandboxes.get(sandboxId);
          return toSnapshot(await sandbox.save(options?.name ?? `csdk-${randomUUID().slice(0, 8)}`));
        } catch (error) {
          rethrowFriendly(error, 'Failed to create Maritime snapshot');
        }
      },
      list: async (config: MaritimeConfig) => {
        const client = getClient(config);
        const snapshots: SavedSnapshot[] = [];
        let cursor: string | undefined;
        do {
          const page = await client.snapshots.list({ limit: 100, cursor });
          snapshots.push(...page.data);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        // The same listing carries Maritime's stock templates, which have no source sandbox.
        return snapshots.filter((s) => s.sourceSandboxId !== null).map(toSnapshot);
      },
      delete: async (config: MaritimeConfig, snapshotId: string) => {
        const client = getClient(config);
        try {
          await client.snapshots.delete(snapshotId);
        } catch (error) {
          if (error instanceof MaritimeSandboxError && error.code === 'snapshot_not_found') return;
          rethrowFriendly(error, 'Failed to delete Maritime snapshot');
        }
      },
    },
  },
});

export type { Sandbox as MaritimeSandbox } from 'maritime-sdk';
