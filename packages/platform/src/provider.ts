/**
 * The hosted-platform provider: `defineProvider({ name: 'platform', … })`
 * over the platform's `/api/v1/sandboxes` routes, sharing auth resolution,
 * host trust, SSE parsing and error handling with `@computesdk/cli`'s
 * transport in `client.ts`.
 */
import { randomUUID } from 'node:crypto';
import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  CreateInstanceOptions,
  FileEntry,
  InstanceInfo,
  RunCommandOptions,
} from '@computesdk/provider';
import {
  PlatformApiError,
  PlatformClient,
  PlatformClientError,
  readSseNamedEvents,
  resolvePlatformAuth,
} from './client.js';
import type {
  CommandResult as PlatformCommandResult,
  PathView,
  SandboxDetail,
  SandboxSummary,
} from './types.js';

export type PlatformSize = 'small' | 'medium' | 'large' | 'xlarge';

export interface PlatformConfig {
  /** An org API key or an OAuth access token; both are sent as Bearer. */
  apiKey?: string;
  /** baseUrl > COMPUTE_PLATFORM_URL > BENCHMARKS_PLATFORM_URL > the default host. */
  baseUrl?: string;
  /** Org slug, sent as X-Org-Slug (also COMPUTE_ORG); ignored for org API keys. */
  org?: string;
  /** Send credentials to a host outside computesdk.com/loopback. */
  allowUntrustedHost?: boolean;
  /** Applied to every create unless the call overrides it. */
  defaults?: {
    size?: PlatformSize;
    maxPrice?: { usd: number; per: 'second' | 'minute' | 'hour' };
    orderType?: 'market' | 'limit';
    providerOrder?: string[];
  };
  /** fetch override, for tests and proxies. */
  fetch?: typeof fetch;
}

/** Platform-specific create options, alongside the universal ones. */
export interface PlatformCreateOptions extends CreateInstanceOptions {
  size?: PlatformSize;
  maxPrice?: { usd: number; per: 'second' | 'minute' | 'hour' };
  orderType?: 'market' | 'limit';
  providerOrder?: string[];
  /** Org vault secret names to inject, up to 100. */
  secrets?: string[];
  /** Disk v1: `{ diskId, path, readonly?, branch? }`; diskId must be under `<orgSlug>/`. */
  disk?: { diskId: string; path: string; readonly?: boolean; branch?: string };
  /** Sandbox label (falls back to universal `name`); max 200 characters. */
  label?: string;
  /** Makes the create safe to replay across process restarts. */
  idempotencyKey?: string;
}

/** What the SDK's instance handle carries through to every method call. */
interface PlatformInstance {
  id: string;
  detail: SandboxDetail;
  client: PlatformClient;
  /** envs passed at create — merged under each command's env. */
  envs: Record<string, string>;
  /** The create's `timeout` — getInfo fallback when `summary.timeoutMs` is null. */
  createTimeout?: number;
}

const SANDBOXES = '/api/v1/sandboxes';
const CREATE_REQUEST_TIMEOUT_MS = 310_000;
const CREATE_DEADLINE_MS = 6 * 60_000;
const CREATE_POLL_MS = 2_000;
const BOOTING_RETRY_WINDOW_MS = 60_000;
const COMMAND_TIMEOUT_LIMIT_MS = 290_000;
const COMMAND_LENGTH_LIMIT_BYTES = 64 * 1024;
const FILE_CONTENT_LIMIT_BYTES = 4 * 1024 * 1024;

const FILE_LIMIT_MESSAGE =
  'The files API carries about 4 MB per request. Files larger than that need an upload/download URL (not yet implemented).';
const COMMAND_TIMEOUT_MESSAGE =
  "Commands over 290s can't run in one request; use background: true or processes";

function invalidArgument(message: string): PlatformClientError {
  return new PlatformClientError('invalid_argument', message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && /fetch failed/i.test(error.message);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError';
}

/** Combines a timeout with an optional caller signal (AbortSignal.any fallback). */
function createSignal(timeoutMs: number, caller?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('The create request timed out', 'TimeoutError')),
    timeoutMs,
  );
  (timer as { unref?: () => void }).unref?.();
  caller?.addEventListener('abort', () => controller.abort(caller.reason), { once: true });
  return controller.signal;
}

/**
 * One request with the SDK's retry policy: `sandbox_booting` exponential
 * backoff (up to ~60 s — matched on the code, not the status, so
 * `no_market_capacity` 503s are never retried), 429 honoring Retry-After,
 * and network retries on GET/DELETE only. No other POST is retried.
 */
