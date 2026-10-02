import { defineProvider } from '@computesdk/provider';
import type {
  CreateSandboxOptions,
  FileEntry,
  CommandResult,
  RunCommandOptions,
  SandboxInfo as ComputeSandboxInfo,
} from '@computesdk/provider';

/**
 * First-party ComputeSDK provider: the hosted sandbox router at
 * platform.computesdk.com (`/api/v1/sandboxes[...]`).
 *
 * The user's ChatGPT bearer token IS their ComputeSDK API key — create passes
 * it through `spec.create({}, userToken)` so no credential vault round-trip is
 * needed.
 */

const DEFAULT_BASE_URL = 'https://platform.computesdk.com';
const API_PREFIX = '/api/v1';
const HTTP_TIMEOUT_MS = 30_000;
const CREATE_TIMEOUT_MS = 120_000;

// Mirrors the platform's limits (lib/sandboxes/router.ts + route validation).
const MAX_COMMAND_BYTES = 64 * 1024;
const MAX_COMMAND_TIMEOUT_MS = 290_000;
const MAX_FILE_CONTENT_BYTES = 32 * 1024 * 1024;
const MAX_SANDBOX_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export interface GatewayConfig {
  apiKey?: string;
  baseUrl?: string;
}

interface GatewayAuth {
  apiKey: string;
  baseUrl: string;
}

interface SandboxSummary {
  id: string;
  label: string | null;
  provider: string;
  providerSandboxId?: string | null;
  status: 'creating' | 'running' | 'destroyed';
  commandCount: number;
  createdAt: string;
  destroyedAt: string | null;
  destroyError: string | null;
  attach?: {
    provider: string;
    providerSandboxId: string;
    region: string | null;
  } | null;
  cost?: {
    rate?: { usd: number; per: string };
    runtimeSeconds?: number;
    costUsd?: number;
    settled?: boolean;
  };
}

export interface GatewayProcess {
  jobId: string;
  pid: number | null;
  command: string;
  status: 'running' | 'exited' | string;
  exitCode: number | null;
  signal: string | null;
  startedAt?: string;
  exitedAt?: string | null;
}

export interface GatewayProcessStatus extends GatewayProcess {
  stdout: string;
  stderr: string;
}

type PathView =
  | { path: string; type: 'file'; content: string }
  | { path: string; type: 'directory'; entries: FileEntry[] };

interface GatewayContext {
  gw: GatewayAuth;
  summary: SandboxSummary;
}

export class GatewayApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'GatewayApiError';
  }
}

