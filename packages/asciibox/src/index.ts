/**
 * ASCII Box Provider - Factory-based Implementation
 *
 * ComputeSDK provider for ASCII Box cloud sandboxes.
 */

import {
  BoxApi,
  Configuration,
  waitUntilReady,
  execCommand,
  readText,
  writeText,
  stopAndRemove,
} from '@asciidev/box-sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { Box, CommandResponse } from '@asciidev/box-sdk';
import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from 'computesdk';

/**
 * ASCII Box-specific configuration options
 */
export interface AsciiBoxConfig {
  /** ASCII Box API key - if not provided, will fallback to ASCIIBOX_API_KEY or BOX_API_KEY environment variable */
  apiKey?: string;
  /** ASCII Box API base URL - defaults to https://ascii.dev/api/box/v1 */
  basePath?: string;
  /** Machine size: small (2 vCPU / 4 GB), default (4 vCPU / 8 GB), or large (8 vCPU / 16 GB) */
  type?: 'small' | 'default' | 'large';
  /** ASCII Box environment to attach (defaults to account default) */
  environment?: string;
}

interface AsciiBoxSandbox {
  api: BoxApi;
  box: Box;
}

function getApiKey(config: AsciiBoxConfig): string | undefined {
  return config.apiKey ?? process.env.ASCIIBOX_API_KEY ?? process.env.BOX_API_KEY;
}

function getBasePath(config: AsciiBoxConfig): string {
  return (
    config.basePath ??
    process.env.ASCIIBOX_BASE_URL ??
    process.env.BOX_BASE_URL ??
    'https://ascii.dev/api/box/v1'
  );
}

function createBoxApi(config: AsciiBoxConfig): BoxApi {
  const apiKey = getApiKey(config);
  if (!apiKey) {
    throw new Error(
      'Missing ASCII Box API key.\n\n' +
        'Get your key at https://ascii.dev/box/settings/api-keys\n' +
        'Then pass it: asciiBox({ apiKey: "xxx" })\n' +
        'Or set ASCIIBOX_API_KEY (or BOX_API_KEY) in your environment.'
    );
  }

  return new BoxApi(
    new Configuration({
      basePath: getBasePath(config),
      accessToken: apiKey,
    })
  );
}

function isCommandResponse(response: unknown): response is CommandResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'stdout' in response &&
    'stderr' in response &&
    'exitCode' in response
  );
}

