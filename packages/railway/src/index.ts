/**
 * Railway Provider - Factory-based Implementation
 *
 * Wraps Railway Sandboxes (https://docs.railway.com/sandboxes) using the
 * ComputeSDK provider factory. Railway exposes command execution via
 * `sandbox.exec`; it has no dedicated filesystem or port-exposure API, so the
 * filesystem block is implemented over the shell and `getUrl` throws.
 */

import { Sandbox, SandboxNotFoundError } from 'railway';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, RunCommandOptions, SandboxInfo, CreateTemplateOptions } from '@computesdk/provider';
import type { CreateSandboxOptions, FileEntry } from 'computesdk';

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
function mapStatus(status: string): SandboxInfo['status'] {
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

/** Valid POSIX shell environment variable name. Keys cannot be quoted in an
 * assignment prefix, so anything outside this set is rejected rather than escaped. */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Apply env/cwd/background options by composing a single shell command string. */
function composeCommand(command: string, options?: RunCommandOptions): string {
  let fullCommand = command;

  if (options?.env && Object.keys(options.env).length > 0) {
    const envPrefix = Object.entries(options.env)
      .map(([k, v]) => {
        if (!ENV_KEY_PATTERN.test(k)) {
          throw new Error(
            `Invalid environment variable name "${k}". Names must match ${ENV_KEY_PATTERN}.`
          );
        }
        return `${k}="${escapeShellArg(String(v))}"`;
      })
      .join(' ');
    fullCommand = `${envPrefix} ${fullCommand}`;
  }

  if (options?.cwd) {
    fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
  }

  if (options?.background) {
    fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
  }

  return fullCommand;
}

export const railway = defineProvider<RailwaySandbox, RailwayConfig>({
  name: 'railway',
  methods: {
    sandbox: {
      create: async (config: RailwayConfig, options?: CreateSandboxOptions) => {
        const client = resolveClientOptions(config);

        try {
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

          return { sandbox, sandboxId: sandbox.id };
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
          return { sandbox, sandboxId };
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
              return { sandbox, sandboxId: info.id };
            })
          );
          return connected
            .filter(
              (r): r is PromiseFulfilledResult<{ sandbox: RailwaySandbox; sandboxId: string }> =>
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
        const fullCommand = composeCommand(command, options);
        const timeoutSec = options?.timeout ? Math.ceil(options.timeout / 1000) : undefined;

        try {
          const result = await sandbox.exec(
            fullCommand,
            timeoutSec ? { timeoutSec } : undefined
          );
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            // exitCode is null when a signal ended the command; surface as -1
            exitCode: result.exitCode ?? -1,
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

      getInfo: async (sandbox: RailwaySandbox): Promise<SandboxInfo> => ({
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
        readFile: async (sandbox: RailwaySandbox, path: string, runCommand: CommandRunner): Promise<string> => {
          const arg = escapeShellArg(path);
          const result = await runCommand(sandbox, `test -f "${arg}" && base64 < "${arg}" | tr -d '\\n'`);
          if (result.exitCode !== 0) throw new Error(`File not found or unreadable: ${path}`);
          return Buffer.from(result.stdout, 'base64').toString('utf8');
        },

        writeFile: async (sandbox: RailwaySandbox, path: string, content: string, runCommand: CommandRunner): Promise<void> => {
          const arg = escapeShellArg(path);
          const encoded = Buffer.from(content).toString('base64');
          const result = await runCommand(sandbox, `echo "${encoded}" | base64 -d > "${arg}"`);
          if (result.exitCode !== 0) throw new Error(`Failed to write file ${path}: ${result.stderr}`);
        },

        mkdir: async (sandbox: RailwaySandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          const result = await runCommand(sandbox, `mkdir -p "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
        },

        readdir: async (sandbox: RailwaySandbox, path: string, runCommand: CommandRunner): Promise<FileEntry[]> => {
          const result = await runCommand(sandbox, `ls -la "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) throw new Error(`Failed to list directory ${path}: ${result.stderr}`);

          return (result.stdout || '')
            .split('\n')
            .filter((line) => line.trim() && !line.startsWith('total'))
            .map((line) => {
              // `ls -la` columns: perms links owner group size month day time name…
              // The name is everything from the 9th column on, so it survives spaces.
              const parts = line.trim().split(/\s+/);
              const name = parts.slice(8).join(' ');
              const isDirectory = line.startsWith('d');
              return {
                name,
                type: isDirectory ? ('directory' as const) : ('file' as const),
                size: parseInt(parts[4]) || 0,
                modified: new Date(),
              };
            })
            .filter((entry) => entry.name && entry.name !== '.' && entry.name !== '..');
        },

        exists: async (sandbox: RailwaySandbox, path: string, runCommand: CommandRunner): Promise<boolean> => {
          const result = await runCommand(sandbox, `test -e "${escapeShellArg(path)}"`);
          return result.exitCode === 0;
        },

        remove: async (sandbox: RailwaySandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          const result = await runCommand(sandbox, `rm -rf "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) throw new Error(`Failed to remove ${path}: ${result.stderr}`);
        },
      },

      getInstance: (sandbox: RailwaySandbox): RailwaySandbox => sandbox,
    },

    template: {
      create: async (config: RailwayConfig, options: CreateTemplateOptions) => {
        const client = resolveClientOptions(config);

        // Mode 1: Capture from running sandbox
        // Railway supports checkpointing running sandboxes via sandbox.checkpoint(name).
        if (options.from) {
          try {
            const sandbox = await Sandbox.connect(options.from, client);
            const checkpoint = await sandbox.checkpoint(options.name);
            return {
              id: checkpoint.id,
              provider: 'railway',
              name: checkpoint.key,
              createdAt: new Date(checkpoint.createdAt),
              status: 'active' as const,
              metadata: {
                ...options.metadata,
                source: 'capture',
                sandboxId: options.from,
                checkpointId: checkpoint.id,
              },
            };
          } catch (error) {
            throw new Error(
              `Failed to capture Railway template from sandbox: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }

        // Mode 2: Build from spec using Sandbox.template() builder.
        // Railway's template builder creates immutable base recipes from shell
        // commands, apt packages, env vars, and workdir — not from raw
        // Dockerfiles. We translate Dockerfile instructions where possible.
        try {
          let template = Sandbox.template();

          if (options.dockerfile) {
            const lines = options.dockerfile
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l && !l.startsWith('#'));

            const collectedEnv: Record<string, string> = {};

            for (const line of lines) {
              if (/^FROM\s+/i.test(line)) {
                // Railway's template builder does not support custom base
                // images (FROM). The base is Railway's default; FROM is
                // acknowledged but cannot be applied.
                continue;
              } else if (/^RUN\s+/i.test(line)) {
                template = template.run(line.replace(/^RUN\s+/i, '').trim());
              } else if (/^ENV\s+/i.test(line)) {
                const envPart = line.replace(/^ENV\s+/i, '').trim();
                // ENV supports both KEY=VALUE and KEY VALUE syntax
                const eqMatch = envPart.match(/^(\S+)=(.*)$/);
                if (eqMatch) {
                  collectedEnv[eqMatch[1]] = eqMatch[2].replace(/^["']|["']$/g, '');
                } else {
                  const parts = envPart.split(/\s+/);
                  if (parts.length >= 2) {
                    collectedEnv[parts[0]] = parts.slice(1).join(' ');
                  }
                }
              } else if (/^WORKDIR\s+/i.test(line)) {
                template = template.workdir(line.replace(/^WORKDIR\s+/i, '').trim());
              }
              // COPY, ADD, EXPOSE, CMD, ENTRYPOINT etc. are not supported by
              // Railway's template builder and are silently skipped.
            }

            if (Object.keys(collectedEnv).length > 0) {
              template = template.withEnv(collectedEnv);
            }
          }

          // Apply envs from options (layered over any Dockerfile-parsed env)
          if (options.envs) {
            template = template.withEnv(options.envs);
          }

          // Apply start command as a build step
          if (options.startCommand) {
            template = template.run(options.startCommand);
          }

          // Build the template
          const builtTemplate = await template.build({
            token: client.token,
            environmentId: client.environmentId,
          });

          return {
            id: options.name,
            provider: 'railway',
            name: options.name,
            createdAt: new Date(),
            status: 'active' as const,
            metadata: {
              ...options.metadata,
              source: 'build',
              template: builtTemplate,
            },
          };
        } catch (error) {
          throw new Error(
            `Failed to create Railway template: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      list: async (config: RailwayConfig) => {
        const client = resolveClientOptions(config);
        try {
          const checkpoints = await Sandbox.checkpoints(client);
          return checkpoints.map((cp) => ({
            id: cp.id,
            provider: 'railway',
            name: cp.key,
            createdAt: new Date(cp.createdAt),
            status: 'active' as const,
            metadata: {
              checkpointId: cp.id,
              environmentId: cp.environmentId,
            },
          }));
        } catch {
          return [];
        }
      },

      delete: async (config: RailwayConfig, templateId: string) => {
        const client = resolveClientOptions(config);
        try {
          await Sandbox.deleteCheckpoint(templateId, client);
        } catch (error) {
          throw new Error(
            `Failed to delete Railway template: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },
    },
  },
});

export type { Sandbox as RailwaySandbox } from 'railway';
