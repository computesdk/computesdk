import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type {
  CodeResult,
  CommandResult,
  CreateSandboxOptions,
  RunCommandOptions,
  Runtime,
  SandboxInfo,
} from '@computesdk/provider';

const DEFAULT_BASE_URL = 'https://api.primeintellect.ai';
const DEFAULT_NODE_IMAGE = 'node:22';
const DEFAULT_PYTHON_IMAGE = 'python:3.12-slim';
const DEFAULT_TIMEOUT_MS = 300_000;
const PRIME_FAILED_STATUSES = new Set(['ERROR', 'TERMINATED', 'TIMEOUT']);

interface PrimeCreateResponse {
  id: string;
  name?: string;
  status?: string;
  dockerImage?: string;
  docker_image?: string;
  createdAt?: string;
  created_at?: string;
  startedAt?: string | null;
  started_at?: string | null;
  terminatedAt?: string | null;
  terminated_at?: string | null;
  errorType?: string;
  error_type?: string;
  errorMessage?: string;
  error_message?: string;
  cpuCores?: number;
  cpu_cores?: number;
  memoryGB?: number;
  memory_gb?: number;
  diskSizeGB?: number;
  disk_size_gb?: number;
  networkAccess?: boolean;
  network_access?: boolean;
  teamId?: string;
  team_id?: string;
}

interface PrimeAuthResponse {
  token: string;
  gateway_url?: string;
  gatewayUrl?: string;
  user_ns?: string;
  userNs?: string;
  job_id?: string;
  jobId?: string;
}

interface PrimeCommandResponse {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  exitCode?: number;
}

interface PrimeExposure {
  exposure_id?: string;
  exposureId?: string;
  sandbox_id?: string;
  sandboxId?: string;
  port: number;
  protocol?: string;
  url?: string;
  external_endpoint?: string;
  externalEndpoint?: string;
}

interface PrimeExposureListResponse {
  exposures?: PrimeExposure[];
}

interface PrimeSandbox extends PrimeCreateResponse {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  runtime: Runtime;
}

export interface PrimeConfig {
  apiKey?: string;
  baseUrl?: string;
  teamId?: string;
  image?: string;
  cpuCores?: number;
  memoryGb?: number;
  diskSizeGb?: number;
  timeout?: number;
  timeoutMinutes?: number;
  runtime?: Runtime;
}

interface ResolvedPrimeConfig {
  apiKey: string;
  baseUrl: string;
  teamId?: string;
  image?: string;
  cpuCores?: number;
  memoryGb?: number;
  diskSizeGb?: number;
  timeoutMs: number;
  timeoutMinutes?: number;
  runtime?: Runtime;
}

