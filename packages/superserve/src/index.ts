/**
 * Superserve Provider - Factory-based Implementation
 *
 * Wraps `@superserve/sdk` to expose the ComputeSDK provider interface.
 */

import { randomUUID } from 'node:crypto';
import {
  AuthenticationError,
  Sandbox as SuperserveSandbox,
  Snapshot as SuperserveSnapshot,
  Template as SuperserveTemplate,
} from '@superserve/sdk';
import type { SnapshotInfo } from '@superserve/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

const DEFAULT_TIMEOUT_MS = 300_000;

import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';

export interface SuperserveConfig {
  /** Superserve API key. Falls back to `SUPERSERVE_API_KEY` env var. */
  apiKey?: string;
  /** API base URL. Falls back to `SUPERSERVE_BASE_URL` env var, then the `@superserve/sdk` default. */
  baseUrl?: string;
  /** Default auto-pause timeout in milliseconds. */
  timeout?: number;
}

function resolveApiKey(config: SuperserveConfig): string {
  const apiKey = config.apiKey || process.env.SUPERSERVE_API_KEY;
  if (!apiKey) {
    throw new Error(
      `Missing Superserve API key. Provide 'apiKey' in config or set SUPERSERVE_API_KEY environment variable.`,
    );
  }
  return apiKey;
}

function resolveBaseUrl(config: SuperserveConfig): string | undefined {
  // Returns undefined when unset on purpose: the SDK then applies its own
  // resolution (SUPERSERVE_BASE_URL env var, then its default endpoint), so
  // we don't duplicate that default and risk it drifting.
  return config.baseUrl || process.env.SUPERSERVE_BASE_URL || undefined;
}

function generateSandboxName(): string {
  return `cs-${randomUUID().slice(0, 8)}`;
}

type CommandRunner = (
  sandbox: SuperserveSandbox,
  command: string,
  options?: RunCommandOptions,
) => Promise<CommandResult>;

const FALLBACK_WORKDIR = '/';

/** Cached `pwd` probes: relative filesystem paths resolve against the cwd a
 *  `runCommand` exec would use, so `writeFile('a.txt')` and `cat a.txt` agree. */
const workdirs = new WeakMap<SuperserveSandbox, Promise<string>>();

function workdirOf(sandbox: SuperserveSandbox, runCommand: CommandRunner): Promise<string> {
  let probe = workdirs.get(sandbox);
  if (!probe) {
    probe = runCommand(sandbox, 'pwd').then((result) => {
      const dir = result.stdout.trim();
      if (result.exitCode === 0 && dir.startsWith('/')) return dir;
      // runCommand reports exec failures as results, not rejections, so a
      // transient failure must not pin the workdir to the fallback forever —
      // evict and let the next filesystem op probe again.
      workdirs.delete(sandbox);
      return FALLBACK_WORKDIR;
    });
    workdirs.set(sandbox, probe);
    probe.catch(() => workdirs.delete(sandbox));
  }
  return probe;
}

/** Join `path` onto the sandbox workdir. Absolute paths pass through and skip
 *  the probe; empty and `.` segments are dropped; `..` segments are preserved
 *  for the sandbox filesystem to resolve physically — collapsing them
 *  lexically would mis-resolve when a preceding component is a symlink. */
