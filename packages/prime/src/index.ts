import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  CommandResult,
  CreateSandboxOptions,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';
import { executeVmCommand } from './command-session.js';

export const PRIME_DEFAULTS = {
  image: 'node:22-bookworm',
  cpuCores: 1,
  memoryGb: 1,
  diskSizeGb: 10,
  timeoutMinutes: 60,
  vm: true,
} as const;

export interface PrimeConfig {
  /** Prime API key. Falls back to PRIME_API_KEY. */
  apiKey?: string;
  /** Prime team to bill. Falls back to PRIME_TEAM_ID. */
  teamId?: string;
  /** Prime API root. Falls back to PRIME_API_BASE_URL / PRIME_BASE_URL. */
  baseUrl?: string;
  /** Maximum time spent waiting for a newly created sandbox to accept commands. */
  readinessTimeoutMs?: number;
  /** Readiness polling interval. Primarily useful for tests. */
  readinessPollIntervalMs?: number;
  /** Per-request timeout for Prime control-plane calls. */
  requestTimeoutMs?: number;
  /** Injectable fetch implementation. */
  fetch?: typeof globalThis.fetch;
}

export interface PrimeCreateSandboxOptions extends CreateSandboxOptions {
  cpuCores?: number;
  memoryGb?: number;
  diskSizeGb?: number;
  timeoutMinutes?: number;
  idleTimeoutMinutes?: number;
  vm?: boolean;
  startCommand?: string | { executable: string; args?: string[] } | null;
  networkAllowlist?: string[];
  networkDenylist?: string[];
  labels?: string[];
  teamId?: string;
  region?: string;
  guaranteed?: boolean;
  registryCredentialsId?: string;
  idempotencyKey?: string;
  readinessTimeoutMs?: number;
}

interface JsonRecord {
  [key: string]: unknown;
}

interface PrimeSandboxRecord extends JsonRecord {
  id: string;
  status: string;
}

interface PrimeAuth {
  gatewayUrl: string;
  userNs: string;
  jobId: string;
  token: string;
  expiresAt?: number;
}

interface PrimeSandboxHandle {
  id: string;
  createdAt: Date;
  timeoutMs: number;
  record: PrimeSandboxRecord;
  api: PrimeApi;
}

interface RequestOptions {
  body?: JsonRecord;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
  retry?: boolean;
}

export class PrimeApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PrimeApiError';
    this.status = status;
  }
}

