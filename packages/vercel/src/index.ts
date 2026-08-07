/**
 * Vercel Provider - Factory-based Implementation (v2)
 *
 * Built against `@vercel/sandbox` v2, which is name-keyed and authenticates
 * via OIDC or environment credentials. Sandboxes are created with
 * `persistent: false` and `resume: false` so that a lost session is not
 * silently replaced, matching the ComputeSDK lifecycle contract.
 */

import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { APIError, Sandbox as VercelSandbox, Snapshot as VercelSnapshot } from '@vercel/sandbox';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';

export type { VercelSandbox, VercelSnapshot };

export interface VercelConfig {
  /**
   * VCR image to boot from.
   *
   * If omitted, a stock `runtime` is used.
   */
  image?: string;
  /**
   * Number of vCPUs to allocate (default 1).
   */
  vcpus?: number;
  /**
   * Stock runtime to use when `image` is not set (default `node24`).
   */
  runtime?: string;
  /** Maximum sandbox lifetime in milliseconds. */
  timeout?: number;
  /** Ports to expose on the sandbox. */
  ports?: number[];
  /** @deprecated V2 uses OIDC/environment credentials. Kept for source compatibility. */
  token?: string;
  /** @deprecated V2 uses OIDC/environment credentials. Kept for source compatibility. */
  teamId?: string;
  /** @deprecated V2 uses OIDC/environment credentials. Kept for source compatibility. */
  projectId?: string;
  /** @deprecated V2 does not expose a daemon SSE stream. */
  daemonSsePort?: number | false;
}

const NAME_PREFIX = 'computesdk-';
const OWNER_TAG = 'computesdk';
const OWNER_VALUE = 'vercel';
const MAX_METADATA_TAGS = 4;
const DEFAULT_DAEMON_SSE_PORT = 38989;

function isNotFound(error: unknown): boolean {
  return error instanceof APIError && error.response.status === 404;
}

function mergeExposedPorts(primary?: number[], fallback?: number[], daemonSsePort?: number | false): number[] {
  const daemonPort = daemonSsePort === false ? undefined : (daemonSsePort ?? DEFAULT_DAEMON_SSE_PORT);
  const merged = [...(primary ?? fallback ?? [])];
  if (typeof daemonPort === 'number') merged.push(daemonPort);
  return Array.from(new Set(merged.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)));
}

function resolveRuntime(runtime?: string): string {
  if (!runtime) return 'node24';
  if (runtime === 'node') return 'node24';
  if (runtime === 'python') return 'python3.13';
  return runtime;
}

function mapTags(metadata: Record<string, unknown> = {}): Record<string, string> {
  return Object.fromEntries([
    [OWNER_TAG, OWNER_VALUE],
    ...Object.entries(metadata)
      .slice(0, MAX_METADATA_TAGS)
      .map(([key, value]) => [`meta.${key}`, String(value)]),
  ]);
}

function mapStatus(status: VercelSandbox['status']): SandboxInfo['status'] {
  if (status === 'running') return 'running';
  if (status === 'stopped' || status === 'aborted' || status === 'failed') return 'stopped';
  return 'error';
}

function ensureRunning(sandbox: VercelSandbox): VercelSandbox {
  if (sandbox.status !== 'running') {
    throw new Error(`Vercel sandbox "${sandbox.name}" is ${sandbox.status}, not running`);
  }
  return sandbox;
}

async function getNative(name: string): Promise<VercelSandbox> {
  return VercelSandbox.get({ name, resume: false });
}