async function resolveSandboxPath(
  sandbox: SuperserveSandbox,
  path: string,
  runCommand: CommandRunner,
): Promise<string> {
  const combined = path.startsWith('/')
    ? path
    : `${await workdirOf(sandbox, runCommand)}/${path}`;
  const segments: string[] = [];
  for (const segment of combined.split('/')) {
    if (segment === '' || segment === '.') continue;
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

function rethrowFriendly(error: unknown, fallbackPrefix: string): never {
  if (error instanceof AuthenticationError) {
    throw new Error(
      `Superserve authentication failed. Please check your SUPERSERVE_API_KEY environment variable.`,
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('api key')) {
    throw new Error(
      `Superserve authentication failed. Please check your SUPERSERVE_API_KEY environment variable.`,
    );
  }
  if (lower.includes('quota') || lower.includes('limit') || lower.includes('429')) {
    throw new Error(`Superserve quota or rate limit reached: ${message}`);
  }
  throw new Error(`${fallbackPrefix}: ${message}`);
}

// Also serves as `streamCommand`: the SDK streams output over its own exec API
// when callbacks are passed, so no daemon or routable port is needed.
const runCommand: CommandRunner = async (sandbox, command, options) => {
  const startTime = Date.now();
  try {
    let fullCommand = command;
    if (options?.background) {
      // Run the whole command under `sh -c` so the trailing `&` backgrounds
      // the entire command (not just its last statement), and escape it so
      // the user's command can't break out of the nohup wrapper.
      fullCommand = `nohup sh -c "${escapeShellArg(fullCommand)}" > /dev/null 2>&1 &`;
    }
    const result = await sandbox.commands.run(fullCommand, {
      cwd: options?.cwd,
      env: options?.env,
      timeoutMs: options?.timeout,
      onStdout: options?.onStdout,
      onStderr: options?.onStderr,
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 127,
      durationMs: Date.now() - startTime,
    };
  }
};

function toSnapshot(info: SnapshotInfo) {
  return {
    id: info.id,
    provider: 'superserve',
    createdAt: info.createdAt,
    metadata: {
      name: info.name,
      sandboxId: info.sandboxId,
      status: info.status,
      sizeBytes: info.sizeBytes,
    },
  };
}

export const superserve = defineProvider<SuperserveSandbox, SuperserveConfig>({
  name: 'superserve',
  methods: {
    sandbox: {
      create: async (config: SuperserveConfig, options?: CreateSandboxOptions) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);

        const {
          timeout: requestedTimeoutMs,
          envs,
          name,
          metadata,
          templateId,
          snapshotId,
          namespace: _namespace,
          directory: _directory,
          ...providerOptions
        } = options || {};

        const ttMs = requestedTimeoutMs ?? config.timeout;
        const timeoutSeconds = ttMs !== undefined ? Math.max(1, Math.ceil(ttMs / 1000)) : undefined;

        try {
          const sandbox = await SuperserveSandbox.create({
            apiKey,
            baseUrl,
            name: name ?? generateSandboxName(),
            ...(templateId ? { fromTemplate: templateId } : {}),
            ...(snapshotId ? { fromSnapshot: snapshotId } : {}),
            ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
            ...(metadata ? { metadata: metadata as Record<string, string> } : {}),
            ...(envs ? { envVars: envs } : {}),
            ...providerOptions,
          });
          return { sandbox, sandboxId: sandbox.id };
        } catch (error) {
          rethrowFriendly(error, 'Failed to create Superserve sandbox');
        }
      },

      getById: async (config: SuperserveConfig, sandboxId: string) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          const sandbox = await SuperserveSandbox.connect(sandboxId, { apiKey, baseUrl });
          return { sandbox, sandboxId: sandbox.id };
        } catch {
          return null;
        }
      },

      list: async (config: SuperserveConfig) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          const infos = await SuperserveSandbox.list({ apiKey, baseUrl });
          // No per-item connect() — that would POST /activate and resume paused sandboxes.
          return infos.map((info) => ({
            sandbox: info as unknown as SuperserveSandbox,
            sandboxId: info.id,
          }));
        } catch {
          return [];
        }
      },

      destroy: async (config: SuperserveConfig, sandboxId: string) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          await SuperserveSandbox.killById(sandboxId, { apiKey, baseUrl });
        } catch {
          /* already destroyed */
        }
      },

      runCommand,
      streamCommand: runCommand,

      getInfo: async (sandbox: SuperserveSandbox): Promise<SandboxInfo> => {
        const info = await sandbox.getInfo();
        const status: SandboxInfo['status'] =
          info.status === 'paused' || info.status === 'deleted' ? 'stopped' :
          info.status === 'failed' ? 'error' :
          'running';
        return {
          id: info.id,
          provider: 'superserve',
          status,
          createdAt: info.createdAt,
          timeout: info.timeoutSeconds ? info.timeoutSeconds * 1000 : DEFAULT_TIMEOUT_MS,
          metadata: info.metadata,
        };
      },

      getUrl: async (sandbox: SuperserveSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        // A preview URL only routes once its port is published. A new port takes
        // the sandbox's `previewAccess` default; a published one keeps its mode.
        await sandbox.publishPreviewPort(options.port);
        const url = sandbox.getPreviewUrl(options.port);
        return options.protocol ? url.replace(/^https/, options.protocol) : url;
      },

      filesystem: {
        readFile: async (sandbox: SuperserveSandbox, path: string, runCommand: CommandRunner): Promise<string> => {
          return sandbox.files.readText(await resolveSandboxPath(sandbox, path, runCommand));
        },

        writeFile: async (sandbox: SuperserveSandbox, path: string, content: string, runCommand: CommandRunner): Promise<void> => {
          await sandbox.files.write(await resolveSandboxPath(sandbox, path, runCommand), content);
        },

        mkdir: async (sandbox: SuperserveSandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          const resolved = await resolveSandboxPath(sandbox, path, runCommand);
          const result = await sandbox.commands.run(`mkdir -p "${escapeShellArg(resolved)}"`);
          if (result.exitCode !== 0) {
            throw new Error(`mkdir failed: ${result.stderr || `exit code ${result.exitCode}`}`);
          }
        },

        readdir: async (sandbox: SuperserveSandbox, path: string, runCommand: CommandRunner): Promise<FileEntry[]> => {
          const resolved = await resolveSandboxPath(sandbox, path, runCommand);
          // find -printf format: <type>\t<size>\t<mtime-epoch>\t<name>
          const cmd = [
            `cd "${escapeShellArg(resolved)}" || exit 2`,
            `find . -mindepth 1 -maxdepth 1 -printf '%y\\t%s\\t%T@\\t%f\\n' 2>/dev/null`,
          ].join(' && ');
          const result = await sandbox.commands.run(cmd);
          if (result.exitCode === 2) {
            throw new Error(`readdir: directory not found: ${path}`);
          }
          if (result.exitCode !== 0) {
            throw new Error(`readdir failed: ${result.stderr || `exit code ${result.exitCode}`}`);
          }
          const entries: FileEntry[] = [];
          for (const line of result.stdout.split('\n')) {
            if (!line) continue;
            const [type, sizeStr, mtimeStr, ...nameParts] = line.split('\t');
            const name = nameParts.join('\t');
            if (!name) continue;
            const size = Number.parseInt(sizeStr, 10);
            const mtime = Number.parseFloat(mtimeStr);
            entries.push({
              name,
              type: type === 'd' ? 'directory' : 'file',
              size: Number.isFinite(size) ? size : 0,
              modified: Number.isFinite(mtime) ? new Date(mtime * 1000) : new Date(),
            });
          }
          return entries;
        },

        exists: async (sandbox: SuperserveSandbox, path: string, runCommand: CommandRunner): Promise<boolean> => {
          const resolved = await resolveSandboxPath(sandbox, path, runCommand);
          const result = await sandbox.commands.run(`test -e "${escapeShellArg(resolved)}"`);
          return result.exitCode === 0;
        },

        remove: async (sandbox: SuperserveSandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          // An empty or dot-only path would resolve to the workdir itself —
          // refuse it rather than `rm -rf` the sandbox's whole cwd.
          if (path.split('/').every((s) => s === '' || s === '.')) {
            throw new Error(`remove: refusing ambiguous path: ${JSON.stringify(path)}`);
          }
          const resolved = await resolveSandboxPath(sandbox, path, runCommand);
          const result = await sandbox.commands.run(`rm -rf "${escapeShellArg(resolved)}"`);
          if (result.exitCode !== 0) {
            throw new Error(`remove failed: ${result.stderr || `exit code ${result.exitCode}`}`);
          }
        },
      },

      getInstance: (sandbox: SuperserveSandbox): SuperserveSandbox => sandbox,
    },

    snapshot: {
      create: async (config: SuperserveConfig, sandboxId: string, options?: { name?: string }) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          // connect() activates the sandbox, so a paused one is resumed first.
          const sandbox = await SuperserveSandbox.connect(sandboxId, { apiKey, baseUrl });
          return toSnapshot(await sandbox.snapshot({ name: options?.name }));
        } catch (error) {
          rethrowFriendly(error, 'Failed to create Superserve snapshot');
        }
      },
      list: async (config: SuperserveConfig, options?: { sandboxId?: string; limit?: number }) => {
        // Snapshots are listed per sandbox. Callers that aggregate across
        // providers pass no options, so an unscoped call returns nothing
        // instead of throwing and failing their whole listing.
        if (!options?.sandboxId) return [];
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        const infos = await SuperserveSnapshot.list(options.sandboxId, { apiKey, baseUrl, limit: options.limit });
        return infos.map(toSnapshot);
      },
      delete: async (config: SuperserveConfig, snapshotId: string) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        await SuperserveSnapshot.deleteById(snapshotId, { apiKey, baseUrl });
      },
    },

    template: {
      create: async (_config: SuperserveConfig, _options: { name: string }) => {
        throw new Error(
          'Templates require a build spec. Use the @superserve/sdk Template.create() ' +
            'API directly with `from` and `steps`, or define templates via the Superserve console.',
        );
      },
      list: async (config: SuperserveConfig) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          const infos = await SuperserveTemplate.list({ apiKey, baseUrl });
          return infos.map((info) => ({
            id: info.id,
            name: info.name,
            createdAt: info.createdAt,
            metadata: { status: info.status, vcpu: info.vcpu, memoryMib: info.memoryMib },
          }));
        } catch {
          return [];
        }
      },
      delete: async (config: SuperserveConfig, templateId: string) => {
        const apiKey = resolveApiKey(config);
        const baseUrl = resolveBaseUrl(config);
        try {
          await SuperserveTemplate.deleteById(templateId, { apiKey, baseUrl });
        } catch {
          /* already deleted */
        }
      },
    },
  },
});

export type { Sandbox as SuperserveSandbox } from '@superserve/sdk';