export const asciiBox = defineProvider<AsciiBoxSandbox, AsciiBoxConfig>({
  name: 'asciibox',
  methods: {
    sandbox: {
      create: async (config: AsciiBoxConfig, options?: CreateSandboxOptions) => {
        const api = createBoxApi(config);

        const {
          timeout: optTimeout,
          envs,
          name: _name,
          metadata,
          templateId: _templateId,
          snapshotId: _snapshotId,
          sandboxId: optSandboxId,
          namespace: _namespace,
          directory: _directory,
          ...providerOptions
        } = options || {};

        const ttlSeconds = optTimeout ? Math.ceil(optTimeout / 1000) : 1800;

        try {
          const response = await api.create({
            createBoxRequest: {
              type: config.type,
              ttlSeconds,
              environment: config.environment,
              env: envs,
              ...providerOptions,
            },
          });

          const box = response.box;

          if (!box?.id) {
            throw new Error('ASCII Box create() returned box without an ID');
          }

          await waitUntilReady(api, box.id, {
            timeoutMs: optTimeout ?? 300000,
          });

          return {
            sandbox: { api, box },
            sandboxId: box.id,
          };
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          if (
            detail.includes('unauthorized') ||
            detail.includes('Unauthorized') ||
            detail.includes('API key')
          ) {
            throw new Error(
              `ASCII Box authentication failed. Please check your ASCIIBOX_API_KEY environment variable.`
            );
          }
          throw new Error(`Failed to create ASCII Box sandbox: ${detail}`);
        }
      },

      getById: async (config: AsciiBoxConfig, sandboxId: string) => {
        const api = createBoxApi(config);
        try {
          const response = await api.get({ boxId: sandboxId });
          const box = response.box;
          if (!box?.id) return null;
          return { sandbox: { api, box }, sandboxId: box.id };
        } catch {
          return null;
        }
      },

      list: async (config: AsciiBoxConfig) => {
        const api = createBoxApi(config);
        try {
          const response = await api.boxes({});
          return (response.boxes || []).map((box) => ({
            sandbox: { api, box },
            sandboxId: box.id,
          }));
        } catch {
          return [];
        }
      },

      destroy: async (config: AsciiBoxConfig, sandboxId: string) => {
        const api = createBoxApi(config);
        try {
          await stopAndRemove(api, sandboxId, { delete: true });
        } catch {
          // Sandbox might already be destroyed or does not exist
        }
      },

      runCommand: async (
        sandbox: AsciiBoxSandbox,
        command: string,
        options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const startTime = Date.now();

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
          fullCommand = `nohup sh -c '${fullCommand.replace(/'/g, "'\\''")}' > /dev/null 2>&1 &`;
        }

        const timeoutSeconds = options?.timeout ? Math.ceil(options.timeout / 1000) : 60;

        try {
          const response = await execCommand(
            sandbox.api,
            sandbox.box.id,
            fullCommand,
            undefined,
            timeoutSeconds
          );

          if (isCommandResponse(response)) {
            return {
              stdout: response.stdout || '',
              stderr: response.stderr || '',
              exitCode: response.exitCode ?? 0,
              durationMs: Date.now() - startTime,
            };
          }

          return {
            stdout: '',
            stderr: '',
            exitCode: 0,
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

      getInfo: async (sandbox: AsciiBoxSandbox): Promise<SandboxInfo> => ({
        id: sandbox.box.id,
        provider: 'asciibox',
        status: convertBoxState(sandbox.box.state),
        createdAt: sandbox.box.createdAt ? new Date(sandbox.box.createdAt) : new Date(),
        timeout: sandbox.box.archiveAfter
          ? new Date(sandbox.box.archiveAfter).getTime() - Date.now()
          : 300000,
        metadata: {
          name: sandbox.box.name,
          type: sandbox.box.type,
          vcpu: sandbox.box.vcpu,
          memoryGB: sandbox.box.memoryGB,
          environment: sandbox.box.environment,
        },
      }),

      getUrl: async (
        sandbox: AsciiBoxSandbox,
        options: { port: number; protocol?: string }
      ): Promise<string> => {
        try {
          const response = await sandbox.api.hostPort({
            boxId: sandbox.box.id,
            hostPortRequest: {
              port: options.port,
              _public: true,
            },
          });

          const url = response.url;
          if (!url) {
            throw new Error(`Failed to get ASCII Box host for port ${options.port}`);
          }

          if (options.protocol) {
            return url.replace(/^https?:/, `${options.protocol}:`);
          }

          return url;
        } catch (error) {
          throw new Error(
            `Failed to get ASCII Box URL for port ${options.port}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      },

      filesystem: {
        readFile: async (
          sandbox: AsciiBoxSandbox,
          path: string,
          _runCommand
        ): Promise<string> => {
          try {
            return await readText(sandbox.api, sandbox.box.id, path);
          } catch (error) {
            throw new Error(
              `Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        },

        writeFile: async (
          sandbox: AsciiBoxSandbox,
          path: string,
          content: string,
          _runCommand
        ): Promise<void> => {
          try {
            await writeText(sandbox.api, sandbox.box.id, path, content);
          } catch (error) {
            throw new Error(
              `Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        },

        mkdir: async (
          sandbox: AsciiBoxSandbox,
          path: string,
          _runCommand
        ): Promise<void> => {
          const result = await execCommand(
            sandbox.api,
            sandbox.box.id,
            `mkdir -p "${escapeShellArg(path)}"`
          );
          if (isCommandResponse(result) && result.exitCode !== 0) {
            throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
          }
        },

        readdir: async (
          sandbox: AsciiBoxSandbox,
          path: string,
          _runCommand
        ): Promise<FileEntry[]> => {
          const result = await execCommand(
            sandbox.api,
            sandbox.box.id,
            `ls -la "${escapeShellArg(path)}"`
          );
          if (!isCommandResponse(result)) {
            return [];
          }
          if (result.exitCode !== 0) {
            throw new Error(`Failed to list directory ${path}: ${result.stderr}`);
          }

          const entries: FileEntry[] = [];
          for (const line of result.stdout.trim().split('\n')) {
            if (!line || line.startsWith('total')) continue;
            const parts = line.split(/\s+/);
            if (parts.length < 9) continue;
            const name = parts.slice(8).join(' ');
            if (name === '.' || name === '..') continue;
            const size = parseInt(parts[4], 10) || 0;
            const isDirectory = parts[0].startsWith('d');
            entries.push({
              name,
              type: isDirectory ? ('directory' as const) : ('file' as const),
              size,
              modified: new Date(),
            });
          }
          return entries;
        },

        exists: async (
          sandbox: AsciiBoxSandbox,
          path: string,
          _runCommand
        ): Promise<boolean> => {
          const result = await execCommand(
            sandbox.api,
            sandbox.box.id,
            `test -e "${escapeShellArg(path)}"`
          );
          return isCommandResponse(result) && result.exitCode === 0;
        },

        remove: async (
          sandbox: AsciiBoxSandbox,
          path: string,
          _runCommand
        ): Promise<void> => {
          const result = await execCommand(
            sandbox.api,
            sandbox.box.id,
            `rm -rf "${escapeShellArg(path)}"`
          );
          if (isCommandResponse(result) && result.exitCode !== 0) {
            throw new Error(`Failed to remove ${path}: ${result.stderr}`);
          }
        },
      },

      getInstance: (sandbox: AsciiBoxSandbox): AsciiBoxSandbox => sandbox,
    },

    snapshot: {
      create: async (
        _config: AsciiBoxConfig,
        _sandboxId: string,
        _options?: { name?: string }
      ) => {
        throw new Error(
          'ASCII Box snapshots are not supported through this provider yet. Use the ASCII Box dashboard or CLI to manage snapshots.'
        );
      },
      list: async (_config: AsciiBoxConfig) => {
        throw new Error(
          'ASCII Box snapshots are not supported through this provider yet. Use the ASCII Box dashboard or CLI to manage snapshots.'
        );
      },
      delete: async (_config: AsciiBoxConfig, _snapshotId: string) => {
        throw new Error(
          'ASCII Box snapshots are not supported through this provider yet. Use the ASCII Box dashboard or CLI to manage snapshots.'
        );
      },
    },

    template: {
      create: async (_config: AsciiBoxConfig, _options: { name: string }) => {
        throw new Error(
          'ASCII Box templates (environments) must be managed via the ASCII Box dashboard or CLI.'
        );
      },
      list: async (_config: AsciiBoxConfig) => {
        throw new Error(
          'ASCII Box templates (environments) must be managed via the ASCII Box dashboard or CLI.'
        );
      },
      delete: async (_config: AsciiBoxConfig, _templateId: string) => {
        throw new Error(
          'ASCII Box templates (environments) must be managed via the ASCII Box dashboard or CLI.'
        );
      },
    },
  },
});

function convertBoxState(state?: string): 'running' | 'stopped' | 'error' {
  switch (state?.toLowerCase()) {
    case 'ready':
    case 'idle':
    case 'running':
    case 'provisioning':
    case 'provisioned':
      return 'running';
    case 'archived':
    case 'archiving':
      return 'stopped';
    case 'error':
      return 'error';
    default:
      return 'running';
  }
}
