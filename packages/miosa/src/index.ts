/**
 * MIOSA Provider for ComputeSDK
 *
 * Wraps the MIOSA public sandbox API (https://api.miosa.ai/api/v1) behind
 * ComputeSDK's `defineProvider` framework. Sandboxes are Firecracker microVMs
 * that can graduate to persistent desktops, custom domains, and off-host
 * backups under your own brand.
 *
 * Auth: MIOSA API keys (`msk_*`) via `Authorization: Bearer <key>`.
 */

import { defineProvider, escapeShellArg } from "@computesdk/provider";

import type {
  CommandResult,
  SandboxInfo,
  CreateSandboxOptions,
  CreateSnapshotOptions,
  FileEntry,
  RunCommandOptions,
} from "@computesdk/provider";

// ── Config ──────────────────────────────────────────────────────────────────

export interface MiosaConfig {
  /** MIOSA API key (msk_*). Falls back to the MIOSA_API_KEY environment variable. */
  apiKey?: string;
  /** API base URL. Defaults to https://api.miosa.ai/api/v1 (override for white-label control planes). */
  baseUrl?: string;
  /** Default sandbox lifetime in milliseconds (maps to MIOSA timeout_sec). */
  timeout?: number;
}

// ── MIOSA API response shapes (subset the adapter consumes) ────────────────

/** Sandbox record as rendered by MIOSA's SandboxView. */
export interface MiosaSandboxRecord {
  id: string;
  slug: string;
  name: string | null;
  state: string;
  template_id: string | null;
  cpu_count: number | null;
  memory_mb: number | null;
  timeout_sec: number | null;
  metadata: Record<string, unknown> | null;
  preview_url: string | null;
  preview_domain: string | null;
  created_at: string;
  [key: string]: unknown;
}

interface MiosaExecResult {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  [key: string]: unknown;
}

interface MiosaFileListEntry {
  name: string;
  type: string;
  size_bytes?: number;
  modified_at?: string | null;
}

export interface MiosaSnapshotRecord {
  id: string;
  sandbox_id: string;
  status: string;
  comment: string | null;
  created_at: string;
  [key: string]: unknown;
}

/**
 * The native sandbox handle carried through ComputeSDK: the MIOSA sandbox
 * record plus the resolved client settings needed for instance operations.
 */
export interface MiosaSandbox {
  record: MiosaSandboxRecord;
  apiKey: string;
  baseUrl: string;
}

// ── HTTP client ─────────────────────────────────────────────────────────────

export const DEFAULT_BASE_URL = "https://api.miosa.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 300_000;

interface MiosaHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

// A bounded HTTP/2 pool prevents 100 independent TLS handshakes without
// serializing the complete burst behind one connection. Production sweeps
// found 16 sessions to be the best balance for the public endpoint. Keep the
// override private to the transport so operators can reproduce runner-specific
// measurements without changing the ComputeSDK create contract.
const HTTP2_SESSION_COUNT = (() => {
  const configured = Number.parseInt(
    (typeof process !== "undefined"
      ? process.env.MIOSA_HTTP2_SESSION_COUNT
      : undefined) ?? "16",
    10,
  );

  return Number.isFinite(configured)
    ? Math.min(64, Math.max(1, configured))
    : 16;
})();

interface Http2SessionPool {
  sessions: import("node:http2").ClientHttp2Session[];
  next: number;
}

const http2SessionPools = new Map<string, Http2SessionPool>();

class MiosaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "MiosaApiError";
  }
}

function canUseNodeHttp2(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    typeof process !== "undefined" &&
    Boolean(process.versions?.node) &&
    process.env?.NODE_ENV !== "test"
  );
}

async function ensureHttp2Sessions(origin: string): Promise<Http2SessionPool> {
  const http2 = await import("node:http2");
  const pool = http2SessionPools.get(origin) ?? { sessions: [], next: 0 };
  pool.sessions = pool.sessions.filter(
    (candidate) => !candidate.closed && !candidate.destroyed,
  );
  http2SessionPools.set(origin, pool);

  while (pool.sessions.length < HTTP2_SESSION_COUNT) {
    const session = http2.connect(origin);
    pool.sessions.push(session);

    const discard = () => {
      pool.sessions = pool.sessions.filter(
        (candidate) => candidate !== session,
      );
    };
    session.once("close", discard);
    session.once("error", discard);
    session.once("goaway", discard);
  }

  return pool;
}

function preconnectMiosa(config: MiosaConfig): void {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const url = new URL(baseUrl);

  if (canUseNodeHttp2(url)) {
    void ensureHttp2Sessions(url.origin).catch(() => undefined);
  }
}