function resolveAuth(config: GatewayConfig): GatewayAuth {
  const apiKey = config.apiKey?.trim() || process.env.COMPUTESDK_API_KEY?.trim() || '';
  if (!apiKey) {
    throw new Error(
      'Missing ComputeSDK API key. The plugin passes your key as the bearer token; a deployment can also set COMPUTESDK_API_KEY.',
    );
  }
  const baseUrl = (
    config.baseUrl?.trim() ||
    process.env.COMPUTESDK_BASE_URL?.trim() ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

async function api<T>(
  gw: GatewayAuth,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${gw.baseUrl}${API_PREFIX}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${gw.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      // non-JSON body
    }
    if (!res.ok) {
      const details = (parsed as { details?: unknown } | undefined)?.details;
      let message =
        (parsed as { error?: string } | undefined)?.error ??
        `Gateway request failed: ${method} ${path} → ${res.status}`;
      // Placement/flag failures carry machine-readable detail worth showing
      // the model (e.g. a 502's per-provider `attempts`, a 403's flag gate).
      if (details !== undefined) {
        const rendered = JSON.stringify(details);
        if (rendered.length <= 2_000) message = `${message} — ${rendered}`;
      }
      throw new GatewayApiError(res.status, message, details);
    }
    return parsed as T;
  } finally {
    clearTimeout(timer);
  }
}

async function exec(
  gw: GatewayAuth,
  sandboxId: string,
  command: string,
  timeoutMs?: number,
): Promise<CommandResult> {
  if (Buffer.byteLength(command, 'utf8') > MAX_COMMAND_BYTES) {
    throw new Error(`command exceeds the gateway's ${MAX_COMMAND_BYTES}-byte limit`);
  }
  if (timeoutMs !== undefined && timeoutMs > MAX_COMMAND_TIMEOUT_MS) {
    throw new Error(
      `command timeout exceeds the gateway's ${MAX_COMMAND_TIMEOUT_MS / 1000}s cap`,
    );
  }
  const startTime = Date.now();
  const result = await api<{
    commandId: string;
    exitCode: number;
    durationMs: number;
    stdout: string;
    stderr: string;
  }>(
    gw,
    'POST',
    `/sandboxes/${sandboxId}/commands`,
    { command, ...(timeoutMs === undefined ? {} : { timeoutMs }) },
    (timeoutMs ?? HTTP_TIMEOUT_MS) + HTTP_TIMEOUT_MS,
  );
  return { ...result, durationMs: result.durationMs ?? Date.now() - startTime };
}

/** Resolve a possibly-relative path against the sandbox's home dir. */
async function resolvePath(ctx: GatewayContext, path: string): Promise<string> {
  if (path.startsWith('/')) return path;
  const out = await exec(ctx.gw, ctx.summary.id, 'pwd');
  const cwd = out.stdout.trim() || '/root';
  return `${cwd}/${path}`;
}

async function readPath(ctx: GatewayContext, path: string): Promise<PathView> {
  const resolved = await resolvePath(ctx, path);
  return api<PathView>(
    ctx.gw,
    'GET',
    `/sandboxes/${ctx.summary.id}/files?path=${encodeURIComponent(resolved)}`,
  );
}

/**
 * Gateway endpoints used by plugin tools directly (detached processes and
 * org routing settings) — these have no Provider-level framework analogue.
 */
export function gatewayClient(config: GatewayConfig) {
  const gw = resolveAuth(config);
  const base = (sandboxId: string) => `/sandboxes/${sandboxId}/processes`;
  return {
    startProcess: (
      sandboxId: string,
      input: {
        command: string;
        cwd?: string;
        env?: Record<string, string>;
      },
    ) =>
      api<{ process: GatewayProcess }>(gw, 'POST', base(sandboxId), input).then(
        (r) => r.process,
      ),
    listProcesses: (sandboxId: string) =>
      api<{ processes: GatewayProcess[] }>(gw, 'GET', base(sandboxId)).then(
        (r) => r.processes,
      ),
    getProcess: (sandboxId: string, jobId: string) =>
      api<{ process: GatewayProcessStatus }>(
        gw,
        'GET',
        `${base(sandboxId)}/${jobId}`,
      ).then((r) => r.process),
    waitProcess: (sandboxId: string, jobId: string, timeoutMs?: number) =>
      api<{ process: GatewayProcessStatus }>(
        gw,
        'POST',
        `${base(sandboxId)}/${jobId}/wait`,
        timeoutMs === undefined ? {} : { timeoutMs },
        HTTP_TIMEOUT_MS + (timeoutMs ?? 0),
      ).then((r) => r.process),
    killProcess: (sandboxId: string, jobId: string, signal?: string) =>
      api<{ process: GatewayProcessStatus }>(
        gw,
        'POST',
        `${base(sandboxId)}/${jobId}/kill`,
        signal === undefined ? {} : { signal },
      ).then((r) => r.process),
    /** Sandbox-lane routing settings (provider order, market cap, sizes). */
    getSettings: () =>
      api<Record<string, unknown>>(gw, 'GET', '/sandboxes/settings'),
  };
}

export const computesdkGateway = defineProvider<GatewayContext, GatewayConfig>({
  name: 'computesdk',
  methods: {
    sandbox: {
      create: async (config: GatewayConfig, options?: CreateSandboxOptions) => {
        const gw = resolveAuth(config);
        const meta = options?.metadata ?? {};
        const timeoutMs =
          options?.timeout === undefined
            ? undefined
            : Math.min(options.timeout, MAX_SANDBOX_TIMEOUT_MS);
        const { sandbox } = await api<{ sandbox: SandboxSummary }>(
          gw,
          'POST',
          '/sandboxes',
          {
            label: options?.name ?? 'chatgpt-plugin',
            ...(timeoutMs === undefined ? {} : { timeoutMs }),
            // Provider pin, e.g. metadata.providerOrder = ["namespace:us-east"]
            // or ["market"] to force market fills.
            ...(meta.providerOrder ? { providerOrder: meta.providerOrder } : {}),
            ...(options?.image ?? options?.templateId
              ? { image: options.image ?? options.templateId }
              : {}),
            ...(options?.snapshotId ? { snapshotId: options.snapshotId } : {}),
            // { cpus, memoryMb, ephemeralDiskMb }
            ...(meta.resources ? { resources: meta.resources } : {}),
            // Org vault secret names — injected into the process env.
            ...(Array.isArray(meta.secrets) ? { secrets: meta.secrets } : {}),
          },
          CREATE_TIMEOUT_MS,
        );
        const ctx: GatewayContext = { gw, summary: sandbox };
        return { sandbox: ctx, sandboxId: sandbox.id };
      },

      getById: async (config: GatewayConfig, sandboxId: string) => {
        const gw = resolveAuth(config);
        try {
          const { sandbox } = await api<{ sandbox: SandboxSummary }>(
            gw,
            'GET',
            `/sandboxes/${sandboxId}`,
          );
          return { sandbox: { gw, summary: sandbox }, sandboxId: sandbox.id };
        } catch (e) {
          if (e instanceof GatewayApiError && e.status === 404) return null;
          throw e;
        }
      },

      list: async (config: GatewayConfig) => {
        const gw = resolveAuth(config);
        const all: GatewayContext[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 10; page++) {
          const qs = new URLSearchParams({ limit: '100' });
          if (cursor) qs.set('cursor', cursor);
          const res = await api<{ sandboxes: SandboxSummary[]; nextCursor: string | null }>(
            gw,
            'GET',
            `/sandboxes?${qs.toString()}`,
          );
          for (const summary of res.sandboxes) all.push({ gw, summary });
          if (!res.nextCursor) break;
          cursor = res.nextCursor;
        }
        return all.map((ctx) => ({ sandbox: ctx, sandboxId: ctx.summary.id }));
      },

      destroy: async (config: GatewayConfig, sandboxId: string) => {
        const gw = resolveAuth(config);
        await api(gw, 'DELETE', `/sandboxes/${sandboxId}`);
      },

      runCommand: async (
        ctx: GatewayContext,
        command: string,
        options?: RunCommandOptions,
      ): Promise<CommandResult> => {
        const result = await exec(ctx.gw, ctx.summary.id, command, options?.timeout);
        options?.onStdout?.(result.stdout);
        options?.onStderr?.(result.stderr);
        return result;
      },

      getInfo: async (ctx: GatewayContext): Promise<ComputeSandboxInfo> => {
        let s = ctx.summary;
        try {
          const fresh = await api<{ sandbox: SandboxSummary }>(
            ctx.gw,
            'GET',
            `/sandboxes/${s.id}`,
          );
          s = fresh.sandbox;
        } catch {
          // fall through to the snapshot we have
        }
        return {
          id: s.id,
          provider: 'computesdk',
          // 'creating' has no SandboxInfo counterpart — surface the raw
          // gateway status in metadata so callers can see placement state.
          status: s.status === 'destroyed' ? 'stopped' : s.destroyError ? 'error' : 'running',
          createdAt: new Date(s.createdAt),
          timeout: 0,
          metadata: {
            label: s.label,
            gatewayStatus: s.status,
            gatewayProvider: s.provider,
            providerSandboxId: s.providerSandboxId,
            attach: s.attach ?? null,
            commandCount: s.commandCount,
            costUsd: s.cost?.costUsd,
            runtimeSeconds: s.cost?.runtimeSeconds,
          },
        };
      },

      getUrl: async (
        ctx: GatewayContext,
        options: { port: number; protocol?: string },
      ): Promise<string> => {
        const qs = new URLSearchParams({ port: String(options.port) });
        if (options.protocol) qs.set('protocol', options.protocol);
        const res = await api<{ url: string }>(
          ctx.gw,
          'GET',
          `/sandboxes/${ctx.summary.id}/urls?${qs.toString()}`,
        );
        return res.url;
      },

      filesystem: {
        readFile: async (ctx: GatewayContext, path: string): Promise<string> => {
          const view = await readPath(ctx, path);
          if (view.type !== 'file') {
            throw new Error(`readFile: ${path} is a directory`);
          }
          return view.content;
        },

        writeFile: async (
          ctx: GatewayContext,
          path: string,
          content: string,
        ): Promise<void> => {
          if (Buffer.byteLength(content, 'utf8') > MAX_FILE_CONTENT_BYTES) {
            throw new Error(`content exceeds the gateway's 32MB limit`);
          }
          const resolved = await resolvePath(ctx, path);
          await api(ctx.gw, 'POST', `/sandboxes/${ctx.summary.id}/files`, {
            path: resolved,
            content,
          });
        },

        mkdir: async (ctx: GatewayContext, path: string): Promise<void> => {
          const resolved = await resolvePath(ctx, path);
          await api(ctx.gw, 'POST', `/sandboxes/${ctx.summary.id}/files`, {
            path: resolved,
            mkdir: true,
          });
        },

        readdir: async (ctx: GatewayContext, path: string): Promise<FileEntry[]> => {
          const view = await readPath(ctx, path);
          if (view.type !== 'directory') {
            throw new Error(`readdir: ${path} is a file`);
          }
          return view.entries;
        },

        exists: async (ctx: GatewayContext, path: string): Promise<boolean> => {
          try {
            await readPath(ctx, path);
            return true;
          } catch (e) {
            if (e instanceof GatewayApiError && e.status === 404) return false;
            throw e;
          }
        },

        remove: async (ctx: GatewayContext, path: string): Promise<void> => {
          const resolved = await resolvePath(ctx, path);
          await api(
            ctx.gw,
            'DELETE',
            `/sandboxes/${ctx.summary.id}/files?path=${encodeURIComponent(resolved)}`,
          );
        },
      },

      getInstance: (ctx: GatewayContext): GatewayContext => ctx,
    },
  },
});
