/**
 * Sandbox0 provider for ComputeSDK.
 *
 * The provider delegates lifecycle, command, and filesystem operations to the
 * official `sandbox0` JavaScript SDK.
 */

import { APIError, Client } from 'sandbox0';
import type { Sandbox as Sandbox0Sandbox } from 'sandbox0';
import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';

export interface Sandbox0Config {
  /** Team API key, or an access token when teamId is set. */
  token?: string;
  /** Team ID for access-token authentication. Falls back to SANDBOX0_TEAM_ID. */
  teamId?: string;
  /** API endpoint. Falls back to SANDBOX0_BASE_URL, then the SDK default. */
  baseUrl?: string;
  /** Default template for new sandboxes. Falls back to SANDBOX0_TEMPLATE, then `default`. */
  templateId?: string;
  /** Default soft runtime TTL in seconds. */
  ttl?: number;
  /** Default hard sandbox TTL in seconds. */
  hardTtl?: number;
  /** Default memory limit as MiB or a Kubernetes quantity such as `1Gi`. */
  memory?: number | string;
  /** Default environment variables for new sandboxes. */
  envs?: Record<string, string>;
  /** Default command timeout in milliseconds. */
  commandTimeout?: number;
}

interface SandboxObservation {
  status: string;
  createdAt: Date;
  expiresAt?: Date;
  hardExpiresAt?: Date;
  templateId?: string;
  clusterId?: string | null;
  commandTimeout?: number;
}

interface Sandbox0ClaimOptions {
  config?: {
    envVars?: Record<string, string>;
    ttl?: number;
    hardTtl?: number;
    autoResume?: boolean;
  };
  snapshotId?: string;
  memory?: string;
}

const observations = new WeakMap<Sandbox0Sandbox, SandboxObservation>();

