import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type {
  CommandResult,
  CreateSandboxOptions,
  CreateSnapshotOptions,
  FileEntry,
  ListSnapshotsOptions,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';
import type { Snapshot } from 'computesdk';

const PROVIDER = 'quilt' as const;
const DEFAULT_IMAGE = 'prod';
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_POLL_INTERVAL_MS = 1000;

type QuiltAuthMode = 'apiKey' | 'accessToken';
type QuiltServiceAuthMode = 'service_token' | 'public';
type QuiltContainerState = 'created' | 'starting' | 'running' | 'exited' | 'error';
type QuiltCommandRunner = (
  sandbox: QuiltSandboxHandle,
  command: string,
  options?: RunCommandOptions
) => Promise<CommandResult>;

export interface QuiltConfig {
  baseUrl?: string;
  apiKey?: string;
  accessToken?: string;
  tenantId?: string;
  image?: string;
  timeout?: number;
  publishedServiceAuthMode?: QuiltServiceAuthMode;
  publishedServiceTtlSecs?: number;
  pollIntervalMs?: number;
}

interface QuiltResolvedConfig {
  baseUrl: string;
  authMode: QuiltAuthMode;
  authToken: string;
  tenantId?: string;
  image: string;
  timeout: number;
  publishedServiceAuthMode: QuiltServiceAuthMode;
  publishedServiceTtlSecs?: number;
  pollIntervalMs: number;
}

interface QuiltContainer {
  container_id: string;
  tenant_id?: string;
  name?: string;
  state?: QuiltContainerState;
  created_at?: string;
  started_at?: string | null;
  exited_at?: string | null;
  ip_address?: string | null;
  exec_ready?: boolean;
  network_ready?: boolean;
  labels?: Record<string, string>;
  [key: string]: unknown;
}

interface QuiltOperationRecord {
  operation_id: string;
  operation_type?: string;
  status?: string;
  target_resource_type?: string | null;
  target_resource_id?: string | null;
  result?: Record<string, unknown> | null;
  snapshot_id?: string | null;
  container_id?: string | null;
  error?: string;
  error_message?: string;
  message?: string;
}

interface QuiltService {
  service_id: string;
  target_port: number;
  protocol: string;
  enable_websockets?: boolean;
  auth_mode?: QuiltServiceAuthMode;
  public_url?: string;
  websocket_url?: string;
  status?: string;
}

interface QuiltSnapshotRecord {
  snapshot_id: string;
  source_container_id?: string | null;
  labels?: Record<string, string>;
  created_at?: number | string;
  expires_at?: number | string | null;
  pinned?: boolean;
}

interface QuiltSandboxHandle {
  config: QuiltResolvedConfig;
  sandboxId: string;
  container: QuiltContainer;
}

function getEnv(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

function resolveConfig(config: QuiltConfig): QuiltResolvedConfig {
  const baseUrl = config.baseUrl ?? getEnv('QUILT_BASE_URL') ?? getEnv('QUILT_API_BASE_URL');
  if (!baseUrl) {
    throw new Error(
      'Missing Quilt base URL.\n\n' +
        "Pass it: quilt({ baseUrl: 'https://backend.example.com' })\n" +
        'Or set QUILT_BASE_URL in your environment.'
    );
  }

  const apiKey = config.apiKey ?? getEnv('QUILT_API_KEY');
  const accessToken = config.accessToken ?? getEnv('QUILT_ACCESS_TOKEN');

  if (!apiKey && !accessToken) {
    throw new Error(
      'Missing Quilt credentials.\n\n' +
        'Provide apiKey or accessToken in config:\n' +
        "  quilt({ baseUrl: 'https://backend.example.com', apiKey: 'xxx' })\n" +
        'Or set QUILT_API_KEY or QUILT_ACCESS_TOKEN in your environment.'
    );
  }

  const tenantId = config.tenantId ?? getEnv('QUILT_TENANT_ID');
  const timeoutFromEnv = getEnv('QUILT_TIMEOUT_MS');
  const pollFromEnv = getEnv('QUILT_POLL_INTERVAL_MS');
  const ttlFromEnv = getEnv('QUILT_PUBLISHED_SERVICE_TTL_SECS');
  const authModeFromEnv = getEnv('QUILT_PUBLISHED_SERVICE_AUTH_MODE');

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    authMode: apiKey ? 'apiKey' : 'accessToken',
    authToken: apiKey ?? accessToken ?? '',
    tenantId,
    image: config.image ?? getEnv('QUILT_IMAGE') ?? DEFAULT_IMAGE,
    timeout: config.timeout ?? parseOptionalInt(timeoutFromEnv) ?? DEFAULT_TIMEOUT_MS,
    publishedServiceAuthMode:
      config.publishedServiceAuthMode ??
      (authModeFromEnv === 'public' ? 'public' : 'service_token'),
    publishedServiceTtlSecs:
      config.publishedServiceTtlSecs ?? parseOptionalInt(ttlFromEnv) ?? undefined,
    pollIntervalMs: config.pollIntervalMs ?? parseOptionalInt(pollFromEnv) ?? DEFAULT_POLL_INTERVAL_MS,
  };
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildHeaders(config: QuiltResolvedConfig, includeTenantHeader = false): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (config.authMode === 'apiKey') {
    headers['X-Api-Key'] = config.authToken;
  } else {
    headers.Authorization = `Bearer ${config.authToken}`;
  }

  if (includeTenantHeader) {
    if (!config.tenantId) {
      throw new Error(
        'Quilt snapshot operations require tenantId.\n\n' +
          "Pass it: quilt({ tenantId: 'tenant_123', ... })\n" +
          'Or set QUILT_TENANT_ID in your environment.'
      );
    }
    headers['X-Tenant-Id'] = config.tenantId;
  }

  return headers;
}

async function requestJson<T>(
  config: QuiltResolvedConfig,
  path: string,
  init: RequestInit = {},
  options: { includeTenantHeader?: boolean; allow404?: boolean } = {}
): Promise<T | null> {
  const headers = {
    ...buildHeaders(config, options.includeTenantHeader),
    ...(init.headers || {}),
  };

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers,
  });

  if (options.allow404 && response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await buildHttpError(response, path);
  }

  if (response.status === 204) {
    return null;
  }

  return (await response.json()) as T;
}

