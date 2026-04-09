/**
 * Tensorlake Provider - Factory-based Implementation
 *
 * Stateful MicroVM sandboxes for agentic applications and LLM-generated code execution.
 * Uses the Tensorlake REST API directly (no official JS SDK available).
 *
 * Sandbox management: https://api.tensorlake.ai
 * Sandbox proxy:      https://sandbox.tensorlake.ai (Host: {sandbox_id}.sandbox.tensorlake.ai)
 */

import { defineProvider, escapeShellArg } from '@computesdk/provider';
import type {
  Runtime,
  CodeResult,
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
} from '@computesdk/provider';

const DEFAULT_API_URL = 'https://api.tensorlake.ai';
const DEFAULT_PROXY_URL = 'https://sandbox.tensorlake.ai';
const DEFAULT_IMAGE = 'ubuntu-minimal';
const POLL_INTERVAL_MS = 500;
const SANDBOX_READY_TIMEOUT_MS = 120_000;

export interface TensorlakeConfig {
  /** Tensorlake API key — falls back to TENSORLAKE_API_KEY environment variable */
  apiKey?: string;
  /** Override for the management API base URL (default: https://api.tensorlake.ai) */
  apiUrl?: string;
  /** Override for the sandbox proxy URL (default: https://sandbox.tensorlake.ai) */
  proxyUrl?: string;
  /** Default container image for new sandboxes (default: python:3.11-slim) */
  image?: string;
  /** Default timeout in seconds for sandboxes */
  timeout?: number;
}

/** Internal representation passed between provider methods */
export interface TensorlakeSandboxContext {
  sandboxId: string;
  config: TensorlakeConfig;
}

// ---------------------------------------------------------------------------
// Internal HTTP helpers
// ---------------------------------------------------------------------------

function getApiKey(config: TensorlakeConfig): string {
  const key =
    config.apiKey ||
    (typeof process !== 'undefined' && process.env?.TENSORLAKE_API_KEY) ||
    '';
  if (!key) {
    throw new Error(
      `Missing Tensorlake API key. Provide 'apiKey' in config or set TENSORLAKE_API_KEY environment variable. ` +
        `Get your API key from https://app.tensorlake.ai`
    );
  }
  return key;
}

function apiUrl(config: TensorlakeConfig): string {
  return (
    config.apiUrl ||
    (typeof process !== 'undefined' && process.env?.TENSORLAKE_API_URL) ||
    DEFAULT_API_URL
  );
}

function proxyUrl(config: TensorlakeConfig): string {
  return (
    config.proxyUrl ||
    (typeof process !== 'undefined' && process.env?.TENSORLAKE_SANDBOX_PROXY_URL) ||
    DEFAULT_PROXY_URL
  );
}

function sandboxProxyBaseUrl(ctx: TensorlakeSandboxContext): string {
  const rawUrl = proxyUrl(ctx.config).replace(/\/$/, '');

  // If placeholder-based override exists, substitute sandbox ID.
  const templated = rawUrl.replace(/\{sandbox[_-]?id\}/gi, ctx.sandboxId);
  if (templated !== rawUrl) return templated;

  try {
    const url = new URL(rawUrl);
    if (url.hostname === 'sandbox.tensorlake.ai') {
      url.hostname = `${ctx.sandboxId}.sandbox.tensorlake.ai`;
      return url.toString().replace(/\/$/, '');
    }
    if (url.hostname === `${ctx.sandboxId}.sandbox.tensorlake.ai`) {
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    // invalid URL, proceed to fallback below
  }

  // fallback to per-sandbox URL
  return `https://${ctx.sandboxId}.sandbox.tensorlake.ai`;
}

/** Make a request to the management API */
async function managementRequest(
  config: TensorlakeConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const base = apiUrl(config).replace(/\/$/, '');
  const url = `${base}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getApiKey(config)}`,
    'Content-Type': 'application/json',
  };
  const resp = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return resp;
}