function valueFrom(record: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function stringFrom(record: JsonRecord, ...keys: string[]): string | undefined {
  const value = valueFrom(record, ...keys);
  return typeof value === 'string' ? value : undefined;
}

function numberFrom(record: JsonRecord, ...keys: string[]): number | undefined {
  const value = valueFrom(record, ...keys);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanFrom(record: JsonRecord, ...keys: string[]): boolean | undefined {
  const value = valueFrom(record, ...keys);
  return typeof value === 'boolean' ? value : undefined;
}

function recordFrom(value: unknown, context: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Prime ${context} response was not an object`);
  }
  return value as JsonRecord;
}

function sandboxFrom(value: unknown): PrimeSandboxRecord {
  const record = recordFrom(value, 'sandbox');
  const id = stringFrom(record, 'id');
  const status = stringFrom(record, 'status');
  if (!id || !status) throw new Error('Prime sandbox response is missing id or status');
  return { ...record, id, status };
}

function positiveNumber(value: unknown, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return value;
}

function stripApiSuffix(url: string): string {
  return url.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
}

function abortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  return reason instanceof Error ? reason : new Error('Operation aborted');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function requestSignal(timeoutMs: number, parent?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  if (parent) parent.addEventListener('abort', onAbort, { once: true });
  if (parent?.aborted) onAbort();

  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError(signal));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function errorDetail(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as JsonRecord;
  return stringFrom(record, 'detail', 'error', 'message');
}

function mapStatus(status: string): SandboxInfo['status'] {
  switch (status.toUpperCase()) {
    case 'RUNNING':
      return 'running';
    case 'ERROR':
    case 'TIMEOUT':
      return 'error';
    default:
      return 'stopped';
  }
}

function createdAt(record: JsonRecord): Date {
  const raw = stringFrom(record, 'createdAt', 'created_at');
  if (!raw) return new Date();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function omitUndefined(record: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

class PrimeApi {
  private readonly apiKey: string;
  private readonly teamId?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly requestTimeoutMs: number;
  readonly readinessTimeoutMs: number;
  readonly readinessPollIntervalMs: number;
  private readonly authCache = new Map<string, PrimeAuth>();

  constructor(config: PrimeConfig) {
    this.apiKey = config.apiKey || process.env.PRIME_API_KEY || '';
    this.teamId = config.teamId || process.env.PRIME_TEAM_ID || undefined;
    this.baseUrl = stripApiSuffix(
      config.baseUrl ||
        process.env.PRIME_API_BASE_URL ||
        process.env.PRIME_BASE_URL ||
        'https://api.primeintellect.ai',
    );
    this.fetchImpl = config.fetch || globalThis.fetch;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
    this.readinessTimeoutMs = config.readinessTimeoutMs ?? 120_000;
    this.readinessPollIntervalMs = config.readinessPollIntervalMs ?? 1_000;
    if (!this.fetchImpl) throw new Error('Prime provider requires a fetch implementation');
  }

  private requireApiKey(): void {
    if (!this.apiKey) {
      throw new Error('Missing Prime API key. Provide apiKey or set PRIME_API_KEY.');
    }
  }

  private async parseResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    this.requireApiKey();
    const url = new URL(`${this.baseUrl}/api/v1${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const retry = options.retry ?? ['GET', 'HEAD', 'PUT', 'DELETE'].includes(method.toUpperCase());
    const attempts = retry ? 3 : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const linked = requestSignal(options.timeoutMs ?? this.requestTimeoutMs, options.signal);
      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': '@computesdk/prime/0.1.0',
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: linked.signal,
        });

        if (retry && [502, 503, 504].includes(response.status) && attempt + 1 < attempts) {
          await sleep(100 * 2 ** attempt, options.signal);
          continue;
        }

        const parsed = await this.parseResponse(response);
        if (!response.ok) {
          throw new PrimeApiError(
            response.status,
            `Prime API ${method.toUpperCase()} ${path} failed (${response.status}): ${errorDetail(parsed) || response.statusText}`,
          );
        }
        return parsed as T;
      } catch (error) {
        lastError = error;
        if (error instanceof PrimeApiError || linked.signal.aborted || attempt + 1 >= attempts) throw error;
        await sleep(100 * 2 ** attempt, options.signal);
      } finally {
        linked.cleanup();
      }
    }
    throw lastError;
  }

  private async gatewayRequest<T>(url: string, token: string, body: JsonRecord, timeoutMs: number): Promise<T> {
    const linked = requestSignal(timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': '@computesdk/prime/0.1.0',
        },
        body: JSON.stringify(body),
        signal: linked.signal,
      });
      const parsed = await this.parseResponse(response);
      if (!response.ok) {
        throw new PrimeApiError(
          response.status,
          `Prime command gateway failed (${response.status}): ${errorDetail(parsed) || response.statusText}`,
        );
      }
      return parsed as T;
    } finally {
      linked.cleanup();
    }
  }

  async createSandbox(options?: PrimeCreateSandboxOptions): Promise<PrimeSandboxHandle> {
    const opts = options ?? {};
    const vm = opts.vm ?? PRIME_DEFAULTS.vm;
    const timeoutMinutes = positiveNumber(
      opts.timeoutMinutes ?? (opts.timeout === undefined ? undefined : Math.ceil(opts.timeout / 60_000)),
      PRIME_DEFAULTS.timeoutMinutes,
      'timeoutMinutes',
    );
    const payload = omitUndefined({
      name: opts.name || `computesdk-${randomUUID()}`,
      docker_image: opts.image || PRIME_DEFAULTS.image,
      start_command: opts.startCommand === undefined ? (vm ? null : 'tail -f /dev/null') : opts.startCommand,
      cpu_cores: positiveNumber(opts.cpuCores, PRIME_DEFAULTS.cpuCores, 'cpuCores'),
      memory_gb: positiveNumber(opts.memoryGb, PRIME_DEFAULTS.memoryGb, 'memoryGb'),
      disk_size_gb: positiveNumber(opts.diskSizeGb, PRIME_DEFAULTS.diskSizeGb, 'diskSizeGb'),
      gpu_count: 0,
      vm,
      network_allowlist: opts.networkAllowlist,
      network_denylist: opts.networkDenylist,
      timeout_minutes: timeoutMinutes,
      idle_timeout_minutes: opts.idleTimeoutMinutes,
      environment_vars: opts.envs,
      labels: opts.labels ?? ['computesdk'],
      team_id: opts.teamId ?? this.teamId,
      region: opts.region,
      registry_credentials_id: opts.registryCredentialsId,
      guaranteed: opts.guaranteed ?? false,
      idempotency_key: opts.idempotencyKey || randomUUID(),
    });

    const created = sandboxFrom(
      await this.request<unknown>('POST', '/sandbox', {
        body: payload,
        retry: true,
        signal: opts.signal,
      }),
    );

    try {
      const ready = await this.waitUntilReady(
        created.id,
        opts.readinessTimeoutMs ?? this.readinessTimeoutMs,
        opts.signal,
        vm,
      );
      return {
        id: ready.id,
        createdAt: createdAt(ready),
        timeoutMs: timeoutMinutes * 60_000,
        record: ready,
        api: this,
      };
    } catch (error) {
      await this.deleteSandbox(created.id).catch(() => undefined);
      throw error;
    }
  }

  async getSandbox(sandboxId: string): Promise<PrimeSandboxRecord> {
    return sandboxFrom(await this.request<unknown>('GET', `/sandbox/${encodeURIComponent(sandboxId)}`));
  }

  async getSandboxOrNull(sandboxId: string): Promise<PrimeSandboxHandle | null> {
    try {
      const record = await this.getSandbox(sandboxId);
      const timeoutMinutes = numberFrom(record, 'timeoutMinutes', 'timeout_minutes') ?? PRIME_DEFAULTS.timeoutMinutes;
      return {
        id: record.id,
        createdAt: createdAt(record),
        timeoutMs: timeoutMinutes * 60_000,
        record,
        api: this,
      };
    } catch (error) {
      if (error instanceof PrimeApiError && error.status === 404) return null;
      throw error;
    }
  }

  async listSandboxes(): Promise<PrimeSandboxHandle[]> {
    const handles: PrimeSandboxHandle[] = [];
    for (let page = 1; ; page += 1) {
      const response = recordFrom(
        await this.request<unknown>('GET', '/sandbox', {
          query: { page, per_page: 100, is_active: true, team_id: this.teamId },
        }),
        'sandbox list',
      );
      const sandboxes = valueFrom(response, 'sandboxes');
      if (!Array.isArray(sandboxes)) throw new Error('Prime sandbox list response is missing sandboxes');
      for (const value of sandboxes) {
        const record = sandboxFrom(value);
        const timeoutMinutes = numberFrom(record, 'timeoutMinutes', 'timeout_minutes') ?? PRIME_DEFAULTS.timeoutMinutes;
        handles.push({
          id: record.id,
          createdAt: createdAt(record),
          timeoutMs: timeoutMinutes * 60_000,
          record,
          api: this,
        });
      }
      const hasNext = valueFrom(response, 'hasNext', 'has_next');
      if (hasNext !== true) return handles;
    }
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    try {
      await this.request<unknown>('DELETE', `/sandbox/${encodeURIComponent(sandboxId)}`);
    } catch (error) {
      if (!(error instanceof PrimeApiError && error.status === 404)) throw error;
    } finally {
      this.authCache.delete(sandboxId);
    }
  }

  private async getAuth(sandboxId: string, forceRefresh = false): Promise<PrimeAuth> {
    const cached = this.authCache.get(sandboxId);
    if (!forceRefresh && cached && (cached.expiresAt === undefined || cached.expiresAt - 60_000 > Date.now())) {
      return cached;
    }

    const response = recordFrom(
      await this.request<unknown>('POST', `/sandbox/${encodeURIComponent(sandboxId)}/auth`, { retry: true }),
      'sandbox auth',
    );
    const gatewayUrl = stringFrom(response, 'gateway_url', 'gatewayUrl');
    const userNs = stringFrom(response, 'user_ns', 'userNs');
    const jobId = stringFrom(response, 'job_id', 'jobId');
    const token = stringFrom(response, 'token');
    if (!gatewayUrl || !userNs || !jobId || !token) {
      throw new Error('Prime sandbox auth response is incomplete');
    }
    const expiresRaw = stringFrom(response, 'expires_at', 'expiresAt');
    const expiresAt = expiresRaw ? Date.parse(expiresRaw) : undefined;
    const auth: PrimeAuth = {
      gatewayUrl: gatewayUrl.replace(/\/+$/, ''),
      userNs,
      jobId,
      token,
      expiresAt: expiresAt !== undefined && !Number.isNaN(expiresAt) ? expiresAt : undefined,
    };
    this.authCache.set(sandboxId, auth);
    return auth;
  }

  async executeCommand(
    sandboxId: string,
    command: string,
    options: RunCommandOptions = {},
    vm?: boolean,
  ): Promise<CommandResult> {
    const start = Date.now();
    const timeoutMs = positiveNumber(options.timeout, 300_000, 'timeout');
    const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1_000));
    const effectiveCommand = options.background
      ? `nohup sh -c "${escapeShellArg(command)}" > /dev/null 2>&1 &`
      : command;
    const sandboxIsVm = vm ?? booleanFrom(await this.getSandbox(sandboxId), 'vm') ?? false;

    if (sandboxIsVm) {
      let reauthenticated = false;
      for (;;) {
        const auth = await this.getAuth(sandboxId, reauthenticated);
        try {
          const result = await executeVmCommand({
            baseUrl: `${auth.gatewayUrl}/${auth.userNs}/${auth.jobId}`,
            token: auth.token,
            command: effectiveCommand,
            cwd: options.cwd,
            env: options.env,
            timeoutMs,
            fetch: this.fetchImpl,
            onStdout: options.onStdout,
            onStderr: options.onStderr,
          });
          return { ...result, durationMs: Date.now() - start };
        } catch (error) {
          if (error instanceof ConnectError && error.code === Code.Unauthenticated && !reauthenticated) {
            this.authCache.delete(sandboxId);
            reauthenticated = true;
            continue;
          }
          throw error;
        }
      }
    }

    let reauthenticated = false;
    let conflictRetries = 0;

    for (;;) {
      const auth = await this.getAuth(sandboxId, reauthenticated);
      const gatewayUrl = `${auth.gatewayUrl}/${auth.userNs}/${auth.jobId}/exec`;
      try {
        const response = recordFrom(
          await this.gatewayRequest<unknown>(
            gatewayUrl,
            auth.token,
            {
              command: effectiveCommand,
              working_dir: options.cwd,
              env: options.env ?? {},
              sandbox_id: sandboxId,
              timeout: timeoutSeconds,
            },
            timeoutMs + 5_000,
          ),
          'command',
        );
        const stdout = stringFrom(response, 'stdout') ?? '';
        const stderr = stringFrom(response, 'stderr') ?? '';
        const exitCode = numberFrom(response, 'exit_code', 'exitCode');
        if (exitCode === undefined) throw new Error('Prime command response is missing exit_code');
        options.onStdout?.(stdout);
        options.onStderr?.(stderr);
        return { stdout, stderr, exitCode, durationMs: Date.now() - start };
      } catch (error) {
        if (error instanceof PrimeApiError && error.status === 401 && !reauthenticated) {
          this.authCache.delete(sandboxId);
          reauthenticated = true;
          continue;
        }
        if (error instanceof PrimeApiError && error.status === 409 && conflictRetries < 4) {
          const sandbox = await this.getSandbox(sandboxId);
          if (sandbox.status.toUpperCase() !== 'RUNNING') throw error;
          await sleep(250 * 2 ** conflictRetries);
          conflictRetries += 1;
          continue;
        }
        throw error;
      }
    }
  }

  async waitUntilReady(
    sandboxId: string,
    timeoutMs: number,
    signal?: AbortSignal,
    vm?: boolean,
  ): Promise<PrimeSandboxRecord> {
    const deadline = Date.now() + positiveNumber(timeoutMs, this.readinessTimeoutMs, 'readinessTimeoutMs');
    let lastStatus = 'UNKNOWN';
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      const sandbox = await this.getSandbox(sandboxId);
      lastStatus = sandbox.status.toUpperCase();
      if (lastStatus === 'RUNNING') {
        try {
          const probe = await this.executeCommand(
            sandboxId,
            "echo 'sandbox ready'",
            { timeout: 10_000 },
            booleanFrom(sandbox, 'vm') ?? vm,
          );
          if (probe.exitCode === 0) return sandbox;
        } catch (error) {
          if (error instanceof PrimeApiError && [401, 402, 404].includes(error.status)) throw error;
        }
      } else if (['ERROR', 'TERMINATED', 'TIMEOUT'].includes(lastStatus)) {
        const detail = stringFrom(sandbox, 'errorMessage', 'error_message', 'terminationReason', 'termination_reason');
        throw new Error(`Prime sandbox ${sandboxId} entered ${lastStatus}${detail ? `: ${detail}` : ''}`);
      }
      await sleep(this.readinessPollIntervalMs, signal);
    }
    throw new Error(`Prime sandbox ${sandboxId} was not ready within ${timeoutMs}ms (last status: ${lastStatus})`);
  }

  async exposePort(sandboxId: string, port: number, protocol?: string): Promise<string> {
    const transport = protocol?.toLowerCase() === 'tcp' ? 'TCP' : 'HTTP';
    const response = recordFrom(
      await this.request<unknown>('POST', `/sandbox/${encodeURIComponent(sandboxId)}/expose`, {
        body: { port, protocol: transport },
      }),
      'port exposure',
    );
    const url = stringFrom(response, 'url');
    if (url) return url;
    const endpoint = stringFrom(response, 'external_endpoint', 'externalEndpoint', 'tls_socket', 'tlsSocket');
    if (endpoint) return `${transport.toLowerCase()}://${endpoint}`;
    throw new Error('Prime port exposure response did not include a URL');
  }
}

