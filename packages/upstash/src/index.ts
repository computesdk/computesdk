/**
 * Upstash Box Provider - Factory-based Implementation
 *
 * Wraps @upstash/box SDK with ComputeSDK's provider interface.
 * Supports code execution, shell commands, filesystem, snapshots, and preview URLs.
 */

import { Box, EphemeralBox } from '@upstash/box';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

export type UpstashSandboxInstance = Box | EphemeralBox;

export function isEphemeralSandboxInstance(sandbox: UpstashSandboxInstance): sandbox is EphemeralBox {
  return (
    'expiresAt' in sandbox &&
    typeof sandbox.expiresAt === 'number'
  );
}

export function isUpstashBoxInstance(sandbox: UpstashSandboxInstance): sandbox is Box {
  return !isEphemeralSandboxInstance(sandbox);
}

/**
 * Upstash-specific configuration options
 */
export interface UpstashConfig {
  /** Upstash Box API key - if not provided, will fallback to UPSTASH_BOX_API_KEY environment variable */
  apiKey?: string;
  /** Default runtime environment (e.g. 'node', 'python') */
  runtime?: string;
  /** Execution timeout in milliseconds (default: 600000) */
  timeout?: number;
}

/**
 * Resolve a path relative to the box's workspace directory.
 * Upstash requires all file paths to be under /workspace/home.
 * Absolute paths like "/tmp/foo" get remapped to "/workspace/home/tmp/foo".
 */
function resolvePath(sandbox: UpstashSandboxInstance, path: string): string {
  const root = sandbox.cwd;
  if (path.startsWith(root)) {
    return path;
  }
  if (path.startsWith('/')) {
    return `${root}${path}`;
  }
  return path;
}

/**
 * Create an Upstash Box provider instance using the factory pattern
 */