async function requestNoContent(
  config: QuiltResolvedConfig,
  path: string,
  init: RequestInit = {},
  options: { includeTenantHeader?: boolean; allow404?: boolean } = {}
): Promise<void> {
  const headers = {
    ...buildHeaders(config, options.includeTenantHeader),
    ...(init.headers || {}),
  };

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers,
  });

  if (options.allow404 && response.status === 404) {
    return;
  }

  if (!response.ok) {
    throw await buildHttpError(response, path);
  }
}

async function buildHttpError(response: Response, path: string): Promise<Error> {
  let detail = `${response.status} ${response.statusText}`;
  try {
    const body = await response.json();
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      detail =
        (typeof record.error === 'string' && record.error) ||
        (typeof record.message === 'string' && record.message) ||
        detail;
    }
  } catch {
    try {
      const text = await response.text();
      if (text) detail = text;
    } catch {
      // noop
    }
  }
  return new Error(`Quilt API request failed for ${path}: ${detail}`);
}

function buildExecCommand(command: string, options?: RunCommandOptions): string {
  let fullCommand = command;

  if (options?.env && Object.keys(options.env).length > 0) {
    const envPrefix = Object.entries(options.env)
      .map(([key, value]) => {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          throw new Error(`Invalid environment variable name "${key}".`);
        }
        return `${key}="${escapeShellArg(String(value))}"`;
      })
      .join(' ');
    fullCommand = `${envPrefix} ${fullCommand}`;
  }

  if (options?.background) {
    fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
  }

  return fullCommand;
}

function mapStatus(state: QuiltContainerState | undefined): SandboxInfo['status'] {
  switch (state) {
    case 'error':
      return 'error';
    case 'created':
    case 'starting':
    case 'running':
      return 'running';
    case 'exited':
    default:
      return 'stopped';
  }
}