export const prime = defineProvider<PrimeSandbox, PrimeConfig>({
  name: 'prime',
  methods: {
    sandbox: {
      create: async (config: PrimeConfig, options?: CreateSandboxOptions) => {
        const resolved = resolveConfig(config);

        if (options?.sandboxId) {
          const existing = await getPrimeSandbox(resolved, options.sandboxId);
          return {
            sandbox: existing,
            sandboxId: existing.id,
          };
        }

        const {
          runtime: optRuntime,
          timeout: optTimeout,
          envs,
          name,
          metadata,
          templateId: _templateId,
          snapshotId: _snapshotId,
          sandboxId: _sandboxId,
          namespace: _namespace,
          directory: _directory,
          overlays: _overlays,
          servers: _servers,
          ...providerOptions
        } = options || {};

        const runtime = optRuntime || resolved.runtime || 'node';
        const providerRecord = providerOptions as Record<string, unknown>;
        const timeoutMs = parsePositiveNumber(optTimeout) ?? resolved.timeoutMs;
        const timeoutMinutes =
          parsePositiveInt(providerRecord.timeoutMinutes) ??
          parsePositiveInt(providerRecord.timeout_minutes) ??
          resolved.timeoutMinutes ??
          Math.max(1, Math.ceil(timeoutMs / 60_000));

        const image =
          asNonEmptyString(providerRecord.image) ||
          resolved.image ||
          defaultImageForRuntime(runtime);

        const cpuCores =
          parsePositiveNumber(providerRecord.cpuCores) ??
          parsePositiveNumber(providerRecord.cpu_cores) ??
          resolved.cpuCores ??
          1;

        const memoryGb =
          parsePositiveNumber(providerRecord.memoryGb) ??
          parsePositiveNumber(providerRecord.memory_gb) ??
          resolved.memoryGb ??
          2;

        const diskSizeGb =
          parsePositiveNumber(providerRecord.diskSizeGb) ??
          parsePositiveNumber(providerRecord.disk_size_gb) ??
          resolved.diskSizeGb ??
          5;

        const payload: Record<string, unknown> = {
          name: name || createSandboxName(),
          docker_image: image,
          start_command:
            asNonEmptyString(providerRecord.startCommand) ||
            asNonEmptyString(providerRecord.start_command) ||
            'tail -f /dev/null',
          cpu_cores: cpuCores,
          memory_gb: memoryGb,
          disk_size_gb: diskSizeGb,
          gpu_count: 0,
          vm: false,
          network_access: true,
          timeout_minutes: timeoutMinutes,
        };

        if (resolved.teamId) {
          payload.team_id = resolved.teamId;
        }

        if (envs && Object.keys(envs).length > 0) {
          payload.environment_vars = envs;
        }

        if (metadata && typeof metadata === 'object') {
          payload.labels = Object.entries(metadata).map(([key, value]) => {
            const rendered = typeof value === 'string' ? value : JSON.stringify(value);
            return `${key}:${rendered}`;
          });
        }

        const created = await fetchJson<PrimeCreateResponse>(
          `${resolved.baseUrl}/api/v1/sandbox`,
          {
            method: 'POST',
            headers: withJsonHeaders(apiHeaders(resolved.apiKey)),
            body: JSON.stringify(payload),
          }
        );

        return {
          sandbox: createSandboxState(created, resolved, runtime, timeoutMs),
          sandboxId: created.id,
        };
      },

      getById: async (config: PrimeConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);

        try {
          const sandbox = await getPrimeSandbox(resolved, sandboxId);
          return {
            sandbox,
            sandboxId: sandbox.id,
          };
        } catch (error) {
          if (error instanceof Error && error.message.includes('(404)')) {
            return null;
          }
          throw error;
        }
      },

      list: async (config: PrimeConfig) => {
        const resolved = resolveConfig(config);
        const search = new URLSearchParams({
          page: '1',
          per_page: '100',
        });

        if (resolved.teamId) {
          search.set('team_id', resolved.teamId);
        }

        try {
          const response = await fetchJson<PrimeExposureListResponse & { sandboxes?: PrimeCreateResponse[] }>(
            `${resolved.baseUrl}/api/v1/sandbox?${search.toString()}`,
            {
              method: 'GET',
              headers: apiHeaders(resolved.apiKey),
            }
          );

          return (response.sandboxes || []).map(sandbox => {
            const runtime = inferRuntimeFromImage(
              sandbox.dockerImage || sandbox.docker_image || resolved.image || DEFAULT_NODE_IMAGE
            );
            const state = createSandboxState(sandbox, resolved, runtime, resolved.timeoutMs);
            return {
              sandbox: state,
              sandboxId: state.id,
            };
          });
        } catch (_error) {
          return [];
        }
      },

      destroy: async (config: PrimeConfig, sandboxId: string) => {
        const resolved = resolveConfig(config);
        const response = await fetch(`${resolved.baseUrl}/api/v1/sandbox/${sandboxId}`, {
          method: 'DELETE',
          headers: apiHeaders(resolved.apiKey),
        });

        if (response.status === 404 || response.status === 410) {
          return;
        }

        if (!response.ok) {
          throw new Error(
            `Failed to delete Prime sandbox '${sandboxId}' (${response.status}): ${await safeReadText(response)}`
          );
        }
      },

      runCode: async (sandbox: PrimeSandbox, code: string, runtime?: Runtime): Promise<CodeResult> => {
        const effectiveRuntime = runtime || detectRuntime(code, sandbox.runtime);
        const command = buildRuntimeCommand(code, effectiveRuntime);
        const result = await runPrimeCommand(sandbox, command, {
          timeoutMs: sandbox.timeoutMs,
        });
        const output = combineOutput(result.stdout, result.stderr);

        if (result.exitCode !== 0 && isSyntaxError(output, effectiveRuntime)) {
          throw new Error(`Syntax error: ${firstNonEmptyLine(output)}`);
        }

        return {
          output,
          exitCode: result.exitCode,
          language: effectiveRuntime,
        };
      },

      runCommand: async (
        sandbox: PrimeSandbox,
        command: string,
        options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const startTime = Date.now();
        const timeoutMs = parsePositiveNumber(options?.timeout) ?? sandbox.timeoutMs;
        const background = Boolean((options as { background?: boolean } | undefined)?.background);

        try {
          const result = await runPrimeCommand(
            sandbox,
            background ? wrapBackgroundCommand(command) : command,
            {
              cwd: options?.cwd,
              env: options?.env,
              timeoutMs,
            }
          );

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

      getInfo: async (sandbox: PrimeSandbox): Promise<SandboxInfo> => {
        const refreshed = await getPrimeSandbox(
          {
            apiKey: sandbox.apiKey,
            baseUrl: sandbox.baseUrl,
            timeoutMs: sandbox.timeoutMs,
          },
          sandbox.id,
          sandbox.runtime
        );

        return {
          id: refreshed.id,
          provider: 'prime',
          runtime: refreshed.runtime,
          status: mapPrimeStatus(refreshed.status || 'RUNNING'),
          createdAt: parseDate(refreshed.createdAt || refreshed.created_at),
          timeout: refreshed.timeoutMs,
          metadata: {
            name: refreshed.name,
            image: refreshed.dockerImage || refreshed.docker_image,
            cpuCores: refreshed.cpuCores || refreshed.cpu_cores,
            memoryGb: refreshed.memoryGB || refreshed.memory_gb,
            diskSizeGb: refreshed.diskSizeGB || refreshed.disk_size_gb,
            teamId: refreshed.teamId || refreshed.team_id,
          },
        };
      },

      getUrl: async (sandbox: PrimeSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        const protocol = (options.protocol || 'https').toUpperCase() === 'TCP' ? 'TCP' : 'HTTP';
        const headers = withJsonHeaders(apiHeaders(sandbox.apiKey));
        const list = await fetchJson<PrimeExposureListResponse>(
          `${sandbox.baseUrl}/api/v1/sandbox/${sandbox.id}/expose`,
          {
            method: 'GET',
            headers: apiHeaders(sandbox.apiKey),
          }
        );

        const existing = (list.exposures || []).find(exposure =>
          exposure.port === options.port &&
          (exposure.protocol || 'HTTP').toUpperCase() === protocol
        );

        const exposure = existing || await fetchJson<PrimeExposure>(
          `${sandbox.baseUrl}/api/v1/sandbox/${sandbox.id}/expose`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              port: options.port,
              protocol,
            }),
          }
        );

        if (exposure.url) {
          return exposure.url;
        }

        const externalEndpoint = exposure.external_endpoint || exposure.externalEndpoint;
        if (externalEndpoint) {
          if (externalEndpoint.startsWith('http://') || externalEndpoint.startsWith('https://')) {
            return externalEndpoint;
          }
          return protocol === 'TCP' ? externalEndpoint : `https://${externalEndpoint}`;
        }

        throw new Error(`Prime did not return an exposed URL for sandbox ${sandbox.id} port ${options.port}`);
      },
    },
  },
});