async function nodeHttp2Request(
  url: URL,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  headers: Record<string, string>,
  body?: string,
): Promise<MiosaHttpResponse> {
  const origin = url.origin;
  const pool = await ensureHttp2Sessions(origin);

  const session = pool.sessions[pool.next % pool.sessions.length]!;
  pool.next = (pool.next + 1) % pool.sessions.length;

  return new Promise((resolve, reject) => {
    let status = 0;
    const chunks: Buffer[] = [];
    const request = session.request({
      ":method": method,
      ":path": `${url.pathname}${url.search}`,
      ...headers,
      ...(body === undefined
        ? {}
        : { "content-length": Buffer.byteLength(body).toString() }),
    });

    request.on("response", (responseHeaders) => {
      status = Number(responseHeaders[":status"] ?? 0);
    });
    request.on("data", (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
    });
    request.once("error", reject);
    request.once("end", () => {
      const responseBody = Buffer.concat(chunks).toString("utf8");
      resolve({
        ok: status >= 200 && status < 300,
        status,
        text: async () => responseBody,
      });
    });
    request.end(body);
  });
}

async function sendMiosaRequest(
  url: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  headers: Record<string, string>,
  body?: string,
): Promise<MiosaHttpResponse> {
  const parsedUrl = new URL(url);
  if (canUseNodeHttp2(parsedUrl)) {
    return nodeHttp2Request(parsedUrl, method, headers, body);
  }

  return fetch(url, { method, headers, body });
}

function resolveAuth(config: MiosaConfig): { apiKey: string; baseUrl: string } {
  const apiKey =
    config.apiKey ??
    (typeof process !== "undefined" ? process.env?.MIOSA_API_KEY : undefined) ??
    "";

  if (!apiKey) {
    throw new Error(
      `Missing MIOSA API key. Provide 'apiKey' in config or set MIOSA_API_KEY environment variable.`,
    );
  }
  if (!apiKey.startsWith("msk_")) {
    throw new Error(
      `Invalid MIOSA API key format. MIOSA API keys start with 'msk_'.`,
    );
  }

  return {
    apiKey,
    baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
  };
}

async function miosaRequest<T>(
  auth: { apiKey: string; baseUrl: string },
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const headers = {
    authorization: `Bearer ${auth.apiKey}`,
    "content-type": "application/json",
  };
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  const response = await sendMiosaRequest(
    `${auth.baseUrl}${path}`,
    method,
    headers,
    requestBody,
  );

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
  }

  if (!response.ok) {
    const errorBody = parsed as
      | {
          code?: string;
          message?: string;
          error?: string | { code?: string; message?: string; details?: unknown };
        }
      | undefined;
    const nestedError =
      typeof errorBody?.error === "object" ? errorBody.error : undefined;
    const code = nestedError?.code ?? errorBody?.code;
    const message =
      nestedError?.message ??
      errorBody?.message ??
      (typeof errorBody?.error === "string" ? errorBody.error : undefined);
    const details = nestedError?.details;
    throw new MiosaApiError(
      `MIOSA API ${method} ${path} failed with ${response.status}${code ? ` (${code})` : ""}${
        message ? `: ${message}` : ""
      }${details === undefined ? "" : `: ${JSON.stringify(details)}`}`,
      response.status,
      code,
    );
  }

  return parsed as T;
}

function unwrapSandbox(payload: unknown): MiosaSandboxRecord {
  const asRecord = payload as {
    data?: MiosaSandboxRecord;
  } & MiosaSandboxRecord;
  return asRecord.data &&
    typeof asRecord.data === "object" &&
    "id" in asRecord.data
    ? asRecord.data
    : asRecord;
}

function toMs(timeoutSec: number | null | undefined): number {
  return typeof timeoutSec === "number"
    ? timeoutSec * 1000
    : DEFAULT_TIMEOUT_MS;
}

function toStatus(state: string): SandboxInfo["status"] {
  switch (state) {
    case "running":
    case "starting":
    case "creating":
    case "pending":
      return "running";
    case "error":
      return "error";
    default:
      return "stopped";
  }
}

async function execInSandbox(
  sandbox: MiosaSandbox,
  command: string,
  options?: RunCommandOptions,
): Promise<CommandResult> {
  const startTime = Date.now();

  let fullCommand = command;
  if (options?.background) {
    fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
  }

  const body: Record<string, unknown> = { command: fullCommand };
  // The public API intentionally caps a single synchronous readiness wait at
  // 120 seconds. A sandbox lifetime can be much longer than that, so never use
  // the full lifetime as the wait parameter.
  const readinessTimeoutMs = Math.min(
    options?.timeout ?? toMs(sandbox.record.timeout_sec),
    120_000,
  );
  body.wait = true;
  body.wait_timeout_ms = readinessTimeoutMs;
  if (options?.cwd !== undefined) body.cwd = options.cwd;
  if (options?.env !== undefined) body.env = options.env;
  if (options?.timeout !== undefined)
    body.timeout = Math.ceil(options.timeout / 1000);

  try {
    const response = await miosaRequest<{ data: MiosaExecResult }>(
      sandbox,
      "POST",
      `/sandboxes/${sandbox.record.id}/exec`,
      body,
    );
    const result = response.data ?? {};
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exit_code ?? 0,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: 127,
      durationMs: Date.now() - startTime,
    };
  }
}