function env(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

function resolveToken(config: Sandbox0Config): string {
  const token = config.token || env('SANDBOX0_TOKEN') || env('SANDBOX0_API_KEY');
  if (!token) {
    throw new Error(
      'Missing Sandbox0 token. Pass sandbox0({ token }) or set SANDBOX0_TOKEN or SANDBOX0_API_KEY.',
    );
  }
  return token;
}

function createClient(config: Sandbox0Config): Client {
  const teamId = config.teamId || env('SANDBOX0_TEAM_ID');
  return new Client({
    token: resolveToken(config),
    baseUrl: config.baseUrl || env('SANDBOX0_BASE_URL'),
    userAgent: '@computesdk/sandbox0',
    ...(teamId ? { headers: { 'X-Team-ID': teamId } } : {}),
  });
}

function resolveTemplate(config: Sandbox0Config, options?: CreateSandboxOptions): string {
  return options?.templateId || config.templateId || env('SANDBOX0_TEMPLATE') || 'default';
}

function optionalPositiveSeconds(name: string, value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Sandbox0 ${name} must be a positive number of seconds.`);
  }
  return Math.ceil(value);
}

function normalizeMemory(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error('Sandbox0 memory must be a positive number of MiB.');
    }
    return `${Math.ceil(value)}Mi`;
  }
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  throw new Error('Sandbox0 memory must be a positive number of MiB or a resource quantity.');
}

function buildClaimOptions(
  config: Sandbox0Config,
  options?: CreateSandboxOptions,
): Sandbox0ClaimOptions | undefined {
  const providerOptions = options as Record<string, unknown> | undefined;
  const ttl = optionalPositiveSeconds('ttl', providerOptions?.ttl ?? config.ttl);
  const hardTtl = optionalPositiveSeconds(
    'hardTtl',
    providerOptions?.hardTtl ?? config.hardTtl,
  );
  const autoResume = providerOptions?.autoResume;
  if (autoResume !== undefined && typeof autoResume !== 'boolean') {
    throw new Error('Sandbox0 autoResume must be a boolean.');
  }

  const envVars = { ...config.envs, ...options?.envs };
  const sandboxConfig = {
    ...(Object.keys(envVars).length > 0 ? { envVars } : {}),
    ...(ttl !== undefined ? { ttl } : {}),
    ...(hardTtl !== undefined ? { hardTtl } : {}),
    ...(autoResume !== undefined ? { autoResume } : {}),
  };

  const claimOptions: Sandbox0ClaimOptions = {
    ...(Object.keys(sandboxConfig).length > 0 ? { config: sandboxConfig } : {}),
    ...(options?.snapshotId ? { snapshotId: options.snapshotId } : {}),
    ...(
      providerOptions?.memory !== undefined || config.memory !== undefined
        ? { memory: normalizeMemory(providerOptions?.memory ?? config.memory) }
        : {}
    ),
  };

  return Object.keys(claimOptions).length > 0 ? claimOptions : undefined;
}

function observe(
  sandbox: Sandbox0Sandbox,
  observation: Partial<SandboxObservation> & Pick<SandboxObservation, 'status' | 'createdAt'>,
): Sandbox0Sandbox {
  observations.set(sandbox, {
    ...observations.get(sandbox),
    ...observation,
  });
  return sandbox;
}

function statusCode(error: unknown): number | undefined {
  if (error instanceof APIError) return error.statusCode;
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const value = (error as { statusCode?: unknown }).statusCode;
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
}

function isNotFound(error: unknown): boolean {
  return statusCode(error) === 404;
}

function isRetryable(error: unknown): boolean {
  const status = statusCode(error);
  return status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

function retryDelay(error: unknown, attempt: number): number {
  const retryAfter = error instanceof APIError ? error.retryAfter : undefined;
  if (retryAfter !== undefined) {
    return Math.min(retryAfter * 1_000, 2_000);
  }
  return 250 * 2 ** attempt;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function deleteWithRetry(client: Client, sandboxId: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await client.sandboxes.delete(sandboxId);
      return;
    } catch (error) {
      if (isNotFound(error)) return;
      if (!isRetryable(error) || attempt === 2) throw error;
      await sleep(retryDelay(error, attempt));
    }
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error('Sandbox0 sandbox creation was aborted.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

function mapStatus(status: string): SandboxInfo['status'] {
  switch (status) {
    case 'starting':
    case 'running':
      return 'running';
    case 'paused':
    case 'terminating':
      return 'stopped';
    default:
      return 'error';
  }
}

function commandTimeoutSeconds(value: number | undefined): number | undefined {
  if (value === undefined || value === 0) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Sandbox0 command timeout must be a non-negative number of milliseconds.');
  }
  return Math.max(1, Math.ceil(value / 1_000));
}

async function createSandbox(config: Sandbox0Config, options?: CreateSandboxOptions) {
  throwIfAborted(options?.signal);
  const client = createClient(config);
  const template = resolveTemplate(config, options);
  const claimOptions = buildClaimOptions(config, options);
  const sandbox = claimOptions
    ? await client.sandboxes.claim(template, claimOptions)
    : await client.sandboxes.claim(template);

  if (options?.signal?.aborted) {
    await deleteWithRetry(client, sandbox.id).catch(() => undefined);
    throw abortError(options.signal);
  }

  observe(sandbox, {
    status: sandbox.status || 'running',
    createdAt: new Date(),
    templateId: sandbox.template || template,
    clusterId: sandbox.clusterId,
    commandTimeout: config.commandTimeout,
  });
  return { sandbox, sandboxId: sandbox.id };
}

const _provider = defineProvider<Sandbox0Sandbox, Sandbox0Config>({
  name: 'sandbox0',
  methods: {
    sandbox: {
      create: createSandbox,

      getById: async (config, sandboxId) => {
        const client = createClient(config);
        try {
          const details = await client.sandboxes.get(sandboxId);
          const sandbox = client.sandbox(sandboxId);
          observe(sandbox, {
            status: details.status,
            createdAt: details.createdAt,
            expiresAt: details.expiresAt,
            hardExpiresAt: details.hardExpiresAt,
            templateId: details.templateId,
            commandTimeout: config.commandTimeout,
          });
          return { sandbox, sandboxId };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const sandboxes: Array<{ sandbox: Sandbox0Sandbox; sandboxId: string }> = [];
        let offset = 0;

        for (;;) {
          const page = await client.sandboxes.list({ limit: 100, offset });
          for (const summary of page.sandboxes) {
            const sandbox = client.sandbox(summary.id);
            observe(sandbox, {
              status: summary.status,
              createdAt: summary.createdAt,
              expiresAt: summary.expiresAt,
              hardExpiresAt: summary.hardExpiresAt,
              templateId: summary.templateId,
              clusterId: summary.clusterId,
              commandTimeout: config.commandTimeout,
            });
            sandboxes.push({ sandbox, sandboxId: summary.id });
          }

          if (!page.hasMore || page.sandboxes.length === 0) break;
          offset += page.sandboxes.length;
        }
        return sandboxes;
      },

      destroy: async (config, sandboxId) => {
        await deleteWithRetry(createClient(config), sandboxId);
      },

      runCommand: async (
        sandbox,
        command,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const startedAt = Date.now();
        const timeout = options?.timeout ?? observations.get(sandbox)?.commandTimeout;
        const result = await sandbox.cmd(command, {
          command: ['sh', '-lc', command],
          wait: !options?.background,
          cwd: options?.cwd,
          envVars: options?.env,
          ttlSec: commandTimeoutSeconds(timeout),
        });
        return {
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exitCode: result.exitCode ?? (options?.background ? 0 : 1),
          durationMs: Date.now() - startedAt,
        };
      },

      getInfo: async (sandbox): Promise<SandboxInfo> => {
        const observation = observations.get(sandbox);
        const status = observation?.status || sandbox.status;
        return {
          id: sandbox.id,
          provider: 'sandbox0',
          status: mapStatus(status),
          createdAt: observation?.createdAt || new Date(),
          timeout: observation?.commandTimeout || 0,
          metadata: {
            sandbox0Status: status,
            templateId: observation?.templateId || sandbox.template || undefined,
            clusterId: observation?.clusterId ?? sandbox.clusterId,
            expiresAt: observation?.expiresAt,
            hardExpiresAt: observation?.hardExpiresAt,
          },
        };
      },

      getUrl: async (sandbox, options): Promise<string> => {
        const response = await sandbox.getServices();
        const service = response.services.find(
          (candidate) => candidate.port === options.port && candidate.publicUrl,
        );
        if (!service?.publicUrl) {
          throw new Error(
            `Sandbox0 has no public service configured for port ${options.port}. ` +
              'Configure a public Sandbox0 service before calling getUrl().',
          );
        }
        if (!options.protocol) return service.publicUrl;
        const url = new URL(service.publicUrl);
        url.protocol = `${options.protocol.replace(/:$/, '')}:`;
        return url.toString();
      },

      filesystem: {
        readFile: async (sandbox, path): Promise<string> => {
          const data = await sandbox.readFile(path);
          return new TextDecoder().decode(data);
        },
        writeFile: async (sandbox, path, content): Promise<void> => {
          await sandbox.writeFile(path, content);
        },
        mkdir: async (sandbox, path): Promise<void> => {
          await sandbox.mkdir(path, true);
        },
        readdir: async (sandbox, path): Promise<FileEntry[]> => {
          const entries = await sandbox.listFiles(path);
          return entries.map((entry) => ({
            name: entry.name || entry.path?.split('/').filter(Boolean).pop() || '',
            type: entry.type === 'dir' ? 'directory' as const : 'file' as const,
            size: entry.size,
            modified: entry.modTime,
          }));
        },
        exists: async (sandbox, path): Promise<boolean> => {
          try {
            await sandbox.statFile(path);
            return true;
          } catch (error) {
            if (isNotFound(error)) return false;
            throw error;
          }
        },
        remove: async (sandbox, path): Promise<void> => {
          try {
            await sandbox.deleteFile(path);
          } catch (error) {
            if (!isNotFound(error)) throw error;
          }
        },
      },

      getInstance: (sandbox): Sandbox0Sandbox => sandbox,
    },
  },
});

export const sandbox0 = (config: Sandbox0Config = {}) => _provider(config);
export type { Sandbox0Sandbox };
