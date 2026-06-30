/**
 * Superserve Provider - Factory-based Implementation
 *
 * Wraps `@superserve/sdk` to expose the ComputeSDK provider interface.
 */

import { randomUUID } from 'node:crypto';
import {
  AuthenticationError,
  Sandbox as SuperserveSandbox,
  Template as SuperserveTemplate,
} from '@superserve/sdk';
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
  /** API base URL. Falls back to `SUPERSERVE_BASE_URL` env var, then `https://api.superserve.ai`. */
  baseUrl?: string;
  /** Default sandbox idle timeout in milliseconds. */
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
  // resolution (SUPERSERVE_BASE_URL env var, then its https://api.superserve.ai
  // default), so we don't duplicate that constant and risk it drifting.
  return config.baseUrl || process.env.SUPERSERVE_BASE_URL || undefined;
}

function generateSandboxName(): string {
  return `cs-${randomUUID().slice(0, 8)}`;
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
          // Superserve has no snapshot resource — `snapshotId` is dropped here
          // intentionally; use `templateId` (a Superserve template UUID or name)
          // instead. See `snapshot` block below for context.
          snapshotId: _snapshotId,
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

      runCommand: async (
        sandbox: SuperserveSandbox,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
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
      },

      getInfo: async (sandbox: SuperserveSandbox): Promise<SandboxInfo> => {
        const info = await sandbox.getInfo();
        const status: SandboxInfo['status'] =
          info.status === 'paused' ? 'stopped' :
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

      getUrl: async (_sandbox: SuperserveSandbox, _options: { port: number; protocol?: string }): Promise<string> => {
        throw new Error(
          'Superserve does not currently support arbitrary port forwarding via getUrl(). ' +
            'Use sandbox.commands.run() to interact with services running inside the sandbox.',
        );
      },

      filesystem: {
        readFile: async (sandbox: SuperserveSandbox, path: string): Promise<string> => {
          return sandbox.files.readText(path);
        },

        writeFile: async (sandbox: SuperserveSandbox, path: string, content: string): Promise<void> => {
          await sandbox.files.write(path, content);
        },

        mkdir: async (sandbox: SuperserveSandbox, path: string): Promise<void> => {
          const result = await sandbox.commands.run(`mkdir -p "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) {
            throw new Error(`mkdir failed: ${result.stderr || `exit code ${result.exitCode}`}`);
          }
        },

        readdir: async (sandbox: SuperserveSandbox, path: string): Promise<FileEntry[]> => {
          // find -printf format: <type>\t<size>\t<mtime-epoch>\t<name>
          const cmd = [
            `cd "${escapeShellArg(path)}" || exit 2`,
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

        exists: async (sandbox: SuperserveSandbox, path: string): Promise<boolean> => {
          const result = await sandbox.commands.run(`test -e "${escapeShellArg(path)}"`);
          return result.exitCode === 0;
        },

        remove: async (sandbox: SuperserveSandbox, path: string): Promise<void> => {
          const result = await sandbox.commands.run(`rm -rf "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) {
            throw new Error(`remove failed: ${result.stderr || `exit code ${result.exitCode}`}`);
          }
        },
      },

      getInstance: (sandbox: SuperserveSandbox): SuperserveSandbox => sandbox,
    },

    // Superserve has no standalone snapshot resource — pause/resume is 1:1
    // and not forkable. Templates are the closest analog (wired below).
    snapshot: {
      create: async (_config: SuperserveConfig, _sandboxId: string, _options?: { name?: string }) => {
        throw new Error(
          'Superserve does not expose snapshots as a separate resource. ' +
            'Use Template.create() with a build spec for reusable base images, ' +
            'or sandbox.pause() / sandbox.resume() for in-place state preservation.',
        );
      },
      list: async (_config: SuperserveConfig) => {
        return [];
      },
      delete: async (_config: SuperserveConfig, _snapshotId: string) => {
        /* no-op: snapshots are not a separate resource */
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