// ── Provider ────────────────────────────────────────────────────────────────

const createMiosaProvider = defineProvider<
  MiosaSandbox,
  MiosaConfig,
  never,
  MiosaSnapshotRecord
>({
  name: "miosa",
  methods: {
    sandbox: {
      create: async (config: MiosaConfig, options?: CreateSandboxOptions) => {
        const auth = resolveAuth(config);
        const timeoutMs =
          options?.timeout ?? config.timeout ?? DEFAULT_TIMEOUT_MS;

        const body: Record<string, unknown> = {
          // ComputeSDK defines create() as returning a command-ready sandbox.
          // Keep the readiness wait inside the create request so a 100-way
          // burst does not immediately create a second 100-way waiter burst.
          wait: true,
          response_format: "compact",
          // ComputeSDK sandboxes are ephemeral by contract: benchmark and SDK
          // callers create, execute, then destroy. Keeping MIOSA's product
          // default of persistent=true would checkpoint throwaway VMs and race
          // teardown, adding latency and leaving unnecessary storage behind.
          persistent: false,
          timeout_sec: Math.ceil(timeoutMs / 1000),
        };
        if (options?.templateId !== undefined)
          body.template_id = options.templateId;
        if (options?.snapshotId !== undefined)
          body.snapshot_id = options.snapshotId;
        if (options?.name !== undefined) body.name = options.name;
        if (options?.envs !== undefined) body.env = options.envs;
        if (options?.metadata !== undefined) body.metadata = options.metadata;

        const payload = await miosaRequest<unknown>(
          auth,
          "POST",
          "/sandboxes",
          body,
        );
        const record = unwrapSandbox(payload);
        if (!record.id) {
          throw new Error(
            "MIOSA create sandbox returned a record without an id",
          );
        }

        return { sandbox: { record, ...auth }, sandboxId: record.id };
      },

      getById: async (config: MiosaConfig, sandboxId: string) => {
        const auth = resolveAuth(config);
        try {
          const payload = await miosaRequest<unknown>(
            auth,
            "GET",
            `/sandboxes/${sandboxId}`,
          );
          const record = unwrapSandbox(payload);
          return { sandbox: { record, ...auth }, sandboxId: record.id };
        } catch (error) {
          if (error instanceof MiosaApiError && error.status === 404)
            return null;
          throw error;
        }
      },

      list: async (config: MiosaConfig) => {
        const auth = resolveAuth(config);
        const payload = await miosaRequest<{ data: MiosaSandboxRecord[] }>(
          auth,
          "GET",
          "/sandboxes",
        );
        return (payload.data ?? []).map((record) => ({
          sandbox: { record, ...auth },
          sandboxId: record.id,
        }));
      },

      destroy: async (config: MiosaConfig, sandboxId: string) => {
        const auth = resolveAuth(config);
        try {
          await miosaRequest<unknown>(
            auth,
            "DELETE",
            `/sandboxes/${sandboxId}`,
          );
        } catch (error) {
          // Destroying an already-destroyed sandbox is a no-op.
          if (error instanceof MiosaApiError && error.status === 404) return;
          throw error;
        }
      },

      runCommand: execInSandbox,

      getInfo: async (sandbox: MiosaSandbox): Promise<SandboxInfo> => {
        const record = sandbox.record;
        return {
          id: record.id,
          provider: "miosa",
          status: toStatus(record.state),
          createdAt: new Date(record.created_at),
          timeout: toMs(record.timeout_sec),
          metadata: {
            slug: record.slug,
            templateId: record.template_id,
            previewUrl: record.preview_url,
            previewDomain: record.preview_domain,
            ...(record.metadata ?? {}),
          },
        };
      },

      getUrl: async (
        sandbox: MiosaSandbox,
        options: { port: number; protocol?: string },
      ): Promise<string> => {
        // POST /sandboxes/:id/expose provisions a per-port preview URL on the
        // tenant's (white-label aware) preview domain. Never build the domain
        // client-side because the server resolves it per tenant.
        const response = await miosaRequest<{ url: string }>(
          sandbox,
          "POST",
          `/sandboxes/${sandbox.record.id}/expose`,
          { port: options.port },
        );
        if (!response.url) {
          throw new Error(
            `MIOSA expose returned no URL for port ${options.port} on sandbox ${sandbox.record.id}`,
          );
        }
        if (options.protocol) {
          return response.url.replace(
            /^[a-z+]+:\/\//,
            `${options.protocol}://`,
          );
        }
        return response.url;
      },

      getInstance: (sandbox: MiosaSandbox): MiosaSandbox => sandbox,

      filesystem: {
        // Native: GET /sandboxes/:id/fs/read?path=…  → { path, content }
        readFile: async (
          sandbox: MiosaSandbox,
          path: string,
        ): Promise<string> => {
          const response = await miosaRequest<{ content: string }>(
            sandbox,
            "GET",
            `/sandboxes/${sandbox.record.id}/fs/read?path=${encodeURIComponent(path)}`,
          );
          return response.content;
        },

        // Native: POST /sandboxes/:id/fs/write  { path, content }
        writeFile: async (
          sandbox: MiosaSandbox,
          path: string,
          content: string,
        ): Promise<void> => {
          await miosaRequest<unknown>(
            sandbox,
            "POST",
            `/sandboxes/${sandbox.record.id}/fs/write`,
            {
              path,
              content,
            },
          );
        },

        // Native: POST /sandboxes/:id/fs/mkdir  { path, recursive }
        mkdir: async (sandbox: MiosaSandbox, path: string): Promise<void> => {
          await miosaRequest<unknown>(
            sandbox,
            "POST",
            `/sandboxes/${sandbox.record.id}/fs/mkdir`,
            {
              path,
              recursive: true,
            },
          );
        },

        // Native: GET /sandboxes/:id/fs?path=…  → { files: [{name, type, size_bytes, modified_at}] }
        readdir: async (
          sandbox: MiosaSandbox,
          path: string,
        ): Promise<FileEntry[]> => {
          const response = await miosaRequest<{ files: MiosaFileListEntry[] }>(
            sandbox,
            "GET",
            `/sandboxes/${sandbox.record.id}/fs?path=${encodeURIComponent(path)}`,
          );
          return (response.files ?? []).map((entry) => ({
            name: entry.name,
            type:
              entry.type === "directory"
                ? ("directory" as const)
                : ("file" as const),
            size: entry.size_bytes ?? 0,
            modified: entry.modified_at
              ? new Date(entry.modified_at)
              : new Date(0),
          }));
        },

        // Composed from exec: MIOSA has no boolean exists endpoint (fs/stat
        // 404s on miss, but 502/agent errors are ambiguous), so `test -e` is exact.
        exists: async (
          sandbox: MiosaSandbox,
          path: string,
          runCommand: (
            sandbox: MiosaSandbox,
            command: string,
            options?: RunCommandOptions,
          ) => Promise<CommandResult>,
        ): Promise<boolean> => {
          const result = await runCommand(
            sandbox,
            `test -e "${escapeShellArg(path)}"`,
          );
          return result.exitCode === 0;
        },

        // Native: DELETE /sandboxes/:id/fs?path=…  (recursive on the server side)
        remove: async (sandbox: MiosaSandbox, path: string): Promise<void> => {
          await miosaRequest<unknown>(
            sandbox,
            "DELETE",
            `/sandboxes/${sandbox.record.id}/fs?path=${encodeURIComponent(path)}`,
          );
        },
      },
    },

    snapshot: {
      // Native Firecracker checkpoints: POST /sandboxes/:id/snapshots
      create: async (
        config: MiosaConfig,
        sandboxId: string,
        options?: CreateSnapshotOptions,
      ): Promise<MiosaSnapshotRecord> => {
        const auth = resolveAuth(config);
        const body: Record<string, unknown> = {};
        if (options?.name !== undefined) body.comment = options.name;
        const response = await miosaRequest<
          { data?: MiosaSnapshotRecord } & MiosaSnapshotRecord
        >(auth, "POST", `/sandboxes/${sandboxId}/snapshots`, body);
        return response.data ?? response;
      },

      list: async (
        config: MiosaConfig,
        options?: { sandboxId?: string },
      ): Promise<MiosaSnapshotRecord[]> => {
        const auth = resolveAuth(config);
        if (!options?.sandboxId) {
          throw new Error(
            "MIOSA snapshots are scoped per sandbox: pass { sandboxId } to list().",
          );
        }
        const response = await miosaRequest<{ data: MiosaSnapshotRecord[] }>(
          auth,
          "GET",
          `/sandboxes/${options.sandboxId}/snapshots`,
        );
        return response.data ?? [];
      },

      delete: async (
        _config: MiosaConfig,
        _snapshotId: string,
      ): Promise<void> => {
        throw new Error(
          "MIOSA snapshot deletion is scoped per sandbox (DELETE /sandboxes/:id/snapshots/:snap_id). " +
            "Use the MIOSA SDK/API directly until ComputeSDK passes the sandbox scope.",
        );
      },
    },
  },
});

export const miosa: typeof createMiosaProvider = (config) => {
  preconnectMiosa(config);
  return createMiosaProvider(config);
};

export default miosa;