export const vercel = defineProvider<VercelSandbox, VercelConfig, any, VercelSnapshot>({
  name: 'vercel',
  methods: {
    sandbox: {
      create: async (config: VercelConfig, options?: CreateSandboxOptions) => {
        const name = options?.name ?? `${NAME_PREFIX}${randomUUID()}`;
        const timeout = options?.timeout ?? config.timeout;
        const ports = mergeExposedPorts(
          (options as any)?.ports,
          config.ports,
          (options as any)?.daemonSsePort ?? config.daemonSsePort
        );

        const createParams: any = {
          name,
          resources: { vcpus: config.vcpus ?? 1 },
          persistent: false,
          tags: mapTags(options?.metadata),
          ...(options?.envs ? { env: options.envs } : {}),
        };

        if (ports.length > 0) {
          createParams.ports = ports;
        }

        if (timeout !== undefined) {
          createParams.timeout = timeout;
        }

        const source =
          options?.source ??
          (options?.snapshotId ? { type: 'snapshot' as const, snapshotId: options.snapshotId } : undefined) ??
          (options?.templateId ? { type: 'snapshot' as const, snapshotId: options.templateId } : undefined);

        if (source) {
          createParams.source = source;
        } else {
          const image = options?.image ?? config.image;
          if (image) {
            createParams.image = image;
          } else {
            createParams.runtime = resolveRuntime(options?.runtime ?? config.runtime);
          }
        }

        const sandbox = await VercelSandbox.create(createParams);
        return { sandbox, sandboxId: sandbox.name };
      },

      getById: async (_config: VercelConfig, sandboxId: string) => {
        try {
          const sandbox = await getNative(sandboxId);
          return { sandbox, sandboxId: sandbox.name };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },

      list: async (_config: VercelConfig) => {
        const paginator = await VercelSandbox.list({ tags: { [OWNER_TAG]: OWNER_VALUE } });
        const records = await paginator.toArray();
        const results = await Promise.all(
          records.map(async (record: { name: string }) => {
            try {
              const sandbox = await getNative(record.name);
              return { sandbox, sandboxId: sandbox.name };
            } catch (error) {
              if (isNotFound(error)) return null;
              throw error;
            }
          })
        );
        return results.filter((r): r is { sandbox: VercelSandbox; sandboxId: string } => r !== null);
      },

      destroy: async (_config: VercelConfig, sandboxId: string) => {
        try {
          const sandbox = await getNative(sandboxId);
          await sandbox.delete();
        } catch (error) {
          if (isNotFound(error)) return;
          throw error;
        }
      },

      runCommand: async (
        sandbox: VercelSandbox,
        command: string,
        options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        ensureRunning(sandbox);

        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];

        const stdoutSink = options?.onStdout
          ? new Writable({
              write(chunk, _enc, cb) {
                const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
                stdoutChunks.push(text);
                options.onStdout!(text);
                cb();
              },
            })
          : undefined;

        const stderrSink = options?.onStderr
          ? new Writable({
              write(chunk, _enc, cb) {
                const text = Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk);
                stderrChunks.push(text);
                options.onStderr!(text);
                cb();
              },
            })
          : undefined;

        const params: any = {
          cmd: '/bin/sh',
          args: ['-lc', command],
          ...(options?.cwd ? { cwd: options.cwd } : {}),
          ...(options?.env ? { env: options.env } : {}),
          ...(options?.timeout ? { timeoutMs: options.timeout } : {}),
          ...(stdoutSink ? { stdout: stdoutSink } : {}),
          ...(stderrSink ? { stderr: stderrSink } : {}),
        };

        if (options?.background) {
          await sandbox.currentSession().runCommand({ ...params, detached: true as const });
          return { stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startTime };
        }

        const result = await sandbox.currentSession().runCommand(params);
        const stdout = stdoutChunks.length ? stdoutChunks.join('') : await result.stdout();
        const stderr = stderrChunks.length ? stderrChunks.join('') : await result.stderr();

        return {
          stdout,
          stderr,
          exitCode: result.exitCode ?? 1,
          durationMs: result.durationMs ?? Date.now() - startTime,
        };
      },

      getInfo: async (sandbox: VercelSandbox): Promise<SandboxInfo> => {
        try {
          const current = await getNative(sandbox.name);
          return {
            id: current.name,
            provider: 'vercel',
            status: mapStatus(current.status),
            createdAt: current.createdAt,
            timeout: current.timeout ?? 0,
            metadata: {
              ...(current.tags ?? {}),
              image: current.image,
              region: current.region,
              vcpus: current.vcpus,
              memoryMb: current.memory,
            },
          };
        } catch (error) {
          if (isNotFound(error)) {
            return {
              id: sandbox.name,
              provider: 'vercel',
              status: 'stopped',
              createdAt: sandbox.createdAt,
              timeout: sandbox.timeout ?? 0,
              metadata: {
                image: sandbox.image,
                region: sandbox.region,
                vcpus: sandbox.vcpus,
                memoryMb: sandbox.memory,
              },
            };
          }
          throw error;
        }
      },

      getUrl: async (sandbox: VercelSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        const url = ensureRunning(sandbox).currentSession().domain(options.port);
        if (options.protocol) {
          const urlObj = new URL(url);
          urlObj.protocol = options.protocol + ':';
          return urlObj.toString();
        }
        return url;
      },

      filesystem: {
        readFile: async (sandbox: VercelSandbox, path: string): Promise<string> => {
          const buffer = await ensureRunning(sandbox).currentSession().readFileToBuffer({ path });
          if (!buffer) throw new Error(`File not found or cannot be read: ${path}`);
          return buffer.toString('utf-8');
        },
        writeFile: async (sandbox: VercelSandbox, path: string, content: string): Promise<void> => {
          await ensureRunning(sandbox).currentSession().writeFiles([{ path, content: Buffer.from(content) }]);
        },
        mkdir: async (sandbox: VercelSandbox, path: string): Promise<void> => {
          await ensureRunning(sandbox).currentSession().mkDir(path);
        },
        readdir: async (
          sandbox: VercelSandbox,
          path: string,
          runCommand: (sandbox: VercelSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>
        ): Promise<FileEntry[]> => {
          const response = await runCommand(sandbox, `ls -la "${escapeShellArg(path)}"`);
          if (response.exitCode !== 0) throw new Error(`Directory not found or cannot be read: ${path}`);
          const lines = response.stdout.split('\n').filter((l: string) => l.trim());
          const entries: FileEntry[] = [];
          for (const line of lines) {
            if (line.startsWith('total ') || line.endsWith(' .') || line.endsWith(' ..')) continue;
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 9) {
              entries.push({
                name: parts.slice(8).join(' '),
                type: parts[0].startsWith('d') ? ('directory' as const) : ('file' as const),
                size: parseInt(parts[4]) || 0,
                modified: new Date(),
              });
            }
          }
          return entries;
        },
        exists: async (
          sandbox: VercelSandbox,
          path: string,
          runCommand: (sandbox: VercelSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>
        ): Promise<boolean> => {
          const response = await runCommand(sandbox, `test -e "${escapeShellArg(path)}"`);
          return response.exitCode === 0;
        },
        remove: async (
          sandbox: VercelSandbox,
          path: string,
          runCommand: (sandbox: VercelSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>
        ): Promise<void> => {
          const response = await runCommand(sandbox, `rm -rf "${escapeShellArg(path)}"`);
          if (response.exitCode !== 0) throw new Error(`Failed to remove: ${path}`);
        },
      },

      getInstance: (sandbox: VercelSandbox): VercelSandbox => sandbox,
    },

    snapshot: {
      create: async (_config: VercelConfig, sandboxId: string, _options?: { name?: string }) => {
        const sandbox = await getNative(sandboxId);
        return await sandbox.snapshot();
      },
      list: async (_config: VercelConfig) => {
        const paginator = await VercelSnapshot.list();
        const page = await paginator.toArray();
        return page as unknown as VercelSnapshot[];
      },
      delete: async (_config: VercelConfig, snapshotId: string) => {
        const snapshot = await VercelSnapshot.get({ snapshotId });
        await snapshot.delete();
      },
    },

    template: {
      create: async (_config: VercelConfig, _options: { name: string }) => {
        throw new Error('Vercel does not support creating templates directly. Use snapshot.create() instead.');
      },
      list: async (_config: VercelConfig) => {
        throw new Error('Vercel provider does not support listing templates.');
      },
      delete: async (_config: VercelConfig, templateId: string) => {
        const snapshot = await VercelSnapshot.get({ snapshotId: templateId });
        await snapshot.delete();
      },
    },
  },
});
