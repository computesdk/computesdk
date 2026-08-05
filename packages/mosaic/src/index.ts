import { performance } from 'node:perf_hooks';
import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  CreateSandboxOptions,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';

const PROVIDER = 'mosaic' as const;
const DEFAULT_TIMEOUT_MS = 120_000;
const COMMAND_HTTP_TIMEOUT_BUFFER_MS = 5_000;

export interface MosaicConfig {
  /** Public or private MAR REST endpoint. Falls back to MOSAIC_API_URL. */
  baseUrl?: string;
  /** Bearer token. Falls back to MOSAIC_API_TOKEN. */
  apiKey?: string;
  /** Default snapshot template. */
  template?: string;
  /** Default memory allocation in MiB. */
  memoryMb?: number;
  /** Default vCPU allocation. */
  vcpu?: number;
  /** HTTP request timeout. */
  requestTimeoutMs?: number;
}

export interface MosaicSandbox {
  id: string;
  template: string;
  memoryMb: number;
  vcpu: number;
  state: string;
  createdAt: Date;
  config: MosaicConfig;
}

interface MarCreateResponse {
  id: string;
  state: string;
  tti_ms: number;
}

interface MarExecResponse {
  stdout: string;
  stderr: string;
  exit_code: number;
  tti_ms: number;
}

interface MarVmInfo {
  id: string;
  template: string;
  state: string;
  memory_mb: number;
  vcpu: number;
}

class MosaicApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MosaicApiError';
  }
}

function env(name: string): string | undefined {
  return typeof process === 'undefined' ? undefined : process.env?.[name];
}

function resolvedConfig(config: MosaicConfig): Required<MosaicConfig> {
  const baseUrl = config.baseUrl || env('MOSAIC_API_URL') || '';
  if (!baseUrl) {
    throw new Error('Missing Mosaic API URL. Provide baseUrl or set MOSAIC_API_URL.');
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    apiKey: config.apiKey || env('MOSAIC_API_TOKEN') || '',
    template: config.template || 'node-20',
    memoryMb: config.memoryMb ?? 4096,
    vcpu: config.vcpu ?? 2,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

async function request<T>(
  config: MosaicConfig,
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const resolved = resolvedConfig(config);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('Mosaic API request timed out')),
    timeoutMs ?? resolved.requestTimeoutMs,
  );
  const upstreamSignal = init.signal;
  const abort = () => controller.abort(upstreamSignal?.reason);
  upstreamSignal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(`${resolved.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(resolved.apiKey ? { authorization: `Bearer ${resolved.apiKey}` } : {}),
        ...init.headers,
      },
    });
    const body = await response.text();
    if (!response.ok) {
      let detail = body;
      try {
        detail = JSON.parse(body).error || body;
      } catch {
        // Keep the response body as the diagnostic.
      }
      throw new MosaicApiError(response.status, `Mosaic API request failed (${response.status}): ${detail}`);
    }
    return (body ? JSON.parse(body) : undefined) as T;
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener('abort', abort);
  }
}

function templateFor(config: Required<MosaicConfig>, options?: CreateSandboxOptions): string {
  if (options?.templateId) return options.templateId;
  if (options?.runtime === 'python') return 'python-3.11';
  if (options?.runtime === 'node') return 'node-20';
  return config.template;
}

function memoryFor(config: Required<MosaicConfig>, options?: CreateSandboxOptions): number {
  return options?.memoryMb ?? options?.memoryMiB ?? options?.memMiB ?? options?.memory ?? config.memoryMb;
}

function vcpuFor(config: Required<MosaicConfig>, options?: CreateSandboxOptions): number {
  return options?.vcpus ?? options?.cpus ?? options?.cpu ?? config.vcpu;
}

function fromInfo(config: MosaicConfig, info: MarVmInfo): MosaicSandbox {
  return {
    id: info.id,
    template: info.template,
    memoryMb: info.memory_mb,
    vcpu: info.vcpu,
    state: info.state,
    createdAt: new Date(),
    config,
  };
}

function shellQuote(value: string): string {
  return `'${value.split("'").join("'\"'\"'")}'`;
}

