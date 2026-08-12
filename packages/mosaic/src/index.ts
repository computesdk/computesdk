import { performance } from 'node:perf_hooks';
import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  CommandResult,
  CreateSandboxOptions,
  CreateSnapshotOptions,
  CreateTemplateOptions,
  FileEntry,
  ListSnapshotsOptions,
  ListTemplatesOptions,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';

const PROVIDER = 'mosaic' as const;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 32;
// A queued request gives up its place rather than wait indefinitely, so a
// caller whose requests are all long-running keeps its concurrency: the queue
// smooths a burst of connection setups, it does not cap throughput.
const REQUEST_QUEUE_GRACE_MS = 1_000;
const COMMAND_HTTP_TIMEOUT_BUFFER_MS = 5_000;
const BUILD_TIMEOUT_MS = 20 * 60 * 1000;
const BUILD_POLL_INTERVAL_MS = 2_000;
const WORKSPACE = '/workspace';
/** Mosaic's stock templates. Anything else is one of the caller's environments. */
const STOCK_TEMPLATES = ['node-20', 'python-3.11'] as const;

export interface MosaicConfig {
  /** Public or private Mosaic REST endpoint. Falls back to MOSAIC_API_URL. */
  baseUrl?: string;
  /** Bearer token. Falls back to MOSAIC_API_TOKEN. */
  apiKey?: string;
  /** Default template. */
  template?: string;
  /** Default memory allocation in MiB. */
  memoryMb?: number;
  /** Default vCPU allocation. */
  vcpu?: number;
  /** HTTP request timeout. */
  requestTimeoutMs?: number;
  /**
   * How many HTTP requests this client keeps in flight before it starts
   * queueing. `fetch` opens a connection per in-flight request, so an
   * unbounded client answers a burst of sandbox creates with a burst of TLS
   * handshakes. Defaults to 32; Infinity restores the unbounded behaviour.
   */
  maxConcurrentRequests?: number;
  /** Give sandboxes egress. On by default; installs and fetches need it. */
  networkEnabled?: boolean;
  /** How long a preview URL from getUrl stays valid. */
  previewExpiresInSeconds?: number;
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

export interface MosaicSnapshot {
  id: string;
  provider: typeof PROVIDER;
  createdAt: Date;
  metadata: {
    name?: string;
    template: string;
    memoryMb: number;
    vcpu: number;
    sourceImage?: string;
    sourceImageDigest?: string;
  };
}

/**
 * A Mosaic environment is built from a container image, so template.create
 * takes the image to build from alongside the ComputeSDK fields.
 */
export interface MosaicTemplateOptions extends CreateTemplateOptions {
  /** Registry reference, e.g. `python:3.12-slim`. linux/amd64, must have /bin/sh. */
  image?: string;
  /** Delete the environment this long after it is built. */
  retentionSeconds?: number;
  /** Used for this one pull and never stored. */
  registryUsername?: string;
  registryPassword?: string;
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

interface MarSnapshotInfo {
  id: string;
  name?: string | null;
  source_sandbox_id?: string;
  template: string;
  memory_mb: number;
  vcpu: number;
  created_at_ns: number;
  source_image?: string;
  source_image_digest?: string;
}

interface MarOperation {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  error?: string | null;
  environment?: MarSnapshotInfo;
}

interface MarFileEntry {
  name: string;
  path: string;
  kind: 'file' | 'directory' | 'symlink';
  size: number;
  modified_at_ns: number;
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

let inFlight = 0;
let requestLimit = DEFAULT_MAX_CONCURRENT_REQUESTS;
const queued: Array<() => void> = [];

/**
 * Waits for room among the in-flight requests, or for the grace period,
 * whichever comes first.
 */
async function takeRequestSlot(): Promise<void> {
  if (inFlight < requestLimit) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    const proceed = () => {
      clearTimeout(timer);
      const waiting = queued.indexOf(proceed);
      if (waiting >= 0) queued.splice(waiting, 1);
      resolve();
    };
    const timer = setTimeout(proceed, REQUEST_QUEUE_GRACE_MS);
    // Node keeps the process alive for a pending timer it does not need to.
    (timer as unknown as { unref?: () => void }).unref?.();
    queued.push(proceed);
  });
  inFlight += 1;
}

function releaseRequestSlot(): void {
  inFlight -= 1;
  queued.shift()?.();
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
    maxConcurrentRequests: config.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS,
    networkEnabled: config.networkEnabled ?? true,
    previewExpiresInSeconds: config.previewExpiresInSeconds ?? 3600,
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
  requestLimit = resolved.maxConcurrentRequests;
  await takeRequestSlot();
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
        const parsed = JSON.parse(body);
        // The gateway names the remedy in `message`; `error` alone is a code.
        detail = [parsed.error, parsed.message, parsed.remediation].filter(Boolean).join(': ') || body;
      } catch {
        // Keep the response body as the diagnostic.
      }
      throw new MosaicApiError(response.status, `Mosaic API request failed (${response.status}): ${detail}`);
    }
    return (body ? JSON.parse(body) : undefined) as T;
  } finally {
    releaseRequestSlot();
    clearTimeout(timer);
    upstreamSignal?.removeEventListener('abort', abort);
  }
}

