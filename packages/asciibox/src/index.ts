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

const DEFAULT_PROVISION_TIMEOUT_MS = 300000;

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

function getErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { status?: number } }).response;
    return response?.status;
  }
  return undefined;
}

function isNotFound(error: unknown): boolean {
  const status = getErrorStatus(error);
  return status === 404 || status === 410;
}

function isAuthError(error: unknown): boolean {
  const status = getErrorStatus(error);
  return status === 401 || status === 403;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function validateEnvKey(key: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
    throw new Error(
      `Invalid environment variable name: ${key}. Variable names must match /^[a-zA-Z_][a-zA-Z0-9_]*$/.`
    );
  }
  return key;
}

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function parseLsDate(parts: string[], fallback: Date): Date {
  if (parts.length < 8) return fallback;
  const month = MONTHS[parts[5]];
  const day = parseInt(parts[6], 10);
  const timeOrYear = parts[7];
  if (month === undefined || Number.isNaN(day)) return fallback;

  if (timeOrYear.includes(':')) {
    const [hours, minutes] = timeOrYear.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return fallback;
    return new Date(new Date().getFullYear(), month, day, hours, minutes);
  }

  const year = parseInt(timeOrYear, 10);
  if (Number.isNaN(year)) return fallback;
  return new Date(year, month, day);
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
          metadata: _metadata,
          templateId,
          snapshotId,
          sandboxId: _sandboxId,
          namespace: _namespace,
          directory: _directory,
          signal: _signal,
          environment: optEnvironment,
          ...providerOptions
        } = options || {};

        const ttlSeconds = optTimeout ? Math.ceil(optTimeout / 1000) : 1800;
        let box: Box | undefined;

        try {
          const response = await api.create({
            createBoxRequest: {
              type: config.type,
              ttlSeconds,
              environment: templateId ?? optEnvironment ?? config.environment,
              env: envs,
              from: snapshotId,
              ...providerOptions,
            } as any,
          });

          box = response.box;

          if (!box?.id) {
            throw new Error('ASCII Box create() returned box without an ID');
          }

          try {
            await waitUntilReady(api, box.id, {
              timeoutMs: DEFAULT_PROVISION_TIMEOUT_MS,
            });
          } catch (waitError) {
            // Best-effort cleanup so a readiness failure does not leak the box
            await stopAndRemove(api, box.id, { delete: true }).catch(() => {});
            throw waitError;
          }

          return {
            sandbox: { api, box },
            sandboxId: box.id,
          };
        } catch (error) {
          if (isAuthError(error)) {
            throw new Error(
              'ASCII Box authentication failed. Please check your ASCIIBOX_API_KEY environment variable.'
            );
          }
          throw new Error(`Failed to create ASCII Box sandbox: ${formatError(error)}`);
        }
      },

      getById: async (config: AsciiBoxConfig, sandboxId: string) => {
        const api = createBoxApi(config);
        try {
          const response = await api.get({ boxId: sandboxId });
          const box = response.box;
          if (!box?.id) return null;
          return { sandbox: { api, box }, sandboxId: box.id };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw new Error(
            `Failed to get ASCII Box sandbox ${sandboxId}: ${formatError(error)}`
          );
        }
      },

      list: async (config: AsciiBoxConfig) => {
        const api = createBoxApi(config);
        try {
          const boxes: Box[] = [];
          let cursor: string | null | undefined;

          while (true) {
            const response = await api.boxes({ cursor });
            boxes.push(...(response.boxes || []));

            const pageInfo = response.pageInfo;
            if (!pageInfo?.hasMore || !pageInfo?.nextCursor) break;
            cursor = pageInfo.nextCursor;
          }

          return boxes.map((box) => ({
            sandbox: { api, box },
            sandboxId: box.id,
          }));
        } catch (error) {
          throw new Error(`Failed to list ASCII Box sandboxes: ${formatError(error)}`);
        }
      },

      destroy: async (config: AsciiBoxConfig, sandboxId: string) => {
        const api = createBoxApi(config);
        try {
          await stopAndRemove(api, sandboxId, { delete: true });
        } catch (error) {
          if (isNotFound(error)) return;
          throw new Error(
            `Failed to destroy ASCII Box sandbox ${sandboxId}: ${formatError(error)}`
          );
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
            .map(([k, v]) => `${validateEnvKey(k)}="${escapeShellArg(String(v))}"`)
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
              exitCode: response.exitCode ?? (response.timedOut ? 124 : -1),
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
            stderr: formatError(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (sandbox: AsciiBoxSandbox): Promise<SandboxInfo> => {
        let box: Box | undefined;
        try {
          const response = await sandbox.api.get({ boxId: sandbox.box.id });
          box = response.box;
        } catch (error) {
          if (isNotFound(error) || isAuthError(error)) {
            throw new Error(
              `Failed to get info for ASCII Box sandbox ${sandbox.box.id}: ${formatError(error)}`
            );
          }
          // Fall back to the cached box on transient failures
          box = sandbox.box;
        }

        box ??= sandbox.box;

        return {
          id: box.id,
          provider: 'asciibox',
          status: convertBoxState(box.state),
          createdAt: box.createdAt ? new Date(box.createdAt) : new Date(),
          timeout: box.archiveAfter
            ? new Date(box.archiveAfter).getTime() - Date.now()
            : 300000,
          metadata: {
            name: box.name,
            type: box.type,
            vcpu: box.vcpu,
            memoryGB: box.memoryGB,
            environment: box.environment,
          },
        };
      },

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
            `Failed to get ASCII Box URL for port ${options.port}: ${formatError(error)}`
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
            throw new Error(`Failed to read file ${path}: ${formatError(error)}`);
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
            throw new Error(`Failed to write file ${path}: ${formatError(error)}`);
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
            const rawName = parts.slice(8).join(' ');
            if (rawName === '.' || rawName === '..') continue;
            const isSymlink = parts[0].startsWith('l');
            const name = isSymlink ? rawName.split(' -> ')[0] : rawName;
            const size = parseInt(parts[4], 10) || 0;
            const isDirectory = parts[0].startsWith('d');
            entries.push({
              name,
              type: isDirectory ? ('directory' as const) : ('file' as const),
              size,
              modified: parseLsDate(parts, new Date()),
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
