import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  CreateSandboxOptions,
  FileEntry,
  CommandResult,
  RunCommandOptions,
  SandboxInfo as ComputeSandboxInfo,
} from '@computesdk/provider';


/**
 * First-party ComputeSDK provider: the hosted sandbox router at
 * platform.computesdk.com (`POST/GET/DELETE /api/v1/sandboxes[...]`).
 *
 * The user's ChatGPT bearer token IS their ComputeSDK API key — create passes
 * it through `spec.create({}, userToken)` so no credential vault round-trip is
 * needed.
 */

const DEFAULT_BASE_URL = 'https://platform.computesdk.com';
const API_PREFIX = '/api/v1';
const HTTP_TIMEOUT_MS = 30_000;
const CREATE_TIMEOUT_MS = 120_000;

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
  cost?: {
    rate?: { usd: number; per: string };
    runtimeSeconds?: number;
    costUsd?: number;
    settled?: boolean;
  };
}

interface GatewayContext {
  gw: GatewayAuth;
  summary: SandboxSummary;
}

class GatewayApiError extends Error {
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
      const message =
        (parsed as { error?: string } | undefined)?.error ??
        `Gateway request failed: ${method} ${path} → ${res.status}`;
      throw new GatewayApiError(
        res.status,
        message,
        (parsed as { details?: unknown } | undefined)?.details,
      );
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

async function execOrThrow(
  ctx: GatewayContext,
  command: string,
  label: string,
): Promise<CommandResult> {
  const out = await exec(ctx.gw, ctx.summary.id, command);
  if (out.exitCode !== 0) {
    throw new Error(`${label} failed (exit ${out.exitCode}): ${out.stderr || out.stdout}`);
  }
  return out;
}

export const computesdkGateway = defineProvider<GatewayContext, GatewayConfig>({
  name: 'computesdk',
  methods: {
    sandbox: {
      create: async (config: GatewayConfig, options?: CreateSandboxOptions) => {
        const gw = resolveAuth(config);
        const { sandbox } = await api<{ sandbox: SandboxSummary }>(
          gw,
          'POST',
          '/sandboxes',
          {
            label: options?.name ?? 'chatgpt-sandbox',
            ...(options?.timeout === undefined ? {} : { timeoutMs: options.timeout }),
            // Provider pin, e.g. metadata.providerOrder = ["namespace:us-east"]
            ...(options?.metadata?.providerOrder
              ? { providerOrder: options.metadata.providerOrder }
              : {}),
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
          status: s.status === 'destroyed' ? 'stopped' : s.destroyError ? 'error' : 'running',
          createdAt: new Date(s.createdAt),
          timeout: 0,
          metadata: {
            label: s.label,
            gatewayProvider: s.provider,
            providerSandboxId: s.providerSandboxId,
            commandCount: s.commandCount,
            costUsd: s.cost?.costUsd,
            runtimeSeconds: s.cost?.runtimeSeconds,
          },
        };
      },

      getUrl: async (): Promise<string> => {
        throw new Error(
          'The ComputeSDK gateway does not expose preview URLs yet — serve on a port and tunnel, or use run_command output.',
        );
      },

      filesystem: {
        readFile: async (ctx: GatewayContext, path: string): Promise<string> => {
          const resolved = await resolvePath(ctx, path);
          const out = await execOrThrow(
            ctx,
            `base64 -w0 ${escapeShellArg(resolved)} 2>/dev/null || base64 ${escapeShellArg(resolved)}`,
            `readFile ${path}`,
          );
          return Buffer.from(out.stdout.trim(), 'base64').toString('utf8');
        },

        writeFile: async (
          ctx: GatewayContext,
          path: string,
          content: string,
        ): Promise<void> => {
          const resolved = await resolvePath(ctx, path);
          const dir = resolved.slice(0, resolved.lastIndexOf('/')) || '.';
          const b64 = Buffer.from(content, 'utf8').toString('base64');
          await execOrThrow(
            ctx,
            `mkdir -p ${escapeShellArg(dir)} && echo ${escapeShellArg(b64)} | base64 -d > ${escapeShellArg(resolved)}`,
            `writeFile ${path}`,
          );
        },

        mkdir: async (ctx: GatewayContext, path: string): Promise<void> => {
          const resolved = await resolvePath(ctx, path);
          await execOrThrow(ctx, `mkdir -p ${escapeShellArg(resolved)}`, `mkdir ${path}`);
        },

        readdir: async (ctx: GatewayContext, path: string): Promise<FileEntry[]> => {
          const resolved = await resolvePath(ctx, path);
          const out = await execOrThrow(
            ctx,
            `cd ${escapeShellArg(resolved)} && for e in * .[!.]*; do [ -e "$e" ] || continue; if [ -d "$e" ]; then printf '%s\\td\\n' "$e"; else printf '%s\\tf\\n' "$e"; fi; done`,
            `readdir ${path}`,
          );
          return out.stdout
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => {
              const [name, kind] = l.split('\t');
              return { name, type: kind === 'd' ? ('directory' as const) : ('file' as const) };
            });
        },

        exists: async (ctx: GatewayContext, path: string): Promise<boolean> => {
          const resolved = await resolvePath(ctx, path);
          const out = await exec(ctx.gw, ctx.summary.id, `test -e ${escapeShellArg(resolved)}`);
          return out.exitCode === 0;
        },

        remove: async (ctx: GatewayContext, path: string): Promise<void> => {
          if (path.split('/').every((s) => s === '' || s === '.')) {
            throw new Error(`remove: refusing ambiguous path: ${JSON.stringify(path)}`);
          }
          const resolved = await resolvePath(ctx, path);
          await execOrThrow(ctx, `rm -rf ${escapeShellArg(resolved)}`, `remove ${path}`);
        },
      },

      getInstance: (ctx: GatewayContext): GatewayContext => ctx,
    },
  },
});

/** Resolve a possibly-relative path against the sandbox's home dir. */
async function resolvePath(ctx: GatewayContext, path: string): Promise<string> {
  if (path.startsWith('/')) return path;
  const out = await exec(ctx.gw, ctx.summary.id, 'pwd');
  const cwd = out.stdout.trim() || '/root';
  return `${cwd}/${path}`;
}