function parseDate(value: string | number | null | undefined): Date {
  if (typeof value === 'number') return new Date(value * 1000);
  if (typeof value === 'string') return new Date(value);
  return new Date();
}

function normalizeFileEntries(stdout: string): FileEntry[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('total '))
    .flatMap(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 9) return [];
      const name = parts.slice(8).join(' ');
      if (name === '.' || name === '..') return [];
      return [
        {
          name,
          type: parts[0]?.startsWith('d') ? 'directory' : 'file',
          size: Number.parseInt(parts[4] ?? '0', 10) || 0,
          modified: new Date(),
        } satisfies FileEntry,
      ];
    });
}

async function pollOperation(
  config: QuiltResolvedConfig,
  operationId: string,
  timeoutMs: number
): Promise<QuiltOperationRecord> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const operation = await requestJson<QuiltOperationRecord>(
      config,
      `/api/operations/${encodeURIComponent(operationId)}`
    );

    if (!operation) {
      throw new Error(`Quilt operation ${operationId} disappeared while polling.`);
    }

    const status = operation.status ?? '';
    if (status === 'succeeded') return operation;
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(
        `Quilt operation ${operationId} failed: ${operation.error_message ?? operation.error ?? operation.message ?? status}`
      );
    }

    await new Promise(resolve => setTimeout(resolve, config.pollIntervalMs));
  }

  throw new Error(`Timed out waiting for Quilt operation ${operationId}.`);
}

function requireOperationId(
  envelope: { operation_id?: string } | null,
  context: string
): string {
  const operationId = envelope?.operation_id;
  if (!operationId) {
    throw new Error(`Quilt ${context} did not return an operation_id.`);
  }
  return operationId;
}

async function getContainerById(
  config: QuiltResolvedConfig,
  sandboxId: string
): Promise<QuiltContainer | null> {
  return requestJson<QuiltContainer>(
    config,
    `/api/containers/${encodeURIComponent(sandboxId)}`,
    undefined,
    { allow404: true }
  );
}

function resolveSnapshotResultId(operation: QuiltOperationRecord): string | null {
  if (operation.snapshot_id) return operation.snapshot_id;
  if (operation.target_resource_type === 'snapshot' && operation.target_resource_id) {
    return operation.target_resource_id;
  }
  const result = operation.result ?? {};
  const snapshotId = result['snapshot_id'];
  return typeof snapshotId === 'string' ? snapshotId : null;
}

function resolveContainerResultId(operation: QuiltOperationRecord): string | null {
  if (operation.container_id) return operation.container_id;
  if (operation.target_resource_type === 'container' && operation.target_resource_id) {
    return operation.target_resource_id;
  }
  const result = operation.result ?? {};
  const directId = result['container_id'];
  if (typeof directId === 'string') return directId;
  const results = result['results'];
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0];
    if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).container_id === 'string') {
      return (first as Record<string, string>).container_id;
    }
  }
  return null;
}

async function createPublishedService(
  handle: QuiltSandboxHandle,
  port: number,
  protocol?: string
): Promise<QuiltService> {
  const wantsWebSocket = protocol === 'ws' || protocol === 'wss';
  const existing = await requestJson<{ services: QuiltService[] }>(
    handle.config,
    `/api/containers/${encodeURIComponent(handle.sandboxId)}/services`
  );

  const match = existing?.services?.find(service => {
    if (service.target_port !== port) return false;
    if (wantsWebSocket && !service.enable_websockets) return false;
    return true;
  });

  if (match) return match;

  const created = await requestJson<QuiltService>(
    handle.config,
    `/api/containers/${encodeURIComponent(handle.sandboxId)}/services`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `computesdk-${port}`,
        target_port: port,
        protocol: 'http',
        enable_websockets: wantsWebSocket,
        auth_mode: handle.config.publishedServiceAuthMode,
        ...(handle.config.publishedServiceTtlSecs
          ? { ttl_secs: handle.config.publishedServiceTtlSecs }
          : {}),
      }),
    }
  );

  if (!created) {
    throw new Error(`Failed to create Quilt published service for port ${port}.`);
  }

  return created;
}