/** Make a request to a sandbox via the proxy */
async function proxyRequest(
  ctx: TensorlakeSandboxContext,
  method: string,
  path: string,
  body?: unknown,
  queryParams?: Record<string, string>
): Promise<Response> {
  const base = sandboxProxyBaseUrl(ctx);
  const qs =
    queryParams && Object.keys(queryParams).length > 0
      ? '?' + new URLSearchParams(queryParams).toString()
      : '';
  const url = `${base}${path}${qs}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getApiKey(ctx.config)}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return resp;
}

async function proxyRequestRaw(
  ctx: TensorlakeSandboxContext,
  method: string,
  path: string,
  rawBody: Uint8Array | string,
  queryParams?: Record<string, string>
): Promise<Response> {
  const base = sandboxProxyBaseUrl(ctx);
  const qs =
    queryParams && Object.keys(queryParams).length > 0
      ? '?' + new URLSearchParams(queryParams).toString()
      : '';
  const url = `${base}${path}${qs}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${getApiKey(ctx.config)}`,
      'Content-Type': 'application/octet-stream',
    },
    body: rawBody,
  });
  return resp;
}

async function requireOk(resp: Response, context: string): Promise<void> {
  if (!resp.ok) {
    let detail = '';
    try {
      detail = await resp.text();
    } catch {
      // ignore
    }
    throw new Error(`Tensorlake ${context} failed (HTTP ${resp.status}): ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Sandbox readiness polling
// ---------------------------------------------------------------------------

async function waitForRunning(
  config: TensorlakeConfig,
  sandboxId: string
): Promise<void> {
  const deadline = Date.now() + SANDBOX_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const resp = await managementRequest(config, 'GET', `/sandboxes/${sandboxId}`);
    if (!resp.ok) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    const info: { status: string; outcome?: string } = await resp.json();
    if (info.status === 'running') return;
    if (info.status === 'terminated' || info.status === 'suspended') {
      throw new Error(
        `Tensorlake sandbox ${sandboxId} entered unexpected status: ${info.status}` +
          (info.outcome ? ` (outcome: ${info.outcome})` : '')
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Tensorlake sandbox ${sandboxId} did not reach 'running' status within ${SANDBOX_READY_TIMEOUT_MS / 1000}s`
  );
}

// ---------------------------------------------------------------------------
// Process execution helpers
// ---------------------------------------------------------------------------

interface ProcessInfo {
  pid: number;
  status: string;
  exit_code?: number | null;
}

interface OutputResponse {
  lines: string[];
}

async function startProcess(
  ctx: TensorlakeSandboxContext,
  command: string,
  args: string[],
  env?: Record<string, string>,
  workingDir?: string
): Promise<ProcessInfo> {
  const payload: Record<string, unknown> = { command, args };
  if (env && Object.keys(env).length > 0) payload.env = env;
  if (workingDir) payload.working_dir = workingDir;

  const resp = await proxyRequest(ctx, 'POST', '/api/v1/processes', payload);
  await requireOk(resp, 'start_process');
  return resp.json();
}

async function pollProcess(
  ctx: TensorlakeSandboxContext,
  pid: number,
  timeoutMs?: number
): Promise<ProcessInfo> {
  const deadline = timeoutMs != null ? Date.now() + timeoutMs : Infinity;
  while (Date.now() < deadline) {
    const resp = await proxyRequest(ctx, 'GET', `/api/v1/processes/${pid}`);
    await requireOk(resp, `get_process(${pid})`);
    const info: ProcessInfo = await resp.json();
    if (info.status !== 'running') return info;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  // Kill on timeout
  await proxyRequest(ctx, 'DELETE', `/api/v1/processes/${pid}`);
  throw new Error(`Tensorlake process ${pid} timed out`);
}

async function getOutput(
  ctx: TensorlakeSandboxContext,
  pid: number,
  stream: 'stdout' | 'stderr'
): Promise<string> {
  const resp = await proxyRequest(ctx, 'GET', `/api/v1/processes/${pid}/${stream}`);
  if (!resp.ok) return '';
  const data: OutputResponse = await resp.json();
  return (data.lines || []).join('\n');
}

// ---------------------------------------------------------------------------
// Provider definition
// ---------------------------------------------------------------------------

export const tensorlake = defineProvider<TensorlakeSandboxContext, TensorlakeConfig>({
  name: 'tensorlake',
  methods: {
    sandbox: {
      create: async (
        config: TensorlakeConfig,
        options?: CreateSandboxOptions
      ) => {
        const image = config.image || DEFAULT_IMAGE;
        const timeoutSecs = options?.timeout
          ? Math.ceil(options.timeout / 1000)
          : config.timeout;

        const body: Record<string, unknown> = {
          image,
          resources: { cpus: 1, memory_mb: 1024, ephemeral_disk_mb: 2048 },
        };
        if (timeoutSecs) body.timeout_secs = timeoutSecs;
        if (options?.name) body.name = options.name;
        if (options?.snapshotId) body.snapshot_id = options.snapshotId;
        if (options?.metadata) body.metadata = options.metadata;

        let resp: Response;
        try {
          resp = await managementRequest(config, 'POST', '/sandboxes', body);
        } catch (error) {
          throw new Error(
            `Failed to connect to Tensorlake API: ${error instanceof Error ? error.message : String(error)}. ` +
              `Check your network connection and TENSORLAKE_API_KEY.`
          );
        }

        if (resp.status === 401 || resp.status === 403) {
          throw new Error(
            `Tensorlake authentication failed. Please check your TENSORLAKE_API_KEY. ` +
              `Get your API key from https://app.tensorlake.ai`
          );
        }
        await requireOk(resp, 'create sandbox');

        const created: { sandbox_id: string; status: string } = await resp.json();
        const sandboxId = created.sandbox_id;

        // Wait for the sandbox to be ready
        await waitForRunning(config, sandboxId);

        const ctx: TensorlakeSandboxContext = { sandboxId, config };
        return { sandbox: ctx, sandboxId };
      },

      getById: async (config: TensorlakeConfig, sandboxId: string) => {
        try {
          const resp = await managementRequest(config, 'GET', `/sandboxes/${sandboxId}`);
          if (!resp.ok) return null;
          const ctx: TensorlakeSandboxContext = { sandboxId, config };
          return { sandbox: ctx, sandboxId };
        } catch {
          return null;
        }
      },

      list: async (config: TensorlakeConfig) => {
        try {
          const resp = await managementRequest(config, 'GET', '/sandboxes');
          if (!resp.ok) return [];
          const data: { sandboxes: Array<{ sandbox_id: string }> } = await resp.json();
          return (data.sandboxes || []).map((s) => ({
            sandbox: { sandboxId: s.sandbox_id, config } as TensorlakeSandboxContext,
            sandboxId: s.sandbox_id,
          }));
        } catch {
          return [];
        }
      },

      destroy: async (config: TensorlakeConfig, sandboxId: string) => {
        try {
          await managementRequest(config, 'DELETE', `/sandboxes/${sandboxId}`);
        } catch {
          // Sandbox may already be terminated
        }
      },

      runCode: async (
        ctx: TensorlakeSandboxContext,
        code: string,
        runtime?: Runtime
      ): Promise<CodeResult> => {
        const effectiveRuntime =
          runtime ||
          (code.includes('print(') ||
          code.includes('import ') ||
          code.includes('def ') ||
          code.includes('sys.') ||
          code.includes('f"') ||
          code.includes("f'") ||
          code.includes('raise ')
            ? 'python'
            : 'node');

        let command: string;
        let args: string[];

        if (effectiveRuntime === 'python') {
          // Write to a temp file via base64 to handle special characters safely
          const encoded = Buffer.from(code).toString('base64');
          command = 'sh';
          args = ['-c', `echo "${encoded}" | base64 -d | python3`];
        } else {
          const encoded = Buffer.from(code).toString('base64');
          command = 'sh';
          args = ['-c', `echo "${encoded}" | base64 -d | node`];
        }

        try {
          const proc = await startProcess(ctx, command, args);
          const info = await pollProcess(ctx, proc.pid);
          const stdout = await getOutput(ctx, proc.pid, 'stdout');
          const stderr = await getOutput(ctx, proc.pid, 'stderr');

          const exitCode = info.exit_code ?? 0;

          if (
            exitCode !== 0 &&
            stderr &&
            (stderr.includes('SyntaxError') ||
              stderr.includes('invalid syntax') ||
              stderr.includes('Unexpected token') ||
              stderr.includes('Unexpected identifier'))
          ) {
            throw new Error(`Syntax error: ${stderr.trim()}`);
          }

          const output = stderr
            ? `${stdout}${stdout && stderr ? '\n' : ''}${stderr}`
            : stdout;

          return { output, exitCode, language: effectiveRuntime };
        } catch (error) {
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          throw new Error(
            `Tensorlake code execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (
        ctx: TensorlakeSandboxContext,
        command: string,
        options?: RunCommandOptions
      ): Promise<CommandResult> => {
        const startTime = Date.now();

        let fullCommand = command;
        const env: Record<string, string> = {};

        if (options?.env) {
          Object.assign(env, options.env);
        }

        // Wrap with cd for working directory support
        if (options?.cwd) {
          fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
        }

        if (options?.background) {
          fullCommand = `${fullCommand} > /dev/null 2>&1 &`;
        }

        try {
          const proc = await startProcess(
            ctx,
            'sh',
            ['-c', fullCommand],
            Object.keys(env).length > 0 ? env : undefined
          );
          const info = await pollProcess(
            ctx,
            proc.pid,
            options?.background ? 5_000 : undefined
          );
          const stdout = await getOutput(ctx, proc.pid, 'stdout');
          const stderr = await getOutput(ctx, proc.pid, 'stderr');

          return {
            stdout,
            stderr,
            exitCode: info.exit_code ?? 0,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 1,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (ctx: TensorlakeSandboxContext): Promise<SandboxInfo> => {
        try {
          const resp = await managementRequest(
            ctx.config,
            'GET',
            `/sandboxes/${ctx.sandboxId}`
          );
          if (resp.ok) {
            const data: {
              status: string;
              image?: string;
              timeout_secs?: number;
            } = await resp.json();
            return {
              id: ctx.sandboxId,
              provider: 'tensorlake',
              runtime: (data.image?.startsWith('python') ? 'python' : 'node') as Runtime,
              status: data.status === 'running' ? 'running' : 'stopped',
              createdAt: new Date(),
              timeout: data.timeout_secs != null ? data.timeout_secs * 1000 : 300000,
              metadata: { tensorlakeSandboxId: ctx.sandboxId },
            };
          }
        } catch {
          // Fall through to default
        }
        return {
          id: ctx.sandboxId,
          provider: 'tensorlake',
          runtime: 'python',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: { tensorlakeSandboxId: ctx.sandboxId },
        };
      },

      getUrl: async (
        ctx: TensorlakeSandboxContext,
        options: { port: number; protocol?: string }
      ): Promise<string> => {
        const protocol = options.protocol || 'https';
        return `${protocol}://${ctx.sandboxId}.sandbox.tensorlake.ai:${options.port}`;
      },

      filesystem: {
        readFile: async (ctx: TensorlakeSandboxContext, path: string): Promise<string> => {
          const resp = await proxyRequest(ctx, 'GET', '/api/v1/files', undefined, {
            path,
          });
          await requireOk(resp, `readFile(${path})`);
          const buf = await resp.arrayBuffer();
          return Buffer.from(buf).toString('utf-8');
        },

        writeFile: async (
          ctx: TensorlakeSandboxContext,
          path: string,
          content: string
        ): Promise<void> => {
          const body = Buffer.from(content, 'utf-8');
          const resp = await proxyRequestRaw(ctx, 'PUT', '/api/v1/files', body, {
            path,
          });
          await requireOk(resp, `writeFile(${path})`);
        },

        mkdir: async (ctx: TensorlakeSandboxContext, path: string): Promise<void> => {
          const proc = await startProcess(ctx, 'mkdir', ['-p', path]);
          const info = await pollProcess(ctx, proc.pid);
          if (info.exit_code !== 0) {
            const stderr = await getOutput(ctx, proc.pid, 'stderr');
            throw new Error(`Failed to create directory ${path}: ${stderr}`);
          }
        },

        readdir: async (
          ctx: TensorlakeSandboxContext,
          path: string
        ): Promise<FileEntry[]> => {
          const resp = await proxyRequest(ctx, 'GET', '/api/v1/files/list', undefined, {
            path,
          });
          await requireOk(resp, `readdir(${path})`);
          const data: {
            entries: Array<{ name: string; is_dir: boolean; size?: number; modified_at?: string }>;
          } = await resp.json();
          return (data.entries || []).map((e) => ({
            name: e.name,
            type: e.is_dir ? ('directory' as const) : ('file' as const),
            size: e.size || 0,
            modified: e.modified_at ? new Date(e.modified_at) : new Date(),
          }));
        },

        exists: async (ctx: TensorlakeSandboxContext, path: string): Promise<boolean> => {
          const resp = await proxyRequest(ctx, 'GET', '/api/v1/files', undefined, {
            path,
          });

          if (resp.ok) return true;
          if (resp.status === 404) return false;

          // Some implementations may return non-OK for directory path; try list endpoint then.
          try {
            const dirResp = await proxyRequest(ctx, 'GET', '/api/v1/files/list', undefined, {
              path,
            });
            if (dirResp.ok) return true;
            if (dirResp.status === 404) return false;
          } catch {
            // ignore and continue
          }

          return false;
        },

        remove: async (ctx: TensorlakeSandboxContext, path: string): Promise<void> => {
          const resp = await proxyRequest(ctx, 'DELETE', '/api/v1/files', undefined, {
            path,
          });
          await requireOk(resp, `remove(${path})`);
        },
      },

      getInstance: (ctx: TensorlakeSandboxContext): TensorlakeSandboxContext => ctx,
    },

    snapshot: {
      create: async (
        config: TensorlakeConfig,
        sandboxId: string,
        options?: { name?: string }
      ) => {
        const resp = await managementRequest(
          config,
          'POST',
          `/sandboxes/${sandboxId}/snapshot`
        );
        await requireOk(resp, 'snapshot.create');
        const data: { snapshot_id: string } = await resp.json();
        return {
          id: data.snapshot_id,
          provider: 'tensorlake',
          createdAt: new Date(),
          metadata: { name: options?.name },
        };
      },

      list: async (config: TensorlakeConfig) => {
        try {
          const resp = await managementRequest(config, 'GET', '/snapshots');
          if (!resp.ok) return [];
          const data: { snapshots?: unknown[] } = await resp.json();
          return data.snapshots || [];
        } catch {
          return [];
        }
      },

      delete: async (config: TensorlakeConfig, snapshotId: string) => {
        try {
          await managementRequest(config, 'DELETE', `/snapshots/${snapshotId}`);
        } catch {
          // Ignore
        }
      },
    },
  },
});

export type { TensorlakeSandboxContext as TensorlakeSandbox };