async function request<T>(call: () => Promise<T>, retryOnNetworkError: boolean): Promise<T> {
  const bootingDeadline = Date.now() + BOOTING_RETRY_WINDOW_MS;
  let bootBackoff = 500;
  let rateLimited = 0;
  let networkAttempts = 0;
  for (;;) {
    try {
      return await call();
    } catch (error) {
      if (error instanceof PlatformApiError && error.code === 'sandbox_booting' && Date.now() < bootingDeadline) {
        await sleep(bootBackoff);
        bootBackoff = Math.min(bootBackoff * 2, 8_000);
        continue;
      }
      if (error instanceof PlatformApiError && error.status === 429 && rateLimited < 3) {
        rateLimited += 1;
        await sleep(error.retryAfterMs ?? Math.min(2_000 * rateLimited, 10_000));
        continue;
      }
      if (isNetworkError(error) && retryOnNetworkError && networkAttempts < 2) {
        networkAttempts += 1;
        await sleep(500 * (networkAttempts + 1));
        continue;
      }
      throw error;
    }
  }
}

// ─── Create-body mapping ────────────────────────────────────────────────────

const RESOURCE_ALIASES: Record<string, 'cpus' | 'memoryMb' | 'ephemeralDiskMb'> = {
  cpus: 'cpus',
  vcpus: 'cpus',
  memoryMb: 'memoryMb',
  memoryMiB: 'memoryMb',
  memMiB: 'memoryMb',
  memory: 'memoryMb',
  diskMb: 'ephemeralDiskMb',
  diskMiB: 'ephemeralDiskMb',
};

/** Keys consumed by this mapping or handled elsewhere — never resource keys. */
const KNOWN_CREATE_KEYS = new Set([
  'size', 'maxPrice', 'orderType', 'providerOrder', 'secrets', 'disk', 'label',
  'idempotencyKey', 'timeout', 'image', 'templateId', 'snapshotId', 'name',
  'envs', 'signal', 'provider', 'kind',
]);

const VALID_SIZES: ReadonlySet<string> = new Set(['small', 'medium', 'large', 'xlarge']);

function buildCreateBody(config: PlatformConfig, options?: CreateInstanceOptions): Record<string, unknown> {
  const opts = (options ?? {}) as PlatformCreateOptions;
  if (opts.size !== undefined && !VALID_SIZES.has(opts.size)) {
    throw invalidArgument(`size must be one of ${[...VALID_SIZES].join('/')}`);
  }
  const body: Record<string, unknown> = {};

  // Resource options → body resources {cpus, memoryMb, ephemeralDiskMb}.
  const resources: Record<string, number> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value === undefined || KNOWN_CREATE_KEYS.has(key)) continue;
    const mapped = RESOURCE_ALIASES[key];
    if (mapped && typeof value === 'number') {
      resources[mapped] = value;
    } else if (!mapped) {
      throw invalidArgument('The platform provider supports size, or cpus/memoryMb/diskMb');
    }
  }
  const hasResources = Object.keys(resources).length > 0;

  const size = opts.size ?? (hasResources ? undefined : config.defaults?.size);
  if (size && hasResources) {
    throw invalidArgument('size and resources are mutually exclusive: pass one or the other');
  }

  if (size) body.size = size;
  if (hasResources) body.resources = resources;

  const maxPrice = opts.maxPrice ?? config.defaults?.maxPrice;
  if (maxPrice) body.maxPrice = maxPrice;
  const orderType = opts.orderType ?? config.defaults?.orderType;
  if (orderType) body.orderType = orderType;
  const providerOrder = opts.providerOrder ?? config.defaults?.providerOrder;
  if (providerOrder) body.providerOrder = providerOrder;

  if (opts.timeout !== undefined) body.timeoutMs = opts.timeout;
  const image = opts.image ?? opts.templateId;
  if (image !== undefined) body.image = image;
  if (opts.snapshotId !== undefined) body.snapshotId = opts.snapshotId;
  const label = opts.label ?? opts.name;
  if (label !== undefined) body.label = label;
  if (opts.secrets !== undefined) body.secrets = opts.secrets;
  if (opts.disk !== undefined) body.disk = opts.disk;

  body.idempotencyKey = opts.idempotencyKey ?? `sdk-create:${randomUUID()}`;
  return body;
}