export const upstash = defineProvider<UpstashSandboxInstance, UpstashConfig>({
  name: 'upstash',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: UpstashConfig, options?: CreateSandboxOptions) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.UPSTASH_BOX_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing Upstash Box API key. Provide 'apiKey' in config or set UPSTASH_BOX_API_KEY environment variable.`
          );
        }

        const timeout = options?.timeout ?? config.timeout ?? 600000;
        const optRuntime = (options as any)?.runtime as string | undefined;
        const ephemeral = (options as any)?.ephemeral as boolean | undefined;
        const ttl = (options as any)?.ttl as number | undefined;

        try {
          let box: UpstashSandboxInstance;

          if (options?.snapshotId) {
            const runtime = (optRuntime ?? config.runtime ?? 'node') as any;

            if (ephemeral === true) {
              // Restore lightweight ephemeral box from snapshot
              box = await EphemeralBox.fromSnapshot(options.snapshotId, {
                apiKey,
                runtime,
                timeout,
                ttl,
                env: options?.envs,
              });
            } else {
              // Restore full box from snapshot
              box = await Box.fromSnapshot(options.snapshotId, {
                apiKey,
                runtime,
                timeout,
                env: options?.envs,
              });
            }
          } else if (ephemeral !== true) {
            // Destructure known ComputeSDK fields, collect the rest for passthrough
            const {
              timeout: _timeout,
              envs,
              name: _name,
              metadata: _metadata,
              templateId: _templateId,
              snapshotId: _snapshotId,
              sandboxId: _sandboxId,
              namespace: _namespace,
              directory: _directory,
              ...providerOptions
            } = options || {};

            // Create new full box
            box = await Box.create({
              apiKey,
              runtime: (optRuntime ?? config.runtime ?? 'node') as any,
              timeout,
              env: envs,
              ...providerOptions,
            });
          } else {
            // create lightweight ephemeral box (exec + files only, instant ready)
            const ephemeralBox = await EphemeralBox.create({
              apiKey,
              runtime: (optRuntime ?? config.runtime ?? 'node') as any,
              timeout,
              ttl,
            });
            box = ephemeralBox;
          }

          return {
            sandbox: box,
            sandboxId: box.id,
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key') || error.message.includes('401')) {
              throw new Error(
                `Upstash authentication failed. Please check your UPSTASH_BOX_API_KEY environment variable.`
              );
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(
                `Upstash quota exceeded. Please check your usage at https://console.upstash.com/`
              );
            }
          }
          throw new Error(
            `Failed to create Upstash box: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: UpstashConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.UPSTASH_BOX_API_KEY!;

        try {
          const box = await Box.get(sandboxId, { apiKey });

          return {
            sandbox: box,
            sandboxId: box.id,
          };
        } catch (error) {
          return null;
        }
      },

      list: async (config: UpstashConfig) => {
        const apiKey = config.apiKey || process.env.UPSTASH_BOX_API_KEY!;

        try {
          const boxes = await Box.list({ apiKey });
          return boxes.map((boxData: any) => ({
            sandbox: boxData,
            sandboxId: boxData.id,
          }));
        } catch (error) {
          return [];
        }
      },

      destroy: async (config: UpstashConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.UPSTASH_BOX_API_KEY!;

        try {
          const box = await Box.get(sandboxId, { apiKey });
          await box.delete();
        } catch (error) {
          // Box might already be destroyed or doesn't exist
        }
      },

      // Instance operations

      runCommand: async (sandbox: UpstashSandboxInstance, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();

        try {
          let fullCommand = command;

          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env)
              .map(([k, v]) => `${k}="${escapeShellArg(String(v))}"`)
              .join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }

          if (options?.cwd) {
            fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          }

          if (options?.background) {
            fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          }

          const run = await sandbox.exec.command(fullCommand);

          return {
            stdout: run.result || '',
            stderr: '',
            exitCode: run.exitCode ?? 0,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          const result = (error as any)?.result;
          if (result) {
            return {
              stdout: typeof result === 'string' ? result : result.output || '',
              stderr: typeof result === 'string' ? '' : result.error || '',
              exitCode: (error as any)?.exitCode ?? 1,
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
      },

      getInfo: async (sandbox: UpstashSandboxInstance): Promise<SandboxInfo> => {
        const { status } = await sandbox.getStatus();

        const universalStatus: SandboxInfo['status'] =
          (status === 'creating' || status === 'idle' || status === 'running') ? 'running' :
            status === 'error' ? 'error' :
              'stopped';

        return {
          id: sandbox.id,
          provider: 'upstash',
          status: universalStatus,
          createdAt: new Date(),
          timeout: 600000,
          metadata: {
            upstashBoxId: sandbox.id,
            upstashStatus: status,
          },
        };
      },

      getUrl: async (sandbox: UpstashSandboxInstance, options: { port: number; protocol?: string }): Promise<string> => {
        if (isEphemeralSandboxInstance(sandbox)) {
          throw new Error(
            'Preview URLs are not supported on ephemeral boxes. Use ephemeral: false to create a full box with preview support.'
          );
        }

        try {
          const preview = await sandbox.getPreviewUrl(options.port);
          return preview.url;
        } catch (error) {
          throw new Error(
            `Failed to get Upstash preview URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      // Filesystem methods - Upstash Box has full filesystem support
      filesystem: {
        readFile: async (sandbox: UpstashSandboxInstance, path: string): Promise<string> => {
          return await sandbox.files.read(resolvePath(sandbox, path));
        },

        writeFile: async (sandbox: UpstashSandboxInstance, path: string, content: string): Promise<void> => {
          await sandbox.files.write({ path: resolvePath(sandbox, path), content });
        },

        mkdir: async (sandbox: UpstashSandboxInstance, path: string): Promise<void> => {
          await sandbox.exec.command(`mkdir -p "${escapeShellArg(resolvePath(sandbox, path))}"`);
        },

        readdir: async (sandbox: UpstashSandboxInstance, path: string): Promise<FileEntry[]> => {
          const entries = await sandbox.files.list(resolvePath(sandbox, path));

          return entries.map((entry: any) => ({
            name: entry.name,
            type: entry.is_dir ? 'directory' as const : 'file' as const,
            size: entry.size || 0,
            modified: new Date(entry.mod_time || Date.now()),
          }));
        },

        exists: async (sandbox: UpstashSandboxInstance, path: string): Promise<boolean> => {
          try {
            const run = await sandbox.exec.command(`test -e "${escapeShellArg(resolvePath(sandbox, path))}" && echo "exists" || echo "not_found"`);
            return (run.result || '').trim() === 'exists';
          } catch {
            return false;
          }
        },

        remove: async (sandbox: UpstashSandboxInstance, path: string): Promise<void> => {
          await sandbox.exec.command(`rm -rf "${escapeShellArg(resolvePath(sandbox, path))}"`);
        },
      },

      // Provider-specific typed getInstance method
      getInstance: (sandbox: UpstashSandboxInstance): UpstashSandboxInstance => {
        return sandbox;
      },
    },

    snapshot: {
      create: async (config: UpstashConfig, sandboxId: string, options?: { name?: string }) => {
        const apiKey = config.apiKey || process.env.UPSTASH_BOX_API_KEY!;

        try {
          const box = await Box.get(sandboxId, { apiKey });
          const snapshot = await box.snapshot({
            name: options?.name || `snapshot-${Date.now()}`,
          });

          return {
            id: snapshot.id,
            provider: 'upstash',
            createdAt: new Date(snapshot.created_at * 1000),
            metadata: {
              name: snapshot.name,
              boxId: snapshot.box_id,
              sizeBytes: snapshot.size_bytes,
              status: snapshot.status,
            },
          };
        } catch (error) {
          throw new Error(`Failed to create Upstash snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      list: async (_config: UpstashConfig) => {
        return [];
      },

      delete: async (_config: UpstashConfig, _snapshotId: string) => {
        throw new Error(
          'Upstash snapshot deletion requires a box context. Use sandbox.getInstance().deleteSnapshot(snapshotId) instead.'
        );
      },
    },

    template: {
      create: async (_config: UpstashConfig, _options: { name: string }) => {
        throw new Error(
          'Upstash Box does not support template creation directly. Use snapshot.create() to save a box state, then Box.fromSnapshot() to restore from it.'
        );
      },

      list: async (_config: UpstashConfig) => {
        return [];
      },

      delete: async (_config: UpstashConfig, _templateId: string) => {
        // No-op - Upstash uses snapshots instead of templates
      },
    },
  },
});

// Export Upstash Box type for explicit typing
export type { Box as UpstashBox } from '@upstash/box';