function resolveConfig(config: PrimeConfig): ResolvedPrimeConfig {
  const apiKey = asNonEmptyString(config.apiKey) || asNonEmptyString(process.env.PRIME_API_KEY) || '';
  if (!apiKey) {
    throw new Error('Missing Prime API key. Set PRIME_API_KEY or pass apiKey in the provider config.');
  }

  const timeoutMs =
    parsePositiveNumber(config.timeout) ??
    parsePositiveNumber(process.env.PRIME_TIMEOUT_MS) ??
    DEFAULT_TIMEOUT_MS;

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(config.baseUrl || process.env.PRIME_API_BASE_URL || process.env.PRIME_BASE_URL || DEFAULT_BASE_URL),
    teamId: asNonEmptyString(config.teamId) || asNonEmptyString(process.env.PRIME_TEAM_ID),
    image: asNonEmptyString(config.image) || asNonEmptyString(process.env.PRIME_SANDBOX_IMAGE),
    cpuCores:
      parsePositiveNumber(config.cpuCores) ??
      parsePositiveNumber(process.env.PRIME_SANDBOX_CPU_CORES),
    memoryGb:
      parsePositiveNumber(config.memoryGb) ??
      parsePositiveNumber(process.env.PRIME_SANDBOX_MEMORY_GB),
    diskSizeGb:
      parsePositiveNumber(config.diskSizeGb) ??
      parsePositiveNumber(process.env.PRIME_SANDBOX_DISK_SIZE_GB),
    timeoutMs,
    timeoutMinutes:
      parsePositiveInt(config.timeoutMinutes) ??
      parsePositiveInt(process.env.PRIME_SANDBOX_TIMEOUT_MINUTES),
    runtime: config.runtime,
  };
}