// ─── Instance methods ───────────────────────────────────────────────────────

function toInstance(detail: SandboxDetail, client: PlatformClient, envs?: Record<string, string>, createTimeout?: number): PlatformInstance {
  return { id: detail.id, detail, client, envs: envs ?? {}, createTimeout };
}

function toInfo(detail: SandboxDetail, createTimeout?: number): InstanceInfo {
  const status: InstanceInfo['status'] =
    detail.status === 'destroyed'
      ? detail.destroyError
        ? 'error'
        : 'stopped'
      : 'running';
  return {
    id: detail.id,
    provider: 'platform',
    status,
    createdAt: new Date(detail.createdAt),
    timeout: detail.timeoutMs ?? createTimeout ?? 0,
    metadata: {
      provider: detail.provider,
      providerSandboxId: detail.providerSandboxId,
      platformStatus: detail.status,
      placement: detail.placement,
      cost: detail.cost,
      label: detail.label,
      image: detail.image,
      secrets: detail.secrets,
    },
  };
}

function checkCommandLength(command: string): void {
  if (new TextEncoder().encode(command).length > COMMAND_LENGTH_LIMIT_BYTES) {
    throw invalidArgument(`Commands are limited to ${COMMAND_LENGTH_LIMIT_BYTES / 1024} KB on the platform`);
  }
}

function commandBody(
  inst: PlatformInstance,
  command: string,
  options?: RunCommandOptions,
): Record<string, unknown> {
  checkCommandLength(command);
  const body: Record<string, unknown> = { command };
  if (options?.timeout !== undefined) {
    if (options.timeout > COMMAND_TIMEOUT_LIMIT_MS) throw invalidArgument(COMMAND_TIMEOUT_MESSAGE);
    body.timeoutMs = options.timeout;
  }
  if (options?.cwd !== undefined) body.cwd = options.cwd;
  const env = { ...inst.envs, ...(options?.env ?? {}) };
  if (Object.keys(env).length > 0) body.env = env;
  return body;
}