function commandWithOptions(command: string, options?: RunCommandOptions): string {
  let result = command;
  if (options?.cwd) result = `cd ${shellQuote(options.cwd)} && ${result}`;
  if (options?.env && Object.keys(options.env).length > 0) {
    const assignments = Object.entries(options.env).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Invalid environment variable name: ${JSON.stringify(key)}`);
      }
      return `${key}=${shellQuote(value)}`;
    });
    result = `env ${assignments.join(' ')} ${result}`;
  }
  if (options?.background) result = `nohup sh -lc ${shellQuote(result)} >/dev/null 2>&1 &`;
  return result;
}

export const mosaic = defineProvider<MosaicSandbox, MosaicConfig>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config, options) => {
        const resolved = resolvedConfig(config);
        const template = templateFor(resolved, options);
        const memoryMb = memoryFor(resolved, options);
        const vcpu = vcpuFor(resolved, options);
        const created = await request<MarCreateResponse>(
          config,
          '/v1/sandboxes',
          {
            method: 'POST',
            // ComputeSDK TTI measures create -> command-over-vsock. SSH setup
            // is benchmarked separately and must not contaminate this metric.
            body: JSON.stringify({
              template,
              memory_mb: memoryMb,
              vcpu,
              enable_ssh: false,
              network_enabled: false,
            }),
            signal: options?.signal,
          },
          options?.timeout,
        );
        const sandbox: MosaicSandbox = {
          id: created.id,
          template,
          memoryMb,
          vcpu,
          state: created.state,
          createdAt: new Date(),
          config,
        };
        return { sandbox, sandboxId: sandbox.id };
      },

      getById: async (config, sandboxId) => {
        try {
          const info = await request<MarVmInfo>(config, `/v1/sandboxes/${encodeURIComponent(sandboxId)}`, {
            method: 'GET',
          });
          return { sandbox: fromInfo(config, info), sandboxId };
        } catch (error) {
          if (error instanceof MosaicApiError && (error.status === 400 || error.status === 404)) return null;
          throw error;
        }
      },

      list: async (config) => {
        const result = await request<{ sandboxes: MarVmInfo[] }>(config, '/v1/sandboxes', { method: 'GET' });
        return result.sandboxes.map((info) => ({
          sandbox: fromInfo(config, info),
          sandboxId: info.id,
        }));
      },

      destroy: async (config, sandboxId) => {
        try {
          await request<void>(config, `/v1/sandboxes/${encodeURIComponent(sandboxId)}`, { method: 'DELETE' });
        } catch (error) {
          if (error instanceof MosaicApiError && (error.status === 400 || error.status === 404)) return;
          throw error;
        }
      },

      runCommand: async (sandbox, command, options): Promise<CommandResult> => {
        const started = performance.now();
        const httpTimeoutMs = options?.timeout
          ? options.timeout + COMMAND_HTTP_TIMEOUT_BUFFER_MS
          : undefined;
        const result = await request<MarExecResponse>(
          sandbox.config,
          `/v1/sandboxes/${encodeURIComponent(sandbox.id)}/exec`,
          {
            method: 'POST',
            body: JSON.stringify({
              cmd: commandWithOptions(command, options),
              ...(options?.timeout ? { timeout_ms: options.timeout } : {}),
            }),
          },
          httpTimeoutMs,
        );
        options?.onStdout?.(result.stdout);
        options?.onStderr?.(result.stderr);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exit_code,
          durationMs: performance.now() - started,
        };
      },

      getInfo: async (sandbox): Promise<SandboxInfo> => {
        const info = await request<MarVmInfo>(
          sandbox.config,
          `/v1/sandboxes/${encodeURIComponent(sandbox.id)}`,
          { method: 'GET' },
        );
        return {
          id: info.id,
          provider: PROVIDER,
          status: info.state === 'running' ? 'running' : info.state === 'paused' ? 'stopped' : 'error',
          createdAt: sandbox.createdAt,
          timeout: resolvedConfig(sandbox.config).requestTimeoutMs,
          metadata: {
            template: info.template,
            memoryMb: info.memory_mb,
            vcpu: info.vcpu,
          },
        };
      },

      getUrl: async () => {
        throw new Error('Mosaic preview URLs are not implemented yet.');
      },

      getInstance: (sandbox) => sandbox,
    },
  },
});

export default mosaic;