function createSandboxState(
  source: PrimeCreateResponse,
  config: ResolvedPrimeConfig,
  runtime: Runtime,
  timeoutMs: number
): PrimeSandbox {
  return {
    ...source,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    timeoutMs,
    runtime,
  };
}

async function getPrimeSandbox(
  config: ResolvedPrimeConfig,
  sandboxId: string,
  runtime?: Runtime
): Promise<PrimeSandbox> {
  const data = await fetchJson<PrimeCreateResponse>(
    `${config.baseUrl}/api/v1/sandbox/${sandboxId}`,
    {
      method: 'GET',
      headers: apiHeaders(config.apiKey),
    }
  );

  const inferredRuntime = runtime || inferRuntimeFromImage(
    data.dockerImage || data.docker_image || config.image || DEFAULT_NODE_IMAGE
  );

  return createSandboxState(data, config, inferredRuntime, config.timeoutMs);
}

async function runPrimeCommand(
  sandbox: PrimeSandbox,
  command: string,
  options: { cwd?: string; env?: Record<string, string>; timeoutMs: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const deadline = Date.now() + options.timeoutMs;
  let attempt = 0;
  let lastError: unknown;

  while (Date.now() < deadline) {
    const current = await getPrimeSandbox(
      {
        apiKey: sandbox.apiKey,
        baseUrl: sandbox.baseUrl,
        timeoutMs: sandbox.timeoutMs,
      },
      sandbox.id,
      sandbox.runtime
    );

    sandbox.status = current.status;
    sandbox.errorType = current.errorType;
    sandbox.error_type = current.error_type;
    sandbox.errorMessage = current.errorMessage;
    sandbox.error_message = current.error_message;

    if (PRIME_FAILED_STATUSES.has(current.status || '')) {
      throw new Error(formatPrimeError(current));
    }

    if ((current.status || '') === 'RUNNING') {
      try {
        const remainingMs = Math.max(1_000, deadline - Date.now());
        return await execPrimeCommand(current, command, {
          cwd: options.cwd,
          env: options.env,
          timeoutMs: remainingMs,
        });
      } catch (error) {
        lastError = error;
      }
    }

    await sleep(attempt < 5 ? 1_000 : 2_000);
    attempt += 1;
  }

  const reason = lastError instanceof Error ? lastError.message : 'sandbox never became command-ready';
  throw new Error(`Prime sandbox ${sandbox.id} was not ready in time: ${reason}`);
}

async function execPrimeCommand(
  sandbox: PrimeSandbox,
  command: string,
  options: { cwd?: string; env?: Record<string, string>; timeoutMs: number }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const auth = await fetchJson<PrimeAuthResponse>(
    `${sandbox.baseUrl}/api/v1/sandbox/${sandbox.id}/auth`,
    {
      method: 'POST',
      headers: apiHeaders(sandbox.apiKey),
    }
  );

  const gatewayUrl = normalizeBaseUrl(auth.gateway_url || auth.gatewayUrl || '');
  const userNs = auth.user_ns || auth.userNs;
  const jobId = auth.job_id || auth.jobId;

  if (!gatewayUrl || !userNs || !jobId || !auth.token) {
    throw new Error(`Prime auth response was missing gateway details for sandbox ${sandbox.id}`);
  }

  const payload = {
    command,
    working_dir: options.cwd,
    env: validateEnv(options.env),
    sandbox_id: sandbox.id,
    timeout: Math.max(1, Math.ceil(options.timeoutMs / 1000)),
  };

  const result = await fetchJson<PrimeCommandResponse>(
    `${gatewayUrl}/${userNs}/${jobId}/exec`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    options.timeoutMs + 5_000
  );

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.exit_code ?? result.exitCode ?? 1,
  };
}