export const platform = defineProvider<PlatformInstance, PlatformConfig>({
  name: 'platform',
  methods: {
    instances: {
      create: async (config: PlatformConfig, options?: CreateInstanceOptions) => {
        const client = await resolveClient(config);
        const body = buildCreateBody(config, options);
        const key = body.idempotencyKey as string;
        const deadline = Date.now() + CREATE_DEADLINE_MS;
        const signal = options?.signal;

        for (;;) {
          let detail: SandboxDetail | null = null;
          try {
            const res = await client.post<{ sandbox: SandboxDetail }>(
              SANDBOXES,
              body,
              { signal: createSignal(CREATE_REQUEST_TIMEOUT_MS, signal) },
            );
            detail = res.sandbox;
          } catch (error) {
            if (signal?.aborted) throw signal.reason ?? error;
            // Network error or client timeout: the row may exist — replay
            // the same request under the same idempotency key until the
            // deadline, then admit the outcome is unknowable rather than
            // let a fallback provider double-boot.
            if (isNetworkError(error) || isTimeoutError(error)) {
              if (Date.now() < deadline) continue;
              throw outcomeUnknown(key);
            }
            throw error;
          }

          if (detail.status === 'running') {
            return { instance: toInstance(detail, client, options?.envs, options?.timeout), instanceId: detail.id };
          }
          if (detail.status !== 'creating') {
            // A replay surfaced a row in another state (e.g. destroyed).
            return { instance: toInstance(detail, client, options?.envs, options?.timeout), instanceId: detail.id };
          }

          // The first attempt is still placing: poll until it lands, its
          // reservation row is cleaned up (404 → the key is free; replay the
          // create once more), or the deadline passes.
          while (Date.now() < deadline) {
            let current: SandboxDetail | null;
            try {
              const res: { sandbox: SandboxDetail } = await client.get<{ sandbox: SandboxDetail }>(
                `${SANDBOXES}/${detail.id}`,
                undefined,
                { signal },
              );
              current = res.sandbox;
            } catch (error) {
              if (signal?.aborted) throw signal.reason ?? error;
              if (error instanceof PlatformApiError && error.status === 404) {
                current = null;
              } else if (isNetworkError(error)) {
                await sleep(CREATE_POLL_MS);
                continue;
              } else {
                throw error;
              }
            }
            if (current === null) break; // freed key → outer loop replays the create
            if (current.status === 'running') {
              return { instance: toInstance(current, client, options?.envs, options?.timeout), instanceId: current.id };
            }
            detail = current;
            await sleep(CREATE_POLL_MS);
          }

          // A box may exist and be billing — falling back to another
          // provider would boot a second one.
          if (Date.now() >= deadline) throw outcomeUnknown(key);
        }
      },

      getById: async (config: PlatformConfig, instanceId: string) => {
        const client = await resolveClient(config);
        try {
          const res = await request(
            () => client.get<{ sandbox: SandboxDetail }>(`${SANDBOXES}/${instanceId}`),
            true,
          );
          return { instance: toInstance(res.sandbox, client), instanceId: res.sandbox.id };
        } catch (error) {
          if (error instanceof PlatformApiError && error.status === 404) return null;
          throw error;
        }
      },

      list: async (config: PlatformConfig) => {
        const client = await resolveClient(config);
        const instances: { instance: PlatformInstance; instanceId: string }[] = [];
        let cursor: string | null = null;
        do {
          const res = await request(
            () =>
              client.get<{ sandboxes: SandboxSummary[]; nextCursor: string | null }>(SANDBOXES, {
                status: 'running',
                limit: '100',
                ...(cursor ? { cursor } : {}),
              }),
            true,
          );
          for (const summary of res.sandboxes) {
            const detail = summary as unknown as SandboxDetail;
            instances.push({ instance: toInstance(detail, client), instanceId: summary.id });
          }
          cursor = res.nextCursor;
        } while (cursor);
        return instances;
      },

      destroy: async (config: PlatformConfig, instanceId: string) => {
        const client = await resolveClient(config);
        try {
          await request(() => client.del(`${SANDBOXES}/${instanceId}`), true);
        } catch (error) {
          // Destroy is idempotent: a missing row is already gone.
          if (!(error instanceof PlatformApiError && error.status === 404)) throw error;
        }
      },

      runCommand: async (inst: PlatformInstance, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        if (options?.background) {
          // Same request-size guard the buffered path applies.
          checkCommandLength(command);
          await request(
            () =>
              inst.client.post(`${SANDBOXES}/${inst.id}/processes`, {
                command,
                ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
                ...(Object.keys({ ...inst.envs, ...(options.env ?? {}) }).length > 0
                  ? { env: { ...inst.envs, ...(options.env ?? {}) } }
                  : {}),
              }),
            false,
          );
          return { stdout: '', stderr: '', exitCode: 0, durationMs: 0 };
        }
        const res = await request(
          () => inst.client.post<PlatformCommandResult>(`${SANDBOXES}/${inst.id}/commands`, commandBody(inst, command, options)),
          false,
        );
        return { stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode, durationMs: res.durationMs };
      },

      streamCommand: async (inst: PlatformInstance, command: string, options: RunCommandOptions): Promise<CommandResult> => {
        const body = await request(
          () => inst.client.postStream(`${SANDBOXES}/${inst.id}/commands`, commandBody(inst, command, options)),
          false,
        );
        let stdout = '';
        let stderr = '';
        for await (const { event, data } of readSseNamedEvents(body)) {
          const d = data as Record<string, unknown>;
          if (event === 'stdout') {
            stdout += String(d.chunk ?? '');
            options.onStdout?.(String(d.chunk ?? ''));
          } else if (event === 'stderr') {
            stderr += String(d.chunk ?? '');
            options.onStderr?.(String(d.chunk ?? ''));
          } else if (event === 'exit') {
            return {
              stdout,
              stderr,
              // Killed by a signal → 128, as the CLI's followProcess does.
              exitCode: typeof d.exitCode === 'number' ? d.exitCode : 128,
              durationMs: typeof d.durationMs === 'number' ? d.durationMs : 0,
            };
          } else if (event === 'error') {
            throw new PlatformApiError(
              typeof d.status === 'number' ? d.status : 500,
              typeof d.error === 'string' ? d.error : 'Command stream failed',
            );
          }
        }
        throw new PlatformClientError('stream_ended', 'Command stream ended before the command exited');
      },

      getInfo: async (inst: PlatformInstance): Promise<InstanceInfo> => {
        const res = await request(
          () => inst.client.get<{ sandbox: SandboxDetail }>(`${SANDBOXES}/${inst.id}`),
          true,
        );
        inst.detail = res.sandbox;
        return toInfo(res.sandbox, inst.createTimeout);
      },

      getUrl: async (inst: PlatformInstance, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          const res = await request(
            () =>
              inst.client.get<{ url: string }>(`${SANDBOXES}/${inst.id}/urls`, {
                port: String(options.port),
                ...(options.protocol !== undefined ? { protocol: options.protocol } : {}),
              }),
            true,
          );
          return res.url;
        } catch (error) {
          if (error instanceof PlatformApiError && error.status === 501) {
            throw new Error("This sandbox's provider has no public URLs");
          }
          throw error;
        }
      },

      filesystem: {
        readFile: async (inst: PlatformInstance, path: string): Promise<string> => {
          let view: PathView;
          try {
            view = await request(
              () => inst.client.get<PathView>(`${SANDBOXES}/${inst.id}/files`, { path }),
              true,
            );
          } catch (error) {
            if (error instanceof PlatformApiError && error.status === 404) {
              throw enoent(path);
            }
            if (error instanceof PlatformApiError && error.status === 413) {
              throw invalidArgument(FILE_LIMIT_MESSAGE);
            }
            throw error;
          }
          if (view.type === 'directory') {
            throw new Error(`path is a directory: ${path}`);
          }
          return view.content;
        },

        writeFile: async (inst: PlatformInstance, path: string, content: string): Promise<void> => {
          // The platform's ~4 MB cap applies to the request on the wire,
          // not the raw string: JSON escaping expands quotes, backslashes
          // and newlines, so measure the body actually sent.
          const body = { path, content };
          if (new TextEncoder().encode(JSON.stringify(body)).length > FILE_CONTENT_LIMIT_BYTES) {
            throw invalidArgument(FILE_LIMIT_MESSAGE);
          }
          await request(
            () => inst.client.post(`${SANDBOXES}/${inst.id}/files`, body),
            false,
          );
        },

        mkdir: async (inst: PlatformInstance, path: string): Promise<void> => {
          await request(
            () => inst.client.post(`${SANDBOXES}/${inst.id}/files`, { path, mkdir: true }),
            false,
          );
        },

        readdir: async (inst: PlatformInstance, path: string): Promise<FileEntry[]> => {
          let view: PathView;
          try {
            view = await request(
              () => inst.client.get<PathView>(`${SANDBOXES}/${inst.id}/files`, { path }),
              true,
            );
          } catch (error) {
            if (error instanceof PlatformApiError && error.status === 404) throw enoent(path);
            throw error;
          }
          if (view.type !== 'directory') {
            throw new Error(`path is not a directory: ${path}`);
          }
          return view.entries.map((e) => ({
            name: e.name,
            type: e.type,
            ...(e.size !== undefined ? { size: e.size } : {}),
            ...(e.modified !== undefined ? { modified: new Date(e.modified) } : {}),
          }));
        },

        exists: async (inst: PlatformInstance, path: string): Promise<boolean> => {
          try {
            await request(
              () => inst.client.get<PathView>(`${SANDBOXES}/${inst.id}/files`, { path }),
              true,
            );
            return true;
          } catch (error) {
            if (error instanceof PlatformApiError && error.status === 404) return false;
            throw error;
          }
        },

        remove: async (inst: PlatformInstance, path: string): Promise<void> => {
          await request(
            () => inst.client.del(`${SANDBOXES}/${inst.id}/files?path=${encodeURIComponent(path)}`),
            true,
          );
        },
      },
    },
  },
});

function outcomeUnknown(key: string): PlatformClientError {
  const err = new PlatformClientError(
    'create_outcome_unknown',
    `Sandbox create outcome unknown after 6 minutes (idempotencyKey: ${key}). ` +
      'Check the org dashboard before retrying — the sandbox may still be creating.',
  );
  err.fallback = false;
  return err;
}

function enoent(path: string): Error {
  const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
  (error as NodeJS.ErrnoException).code = 'ENOENT';
  return error;
}

/** Auth resolves once per provider config object and is cached. */
const resolvedClients = new WeakMap<PlatformConfig, Promise<PlatformClient>>();

function resolveClient(config: PlatformConfig): Promise<PlatformClient> {
  let promise = resolvedClients.get(config);
  if (!promise) {
    promise = resolvePlatformAuth({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      allowUntrustedHost: config.allowUntrustedHost,
      org: config.org,
    }).then((auth) => new PlatformClient(auth, config.fetch));
    resolvedClients.set(config, promise);
    // A failed resolution (no_credentials, untrusted host) should not poison
    // the cache — the next call can succeed after env vars change.
    promise.catch(() => resolvedClients.delete(config));
  }
  return promise;
}