function isStockTemplate(value: string): boolean {
  return (STOCK_TEMPLATES as readonly string[]).includes(value);
}

function memoryFor(config: Required<MosaicConfig>, options?: CreateSandboxOptions): number {
  return options?.memoryMb ?? options?.memoryMiB ?? options?.memMiB ?? options?.memory ?? config.memoryMb;
}

function vcpuFor(config: Required<MosaicConfig>, options?: CreateSandboxOptions): number {
  return options?.vcpus ?? options?.cpus ?? options?.cpu ?? config.vcpu;
}

/**
 * Mosaic boots either a stock template or one of the caller's own
 * environments, which are named. ComputeSDK spells the second one three ways
 * — `snapshotId`, `image`, or a `templateId` that is not stock — and they all
 * mean the same request here.
 */
function bootFrom(
  config: Required<MosaicConfig>,
  options?: CreateSandboxOptions,
): { template?: string; snapshot_id?: string } {
  const environment =
    options?.snapshotId ||
    options?.image ||
    (options?.templateId && !isStockTemplate(options.templateId) ? options.templateId : undefined);
  if (environment) return { snapshot_id: environment };
  if (options?.templateId) return { template: options.templateId };
  if (options?.runtime === 'python') return { template: 'python-3.11' };
  if (options?.runtime === 'node') return { template: 'node-20' };
  return isStockTemplate(config.template)
    ? { template: config.template }
    : { snapshot_id: config.template };
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

function asSnapshot(info: MarSnapshotInfo): MosaicSnapshot {
  return {
    id: info.id,
    provider: PROVIDER,
    createdAt: new Date(Math.round(info.created_at_ns / 1_000_000)),
    metadata: {
      ...(info.name ? { name: info.name } : {}),
      template: info.template,
      memoryMb: info.memory_mb,
      vcpu: info.vcpu,
      ...(info.source_image ? { sourceImage: info.source_image } : {}),
      ...(info.source_image_digest ? { sourceImageDigest: info.source_image_digest } : {}),
    },
  };
}

function commandWithOptions(command: string, options?: RunCommandOptions): string {
  let result = command;
  if (options?.cwd) result = `cd "${escapeShellArg(options.cwd)}" && ${result}`;
  if (options?.env && Object.keys(options.env).length > 0) {
    const assignments = Object.entries(options.env).map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Invalid environment variable name: ${JSON.stringify(key)}`);
      }
      return `${key}="${escapeShellArg(value)}"`;
    });
    result = `env ${assignments.join(' ')} ${result}`;
  }
  return result;
}

/**
 * The files API is scoped to /workspace, where a sandbox's work belongs and
 * where it is fastest and binary-safe. Anything outside it — /tmp, /etc — is
 * still a legitimate place for a command to have written, so those paths go
 * through the shell instead of failing.
 */
function inWorkspace(path: string): boolean {
  return !path.startsWith('/') || path === WORKSPACE || path.startsWith(`${WORKSPACE}/`);
}

type Exec = (sandbox: MosaicSandbox, command: string, options?: RunCommandOptions) => Promise<CommandResult>;

async function shell(
  runCommand: Exec,
  sandbox: MosaicSandbox,
  command: string,
  failure: string,
): Promise<string> {
  const result = await runCommand(sandbox, command);
  if (result.exitCode !== 0) {
    throw new Error(`${failure}: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
  }
  return result.stdout;
}

export const mosaic = defineProvider<MosaicSandbox, MosaicConfig, MosaicSnapshot, MosaicSnapshot>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config, options) => {
        const resolved = resolvedConfig(config);
        const boot = bootFrom(resolved, options);
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
              ...boot,
              memory_mb: memoryMb,
              vcpu,
              enable_ssh: false,
              network_enabled: resolved.networkEnabled,
              ...(options?.metadata ? { metadata: options.metadata } : {}),
            }),
            signal: options?.signal,
          },
          options?.timeout,
        );
        const sandbox: MosaicSandbox = {
          id: created.id,
          template: boot.template ?? boot.snapshot_id ?? resolved.template,
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
        if (options?.background) {
          // exec waits for the command's whole process group, so a trailing `&`
          // hangs until the timeout. A durable process is the shape that
          // outlives the request, which is what a dev server needs.
          const durable = await request<{ id: string }>(
            sandbox.config,
            `/v1/sandboxes/${encodeURIComponent(sandbox.id)}/processes`,
            {
              method: 'POST',
              body: JSON.stringify({
                cmd: command,
                ...(options.cwd ? { cwd: options.cwd } : {}),
                ...(options.env ? { env: options.env } : {}),
              }),
            },
          );
          return {
            stdout: durable.id,
            stderr: '',
            exitCode: 0,
            durationMs: performance.now() - started,
          };
        }
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

      getUrl: async (sandbox, options): Promise<string> => {
        if (options.protocol && options.protocol !== 'https') {
          // Previews terminate TLS at Mosaic's edge; the guest port is plain HTTP.
          throw new Error(
            `Mosaic previews are served over https; ${options.protocol} was requested for port ${options.port}.`,
          );
        }
        const resolved = resolvedConfig(sandbox.config);
        const preview = await request<{ url: string }>(
          sandbox.config,
          `/v1/sandboxes/${encodeURIComponent(sandbox.id)}/previews`,
          {
            method: 'POST',
            body: JSON.stringify({
              port: options.port,
              expires_in_seconds: resolved.previewExpiresInSeconds,
            }),
          },
        );
        return preview.url;
      },

      filesystem: {
        readFile: async (sandbox, path, runCommand): Promise<string> => {
          if (!inWorkspace(path)) {
            return shell(runCommand, sandbox, `cat "${escapeShellArg(path)}"`, `Failed to read ${path}`);
          }
          const file = await request<{ content_base64: string }>(
            sandbox.config,
            `/v1/sandboxes/${encodeURIComponent(sandbox.id)}/files/content?path=${encodeURIComponent(path)}`,
            { method: 'GET' },
          );
          return Buffer.from(file.content_base64, 'base64').toString('utf8');
        },

        writeFile: async (sandbox, path, content, runCommand): Promise<void> => {
          const encoded = Buffer.from(content, 'utf8').toString('base64');
          if (!inWorkspace(path)) {
            const directory = path.slice(0, path.lastIndexOf('/')) || '/';
            await shell(
              runCommand,
              sandbox,
              `mkdir -p "${escapeShellArg(directory)}" && printf %s "${escapeShellArg(encoded)}" | base64 -d > "${escapeShellArg(path)}"`,
              `Failed to write ${path}`,
            );
            return;
          }
          await request<void>(
            sandbox.config,
            `/v1/sandboxes/${encodeURIComponent(sandbox.id)}/files/content`,
            {
              method: 'PUT',
              body: JSON.stringify({ path, content_base64: encoded, create_parents: true }),
            },
          );
        },

        mkdir: async (sandbox, path, runCommand): Promise<void> => {
          if (!inWorkspace(path)) {
            await shell(runCommand, sandbox, `mkdir -p "${escapeShellArg(path)}"`, `Failed to create ${path}`);
            return;
          }
          await request<void>(
            sandbox.config,
            `/v1/sandboxes/${encodeURIComponent(sandbox.id)}/files/mkdir`,
            { method: 'POST', body: JSON.stringify({ path, recursive: true }) },
          );
        },

        readdir: async (sandbox, path, runCommand): Promise<FileEntry[]> => {
          if (!inWorkspace(path)) {
            const listing = await shell(
              runCommand,
              sandbox,
              `ls -Ap --time-style=+%s -l "${escapeShellArg(path)}"`,
              `Failed to list ${path}`,
            );
            return listing
              .split('\n')
              .slice(1)
              .flatMap((line) => {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 7) return [];
                const name = parts.slice(6).join(' ');
                return [
                  {
                    name: name.replace(/\/$/, ''),
                    type: name.endsWith('/') ? ('directory' as const) : ('file' as const),
                    size: Number.parseInt(parts[4], 10) || 0,
                    modified: new Date(Number.parseInt(parts[5], 10) * 1000),
                  },
                ];
              });
          }
          const listing = await request<{ entries: MarFileEntry[] }>(
            sandbox.config,
            `/v1/sandboxes/${encodeURIComponent(sandbox.id)}/files?path=${encodeURIComponent(path)}`,
            { method: 'GET' },
          );
          return listing.entries.map((entry) => ({
            name: entry.name,
            type: entry.kind === 'directory' ? ('directory' as const) : ('file' as const),
            size: entry.size,
            modified: new Date(Math.round(entry.modified_at_ns / 1_000_000)),
          }));
        },

        exists: async (sandbox, path, runCommand): Promise<boolean> => {
          const result = await runCommand(
            sandbox,
            `test -e "${escapeShellArg(path)}"`,
          );
          return result.exitCode === 0;
        },

        remove: async (sandbox, path, runCommand): Promise<void> => {
          if (!inWorkspace(path)) {
            await shell(runCommand, sandbox, `rm -rf "${escapeShellArg(path)}"`, `Failed to remove ${path}`);
            return;
          }
          await request<void>(
            sandbox.config,
            `/v1/sandboxes/${encodeURIComponent(sandbox.id)}/files/content?path=${encodeURIComponent(path)}&recursive=true`,
            { method: 'DELETE' },
          );
        },
      },

      getInstance: (sandbox) => sandbox,
    },

    snapshot: {
      create: async (config, sandboxId, options?: CreateSnapshotOptions) => {
        const snapshot = await request<MarSnapshotInfo>(
          config,
          `/v1/sandboxes/${encodeURIComponent(sandboxId)}/snapshots`,
          { method: 'POST', body: JSON.stringify(options?.name ? { name: options.name } : {}) },
        );
        return asSnapshot(snapshot);
      },

      list: async (config, options?: ListSnapshotsOptions) => {
        const result = await request<{ snapshots: MarSnapshotInfo[] }>(config, '/v1/snapshots', {
          method: 'GET',
        });
        const matching = options?.sandboxId
          ? result.snapshots.filter((snapshot) => snapshot.source_sandbox_id === options.sandboxId)
          : result.snapshots;
        const snapshots = matching.map(asSnapshot);
        return options?.limit ? snapshots.slice(0, options.limit) : snapshots;
      },

      delete: async (config, snapshotId) => {
        await request<void>(config, `/v1/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
      },
    },

    template: {
      /**
       * A Mosaic template is an environment built from a container image. The
       * build runs in a throwaway VM and takes minutes, so this polls the
       * operation the gateway returns; the environment it yields restores as
       * fast as a stock template.
       */
      create: async (config: MosaicConfig, options: MosaicTemplateOptions) => {
        if (!options.image) {
          throw new Error(
            'Mosaic builds a template from a container image: pass `image`, e.g. { name: "my-env", image: "python:3.12-slim" }.',
          );
        }
        let operation = await request<MarOperation>(config, '/v1/environments', {
          method: 'POST',
          body: JSON.stringify({
            image: options.image,
            name: options.name,
            ...(options.retentionSeconds ? { retention_seconds: options.retentionSeconds } : {}),
            ...(options.registryUsername ? { registry_username: options.registryUsername } : {}),
            ...(options.registryPassword ? { registry_password: options.registryPassword } : {}),
          }),
        });
        const deadline = Date.now() + BUILD_TIMEOUT_MS;
        while (operation.status === 'pending' || operation.status === 'running') {
          if (Date.now() > deadline) {
            throw new Error(`Mosaic image build did not finish within ${BUILD_TIMEOUT_MS / 60_000} minutes.`);
          }
          await new Promise((resolve) => setTimeout(resolve, BUILD_POLL_INTERVAL_MS));
          operation = await request<MarOperation>(
            config,
            `/v1/operations/${encodeURIComponent(operation.id)}`,
            { method: 'GET' },
          );
        }
        if (operation.status === 'failed' || !operation.environment) {
          throw new Error(`Mosaic image build failed: ${operation.error || 'no environment was produced'}`);
        }
        return asSnapshot(operation.environment);
      },

      list: async (config, options?: ListTemplatesOptions) => {
        const result = await request<{ snapshots: MarSnapshotInfo[] }>(config, '/v1/snapshots', {
          method: 'GET',
        });
        const templates = result.snapshots.filter((snapshot) => snapshot.source_image).map(asSnapshot);
        return options?.limit ? templates.slice(0, options.limit) : templates;
      },

      delete: async (config, templateId) => {
        await request<void>(config, `/v1/snapshots/${encodeURIComponent(templateId)}`, { method: 'DELETE' });
      },
    },
  },
});

export default mosaic;