export const quilt = defineProvider<QuiltSandboxHandle, QuiltConfig, never, Snapshot>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config: QuiltConfig, options?: CreateSandboxOptions) => {
        const resolved = resolveConfig(config);
        const {
          timeout: requestedTimeout,
          envs,
          metadata,
          templateId,
          snapshotId,
          name,
          namespace: _namespace,
          sandboxId: _sandboxId,
          directory,
          signal: _signal,
          ...providerOptions
        } = options || {};

        if (snapshotId) {
          const unsupportedKeys = ['envs', 'templateId', 'directory'];
          if (envs || templateId || directory) {
            throw new Error(
              `Quilt snapshot clone does not support ${unsupportedKeys.join(', ')} create options in one request.`
            );
          }

          const cloneEnvelope = await requestJson<{ operation_id: string }>(
            resolved,
            `/api/snapshots/${encodeURIComponent(snapshotId)}/clone`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                resume_policy: 'immediate',
                ...(name ? { name } : {}),
                ...(metadata ? { labels: stringifyRecord(metadata) } : {}),
              }),
            },
            { includeTenantHeader: true }
          );

          const operation = await pollOperation(
            resolved,
            requireOperationId(cloneEnvelope, 'snapshot clone'),
            requestedTimeout ?? resolved.timeout
          );
          const containerId = resolveContainerResultId(operation);
          if (!containerId) {
            throw new Error(`Quilt snapshot clone completed without a container ID.`);
          }
          const container = await getContainerById(resolved, containerId);
          if (!container) {
            throw new Error(`Quilt cloned container ${containerId} was not found after creation.`);
          }
          return {
            sandbox: {
              config: resolved,
              sandboxId: containerId,
              container,
            },
            sandboxId: containerId,
          };
        }

        const createBody = {
          name: name ?? `computesdk-${crypto.randomUUID().slice(0, 8)}`,
          image:
            typeof providerOptions.image === 'string'
              ? providerOptions.image
              : typeof templateId === 'string'
                ? templateId
                : resolved.image,
          ...(envs && Object.keys(envs).length > 0 ? { environment: envs } : {}),
          ...(metadata ? { labels: stringifyRecord(metadata) } : {}),
          ...(directory ? { working_directory: directory } : {}),
          ...providerOptions,
        };

        const container = await requestJson<QuiltContainer>(resolved, '/api/containers', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(createBody),
        });

        if (!container?.container_id) {
          throw new Error('Quilt container create did not return a container_id.');
        }

        return {
          sandbox: {
            config: resolved,
            sandboxId: container.container_id,
            container,
          },
          sandboxId: container.container_id,
        };
      },

      getById: async (config: QuiltConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);
        const container = await getContainerById(resolved, sandboxId);
        if (!container) return null;
        return {
          sandbox: {
            config: resolved,
            sandboxId,
            container,
          },
          sandboxId,
        };
      },

      list: async (config: QuiltConfig) => {
        const resolved = resolveConfig(config);
        const sandboxes: Array<{ sandbox: QuiltSandboxHandle; sandboxId: string }> = [];
        let cursor: string | null | undefined = undefined;

        while (true) {
          const query = new URLSearchParams();
          if (cursor) query.set('cursor', cursor);
          const response = await requestJson<{
            containers: QuiltContainer[];
            pagination?: { has_next?: boolean; next_cursor?: string | null };
          }>(resolved, `/api/containers${query.toString() ? `?${query.toString()}` : ''}`);

          for (const container of response?.containers ?? []) {
            if (!container.container_id) continue;
            sandboxes.push({
              sandbox: {
                config: resolved,
                sandboxId: container.container_id,
                container,
              },
              sandboxId: container.container_id,
            });
          }

          if (!response?.pagination?.has_next || !response.pagination.next_cursor) {
            break;
          }

          cursor = response.pagination.next_cursor;
        }

        return sandboxes;
      },

      destroy: async (config: QuiltConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);
        await requestNoContent(
          resolved,
          `/api/containers/${encodeURIComponent(sandboxId)}`,
          { method: 'DELETE' },
          { allow404: true }
        );
      },

      runCommand: async (
        handle: QuiltSandboxHandle,
        command: string,
        options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        const fullCommand = buildExecCommand(command, options);

        const response = await requestJson<{
          stdout?: string;
          stderr?: string;
          exit_code?: number;
          timed_out?: boolean;
        }>(handle.config, `/api/containers/${encodeURIComponent(handle.sandboxId)}/exec`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            command: ['/bin/sh', '-lc', fullCommand],
            ...(options?.cwd ? { workdir: options.cwd } : {}),
            ...(options?.timeout ? { timeout_ms: options.timeout } : {}),
          }),
        });

        const stdout = response?.stdout ?? '';
        const stderr = response?.stderr ?? '';
        if (options?.onStdout && stdout) options.onStdout(stdout);
        if (options?.onStderr && stderr) options.onStderr(stderr);

        return {
          stdout,
          stderr,
          exitCode: response?.timed_out ? 124 : response?.exit_code ?? 0,
          durationMs: Date.now() - startTime,
        };
      },

      getInfo: async (handle: QuiltSandboxHandle): Promise<SandboxInfo> => {
        const container =
          (await getContainerById(handle.config, handle.sandboxId)) ?? handle.container;

        return {
          id: handle.sandboxId,
          provider: PROVIDER,
          status: mapStatus(container.state),
          createdAt: parseDate(container.created_at),
          timeout: handle.config.timeout,
          metadata: {
            name: container.name,
            tenantId: container.tenant_id,
            ipAddress: container.ip_address,
            execReady: container.exec_ready,
            networkReady: container.network_ready,
            state: container.state,
          },
        };
      },

      getUrl: async (
        handle: QuiltSandboxHandle,
        options: { port: number; protocol?: string }
      ): Promise<string> => {
        const service = await createPublishedService(handle, options.port, options.protocol);
        if (options.protocol === 'ws' || options.protocol === 'wss') {
          const url = service.websocket_url;
          if (!url) {
            throw new Error(`Quilt service ${service.service_id} does not expose a websocket URL.`);
          }
          if (options.protocol === 'ws') {
            const parsed = new URL(url);
            parsed.protocol = 'ws:';
            return parsed.toString();
          }
          return url;
        }

        const url = service.public_url;
        if (!url) {
          throw new Error(`Quilt service ${service.service_id} did not return a public URL.`);
        }

        if (options.protocol === 'http') {
          const parsed = new URL(url);
          parsed.protocol = 'http:';
          return parsed.toString();
        }

        return url;
      },

      filesystem: {
        readFile: async (
          handle: QuiltSandboxHandle,
          path: string,
          runCommand: QuiltCommandRunner
        ): Promise<string> => {
          const result = await runCommand(
            handle,
            `test -f "${escapeShellArg(path)}" && base64 < "${escapeShellArg(path)}" | tr -d '\\n'`
          );
          if (result.exitCode !== 0) {
            throw new Error(`File not found or unreadable: ${path}`);
          }
          return Buffer.from(result.stdout, 'base64').toString('utf8');
        },

        writeFile: async (
          handle: QuiltSandboxHandle,
          path: string,
          content: string,
          runCommand: QuiltCommandRunner
        ): Promise<void> => {
          const parentDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) || '/' : '.';
          const encoded = Buffer.from(content).toString('base64');
          const result = await runCommand(
            handle,
            `mkdir -p "${escapeShellArg(parentDir)}" && echo "${encoded}" | base64 -d > "${escapeShellArg(path)}"`
          );
          if (result.exitCode !== 0) {
            throw new Error(`Failed to write file ${path}: ${result.stderr}`);
          }
        },

        mkdir: async (
          handle: QuiltSandboxHandle,
          path: string,
          runCommand: QuiltCommandRunner
        ): Promise<void> => {
          const result = await runCommand(handle, `mkdir -p "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
          }
        },

        readdir: async (
          handle: QuiltSandboxHandle,
          path: string,
          runCommand: QuiltCommandRunner
        ): Promise<FileEntry[]> => {
          const result = await runCommand(handle, `ls -la "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to list directory ${path}: ${result.stderr}`);
          }
          return normalizeFileEntries(result.stdout);
        },

        exists: async (
          handle: QuiltSandboxHandle,
          path: string,
          runCommand: QuiltCommandRunner
        ): Promise<boolean> => {
          const result = await runCommand(handle, `test -e "${escapeShellArg(path)}"`);
          return result.exitCode === 0;
        },

        remove: async (
          handle: QuiltSandboxHandle,
          path: string,
          runCommand: QuiltCommandRunner
        ): Promise<void> => {
          const result = await runCommand(handle, `rm -rf "${escapeShellArg(path)}"`);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to remove ${path}: ${result.stderr}`);
          }
        },
      },

      getInstance: (handle: QuiltSandboxHandle): QuiltSandboxHandle => handle,
    },

    snapshot: {
      create: async (
        config: QuiltConfig,
        sandboxId: string,
        options?: CreateSnapshotOptions
      ): Promise<Snapshot> => {
        const resolved = resolveConfig(config);
        const envelope = await requestJson<{ operation_id: string }>(
          resolved,
          `/api/containers/${encodeURIComponent(sandboxId)}/snapshot`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              consistency_mode: 'crash-consistent',
              network_mode: 'reset',
              volume_mode: 'exclude',
              labels: {
                ...(options?.metadata ? stringifyRecord(options.metadata) : {}),
                ...(options?.name ? { 'computesdk:name': options.name } : {}),
              },
            }),
          },
          { includeTenantHeader: true }
        );

        const operation = await pollOperation(
          resolved,
          requireOperationId(envelope, 'snapshot create'),
          resolved.timeout
        );
        const snapshotId = resolveSnapshotResultId(operation);
        if (!snapshotId) {
          throw new Error(`Quilt snapshot create completed without a snapshot ID.`);
        }
        const snapshot = await requestJson<QuiltSnapshotRecord>(
          resolved,
          `/api/snapshots/${encodeURIComponent(snapshotId)}`,
          undefined,
          { includeTenantHeader: true }
        );

        if (!snapshot) {
          throw new Error(`Quilt snapshot ${snapshotId} was not found after creation.`);
        }

        return mapSnapshot(snapshot);
      },

      list: async (config: QuiltConfig, options?: ListSnapshotsOptions): Promise<Snapshot[]> => {
        const resolved = resolveConfig(config);
        const query = new URLSearchParams();
        if (options?.sandboxId) {
          query.set('container_id', options.sandboxId);
        }
        const response = await requestJson<{ snapshots: QuiltSnapshotRecord[] }>(
          resolved,
          `/api/snapshots${query.toString() ? `?${query.toString()}` : ''}`,
          undefined,
          { includeTenantHeader: true }
        );
        return (response?.snapshots ?? []).map(mapSnapshot);
      },

      delete: async (config: QuiltConfig, snapshotId: string): Promise<void> => {
        const resolved = resolveConfig(config);
        await requestNoContent(
          resolved,
          `/api/snapshots/${encodeURIComponent(snapshotId)}`,
          { method: 'DELETE' },
          { includeTenantHeader: true, allow404: true }
        );
      },
    },
  },
});

function stringifyRecord(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])
  );
}

function mapSnapshot(snapshot: QuiltSnapshotRecord): Snapshot {
  return {
    id: snapshot.snapshot_id,
    provider: PROVIDER,
    createdAt: parseDate(snapshot.created_at),
    metadata: {
      sourceContainerId: snapshot.source_container_id,
      pinned: snapshot.pinned ?? false,
      labels: snapshot.labels ?? {},
      expiresAt: snapshot.expires_at ?? null,
    },
  };
}