function validateEnv(env?: Record<string, string>): Record<string, string> {
  if (!env) return {};

  const validated: Record<string, string> = {};
  const safeKeyPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

  for (const [key, value] of Object.entries(env)) {
    if (!safeKeyPattern.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
    validated[key] = value;
  }

  return validated;
}

function apiHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

function withJsonHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    ...headers,
    'Content-Type': 'application/json',
  };
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) as unknown : {};

    if (!response.ok) {
      const detail = typeof data === 'object' && data !== null && 'detail' in data
        ? String((data as { detail?: unknown }).detail)
        : text || response.statusText;
      throw new Error(`Prime request failed (${response.status}) ${response.url}: ${detail}`);
    }

    return data as T;
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Prime request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text || '<empty response>';
  } catch {
    return '<failed to read response>';
  }
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
}

function detectRuntime(code: string, fallback: Runtime = 'node'): Runtime {
  if (
    code.includes('print(') ||
    code.includes('import ') ||
    code.includes('def ') ||
    code.includes('raise ')
  ) {
    return 'python';
  }

  return fallback;
}

function inferRuntimeFromImage(image: string): Runtime {
  const normalized = image.toLowerCase();
  if (normalized.includes('python')) return 'python';
  if (normalized.includes('bun')) return 'bun';
  if (normalized.includes('deno')) return 'deno';
  return 'node';
}

function defaultImageForRuntime(runtime: Runtime): string {
  return runtime === 'python' ? DEFAULT_PYTHON_IMAGE : DEFAULT_NODE_IMAGE;
}

function buildRuntimeCommand(code: string, runtime: Runtime): string {
  const encoded = Buffer.from(code, 'utf8').toString('base64');

  if (runtime === 'python') {
    return `echo "${encoded}" | base64 -d | (if command -v python3 >/dev/null 2>&1; then python3; else python; fi)`;
  }

  if (runtime === 'deno') {
    return `echo "${encoded}" | base64 -d | deno run -`;
  }

  if (runtime === 'bun') {
    return `echo "${encoded}" | base64 -d | bun`;
  }

  return `echo "${encoded}" | base64 -d | node`;
}

function wrapBackgroundCommand(command: string): string {
  return `nohup sh -lc ${escapeShellArg(command)} < /dev/null > /dev/null 2>&1 &`;
}

function combineOutput(stdout: string, stderr: string): string {
  if (stdout && stderr) {
    const needsSeparator = !stdout.endsWith('\n') && !stderr.startsWith('\n');
    return needsSeparator ? `${stdout}\n${stderr}` : `${stdout}${stderr}`;
  }
  return stdout || stderr;
}

function mapPrimeStatus(status: string): SandboxInfo['status'] {
  switch (status) {
    case 'PENDING':
    case 'PROVISIONING':
    case 'RUNNING':
      return 'running';
    case 'PAUSED':
    case 'TERMINATED':
      return 'stopped';
    default:
      return 'error';
  }
}

function formatPrimeError(sandbox: PrimeCreateResponse): string {
  const errorType = sandbox.errorType || sandbox.error_type;
  const errorMessage = sandbox.errorMessage || sandbox.error_message;
  const detail = [errorType, errorMessage].filter(Boolean).join(': ');
  return detail ? `Sandbox ${sandbox.id} ${sandbox.status}: ${detail}` : `Sandbox ${sandbox.id} ${sandbox.status}`;
}

function isSyntaxError(output: string, runtime: Runtime): boolean {
  const normalized = output.toLowerCase();

  if (runtime === 'python') {
    return (
      normalized.includes('syntaxerror') ||
      normalized.includes('invalid syntax') ||
      normalized.includes('indentationerror') ||
      normalized.includes('taberror')
    );
  }

  return (
    normalized.includes('syntaxerror') ||
    normalized.includes('unexpected token') ||
    normalized.includes('unexpected identifier') ||
    normalized.includes('parse error')
  );
}

function firstNonEmptyLine(text: string): string {
  const line = text
    .split('\n')
    .map(value => value.trim())
    .find(value => value.length > 0);

  return line || 'Invalid code.';
}

function parseDate(value?: string): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parsePositiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }

  if (typeof value === 'string') {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  return undefined;
}

function parsePositiveInt(value: unknown): number | undefined {
  const parsed = parsePositiveNumber(value);
  return parsed === undefined ? undefined : Math.floor(parsed);
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function createSandboxName(): string {
  return `prime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