const apiClients = new WeakMap<PrimeConfig, PrimeApi>();

function apiFor(config: PrimeConfig): PrimeApi {
  let api = apiClients.get(config);
  if (!api) {
    api = new PrimeApi(config);
    apiClients.set(config, api);
  }
  return api;
}

export const prime = defineProvider<PrimeSandboxHandle, PrimeConfig>({
  name: 'prime',
  methods: {
    sandbox: {
      create: async (config, options) => {
        const sandbox = await apiFor(config).createSandbox(options as PrimeCreateSandboxOptions | undefined);
        return { sandbox, sandboxId: sandbox.id };
      },
      getById: async (config, sandboxId) => {
        const sandbox = await apiFor(config).getSandboxOrNull(sandboxId);
        return sandbox ? { sandbox, sandboxId: sandbox.id } : null;
      },
      list: async (config) => {
        const sandboxes = await apiFor(config).listSandboxes();
        return sandboxes.map((sandbox) => ({ sandbox, sandboxId: sandbox.id }));
      },
      destroy: async (config, sandboxId) => {
        await apiFor(config).deleteSandbox(sandboxId);
      },
      runCommand: async (sandbox, command, options) =>
        sandbox.api.executeCommand(sandbox.id, command, options, booleanFrom(sandbox.record, 'vm')),
      getInfo: async (sandbox) => {
        const record = await sandbox.api.getSandbox(sandbox.id);
        sandbox.record = record;
        return {
          id: sandbox.id,
          provider: 'prime',
          status: mapStatus(record.status),
          createdAt: createdAt(record),
          timeout: sandbox.timeoutMs,
          metadata: {
            image: stringFrom(record, 'dockerImage', 'docker_image'),
            cpuCores: numberFrom(record, 'cpuCores', 'cpu_cores'),
            memoryGb: numberFrom(record, 'memoryGB', 'memory_gb'),
            diskSizeGb: numberFrom(record, 'diskSizeGB', 'disk_size_gb'),
            vm: booleanFrom(record, 'vm'),
            region: stringFrom(record, 'region'),
          },
        };
      },
      getUrl: async (sandbox, options) => sandbox.api.exposePort(sandbox.id, options.port, options.protocol),
      getInstance: (sandbox) => sandbox,
    },
  },
});
