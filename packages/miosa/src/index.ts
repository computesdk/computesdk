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
import { RunnerClient, isConnectFailure } from "@miosa/sdk";

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
  /**
   * Routes create/exec/destroy through MIOSA's regional sandbox endpoint
   * (`run-<region>.miosa.ai`) instead of the account API. Enabled by
   * default; set `false` here or `MIOSA_RUNNER_MODE=0` to send sandbox
   * operations to the account API instead. Sandbox shapes the regional
   * endpoint does not serve (templates, snapshots, non-xs sizes) and an
   * unreachable endpoint both fall back to the account API per request.
   */
  runnerMode?: boolean;
  /** Overrides `miosa.ai` for the regional endpoint - self-hosted / test deployments only. */
  runnerBaseDomain?: string;
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

/**
 * Snapshot-id -> sandbox-id resolution cache. MIOSA scopes snapshot routes
 * under the owning sandbox, but ComputeSDK's snapshot.delete only carries the
 * snapshot id. Every snapshot that passes through create()/list() is
 * remembered here; delete() falls back to a bounded scan of the caller's
 * sandboxes when the id was minted by another process.
 *
 * Entries are keyed by the resolved API credential so a shared Node.js
 * process serving multiple tenants can never resolve (or time-observe) a
 * mapping cached by a different tenant.
 */
const snapshotSandboxIndex = new Map<string, string>();

function snapshotIndexKey(auth: { apiKey: string }, snapshotId: string): string {
  return `${auth.apiKey}:${snapshotId}`;
}

/**
 * Which transport created a sandbox. destroy only receives the id, never the
 * create-time handle, so it needs this to address the endpoint that actually
 * owns the sandbox.
 */
const sandboxTransport = new Map<string, "regional" | "account">();

/** Upper bound on sandboxes examined by the delete() fallback scan. */
const SNAPSHOT_SCAN_LIMIT = 25;

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
  /**
   * Set when this handle routes create/exec/destroy through the regional
   * sandbox endpoint (see "Regional sandbox endpoint" below). Carried on the
   * handle, not re-derived per call, because runCommand/filesystem/getInfo
   * only ever receive the handle - never the original MiosaConfig - so the
   * routing decision made at create()/getById()/list() time has to travel
   * with it.
   */
  runner?: RunnerRouting;
}

// ── HTTP client ─────────────────────────────────────────────────────────────

export const DEFAULT_BASE_URL = "https://api.miosa.ai/api/v1";

/**
 * The base URL to use when the caller did not pass one: `MIOSA_BASE_URL` if set,
 * otherwise the public API. Read through process.env so a deployment can point
 * a build at a regional or self-hosted endpoint without changing call sites.
 */
function baseUrlFromEnv(): string {
  return (
    (typeof process !== "undefined" ? process.env?.MIOSA_BASE_URL : undefined) ??
    DEFAULT_BASE_URL
  );
}
const DEFAULT_TIMEOUT_MS = 300_000;

export interface MiosaHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

// A bounded HTTP/2 pool prevents 100 independent TLS handshakes without
// serializing the complete burst behind one connection. Every handshake a cold
// client opens is paid for before its first dispatch, so the pool has to be no
// larger than the burst can use before its first request is answered: measured
// from a fresh process, 4 sessions beat 8, 16 and 32 for a 100-request first
// burst, and 16 sessions cost a single request noticeably more than a small
// pool. Keep the override private to the transport so operators can reproduce
// runner-specific measurements without changing the ComputeSDK create
// contract.
const HTTP2_SESSION_COUNT = (() => {
  const configured = Number.parseInt(
    (typeof process !== "undefined"
      ? process.env.MIOSA_HTTP2_SESSION_COUNT
      : undefined) ?? "4",
    10,
  );

  return Number.isFinite(configured)
    ? Math.min(64, Math.max(1, configured))
    : 4;
})();

// A connect that neither succeeds nor fails - a blackholed route drops the
// SYN silently - never emits an event for the OS to time out on, and
// `http2.connect(origin, { timeout })` is ignored for TLS sockets (verified
// against Node 20/22). A session stuck in that state keeps its slot in the
// pool, so a request dispatched onto it waits out the OS connect timeout
// (over a minute) instead of failing fast, and the empty-pool rejection in
// selectSession is never reached because the session is never discarded.
// Bound the connect phase here instead. Keep the override private to the
// transport, like MIOSA_HTTP2_SESSION_COUNT, so operators can reproduce
// runner-specific measurements without changing the ComputeSDK contract.
const DEFAULT_HTTP2_CONNECT_TIMEOUT_MS = 10_000;

// Node stores a timer delay as a signed 32-bit integer, so a larger value does
// not buy a longer wait: it warns and fires after about a millisecond, which
// would destroy every session the moment it connects. Keep the override inside
// a range a timer can actually represent, and well below an interval that
// would make the bound meaningless.
const MAX_HTTP2_CONNECT_TIMEOUT_MS = 120_000;

function http2ConnectTimeoutMs(): number {
  const configured = Number.parseInt(
    (typeof process !== "undefined"
      ? process.env.MIOSA_HTTP2_CONNECT_TIMEOUT_MS
      : undefined) ?? "",
    10,
  );

  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, MAX_HTTP2_CONNECT_TIMEOUT_MS)
    : DEFAULT_HTTP2_CONNECT_TIMEOUT_MS;
}

// How long a cold client waits for the rest of its pool to connect before the
// first dispatch on an origin. Once any session is ready the wait is skipped
// entirely, so this is spent at most once per process per origin. It is
// bounded so an endpoint that never connects still reaches the fail-fast path
// below instead of stalling here.
const COLD_START_WARMUP_MS = 50;

/**
 * Resolves once every session in the pool is ready, or the pool is empty, or
 * `timeoutMs` elapses - whichever happens first.
 */
function waitForPoolWarm(
  pool: Http2SessionPool,
  timeoutMs: number,
): Promise<void> {
  const target = () => Math.min(HTTP2_SESSION_COUNT, pool.sessions.length);
  const warm = () => pool.sessions.length === 0 || pool.ready.size >= target();
  if (warm()) return Promise.resolve();

  return new Promise((resolve) => {
    let warmTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (warmTimer !== undefined) clearTimeout(warmTimer);
      warmTimer = undefined;
      pool.capacityEvents.off("change", onChange);
      resolve();
    };
    const onChange = () => {
      if (warm()) finish();
    };
    warmTimer = setTimeout(finish, timeoutMs);
    pool.capacityEvents.on("change", onChange);
  });
}

interface Http2SessionPool {
  sessions: import("node:http2").ClientHttp2Session[];
  // Sessions whose TLS + HTTP/2 handshake has completed. Dispatching onto a
  // session that has not connected yet makes the request pay that session's
  // full handshake as first-byte latency - at burst start that is every
  // request in the burst, serialized behind 16 cold connects.
  ready: Set<import("node:http2").ClientHttp2Session>;
  firstReady: Promise<void>;
  resolveFirstReady: () => void;
  // Round-robin cursor used only while no session has connected yet (see
  // selectSession): once at least one session is ready, dispatch picks the
  // least-loaded ready session instead of rotating blindly.
  next: number;
  inFlight: number;
  // Open streams per session, used to find the least-loaded ready session and
  // to tell whether a session still has room under its own advertised
  // concurrent-stream limit. Cleared as streams finish or a session closes.
  inFlightBySession: Map<import("node:http2").ClientHttp2Session, number>;
  // Fires whenever dispatch-relevant state changes: a session joins `ready`,
  // a stream finishes, or a session is discarded. selectSession races a short
  // wait on this against a bound, so it is never worse than polling but never
  // sleeps the full bound when capacity frees up early.
  capacityEvents: import("node:events").EventEmitter;
  // Most recent connection failure, kept so selectSession can reject with a
  // real cause when every session has failed. Cleared on a successful connect.
  lastError: Error | undefined;
  // Set once a request has been dispatched on this pool.
  used?: boolean;
}

interface EnsureOptions {
  // Returns true when the caller no longer wants the pool, checked after the
  // module imports resolve and before any session is opened.
  abandoned?: () => boolean;
}

class PreconnectAbandoned extends Error {}

// Bumped by every closeMiosaConnections() call. A preconnect still loading its
// modules when the close happens compares against this and opens nothing.
let closeEpoch = 0;

// The pool opened by the import-time preconnect, before any provider config
// exists. `claimed` is set once a provider resolves to the same origin;
// `cancelled` stops a preconnect that is still loading from opening anything.
const importPreconnect: {
  origin?: string;
  claimed: boolean;
  cancelled: boolean;
} = { claimed: false, cancelled: false };

// A provider given an explicit baseUrl on a different origin never uses the
// default-origin pool the import opened, so release it unless something has.
function releaseUnusedImportPool(origin: string): void {
  if (importPreconnect.origin === undefined) return;
  if (origin === importPreconnect.origin) {
    importPreconnect.claimed = true;
    return;
  }
  if (importPreconnect.claimed) return;
  importPreconnect.cancelled = true;
  const pool = http2SessionPools.get(importPreconnect.origin);
  if (pool && !pool.used) closePool(importPreconnect.origin, pool);
}

function closePool(origin: string, pool: Http2SessionPool): void {
  for (const session of pool.sessions) {
    try {
      session.close();
    } catch {
      // Session already closed.
    }
  }
  pool.sessions = [];
  pool.inFlight = 0;
  if (http2SessionPools.get(origin) === pool) http2SessionPools.delete(origin);
}

// A pooled HTTP/2 session holds a ref'd socket handle, which keeps the Node
// event loop alive. Idle sessions are therefore unref'd so a finished script
// exits on its own, and re-ref'd only while a request is actually in flight so
// the process cannot exit out from under a pending response.
function setPoolRef(pool: Http2SessionPool, referenced: boolean): void {
  for (const session of pool.sessions) {
    try {
      if (referenced) session.ref();
      else session.unref();
    } catch {
      // Session already closed; nothing to (un)reference.
    }
  }
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

// Loaded once per process. A fresh `import()` on every request pays the module
// loader's resolve and load hooks each time, which is measurable when a
// TypeScript loader such as tsx is registered: at 100 concurrent requests it
// adds tens of milliseconds to every first request. Awaiting a cached promise
// is a microtask. The import stays dynamic so environments without
// `node:http2` never evaluate it (see canUseNodeHttp2).
function importNodeHttp2Modules() {
  return Promise.all([import("node:http2"), import("node:events")]);
}

let nodeHttp2Modules: ReturnType<typeof importNodeHttp2Modules> | undefined;

function loadNodeHttp2Modules(): ReturnType<typeof importNodeHttp2Modules> {
  if (nodeHttp2Modules === undefined) {
    nodeHttp2Modules = importNodeHttp2Modules();
  }
  return nodeHttp2Modules;
}

async function ensureHttp2Sessions(
  origin: string,
  options: EnsureOptions = {},
): Promise<Http2SessionPool> {
  const [http2, { EventEmitter }] = await loadNodeHttp2Modules();
  if (options.abandoned?.()) throw new PreconnectAbandoned();
  let resolveFirstReady: () => void = () => {};
  const firstReady = new Promise<void>((resolve) => {
    resolveFirstReady = resolve;
  });
  const pool = http2SessionPools.get(origin) ?? {
    sessions: [],
    ready: new Set<import("node:http2").ClientHttp2Session>(),
    firstReady,
    resolveFirstReady,
    next: 0,
    inFlight: 0,
    inFlightBySession: new Map<
      import("node:http2").ClientHttp2Session,
      number
    >(),
    // Every concurrent request parks a listener here; the count is unbounded.
    capacityEvents: new EventEmitter().setMaxListeners(0),
    lastError: undefined,
  };
  // A fully-recycled pool (every session discarded) must re-arm the
  // cold-start gate: the original firstReady stays resolved forever, so a
  // later refill would otherwise skip the wait and land on cold sessions.
  if (pool.sessions.length === 0 && pool.ready.size === 0) {
    pool.firstReady = firstReady;
    pool.resolveFirstReady = resolveFirstReady;
  }
  pool.sessions = pool.sessions.filter(
    (candidate) => !candidate.closed && !candidate.destroyed,
  );
  http2SessionPools.set(origin, pool);

  while (pool.sessions.length < HTTP2_SESSION_COUNT) {
    const session = http2.connect(origin);
    // Preconnected sessions start idle, so they must not hold the event loop.
    if (pool.inFlight === 0) {
      try {
        session.unref();
      } catch {
        // Session already closed.
      }
    }
    pool.sessions.push(session);

    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    const stopConnectTimer = () => {
      if (connectTimer !== undefined) {
        clearTimeout(connectTimer);
        connectTimer = undefined;
      }
    };

    session.once("connect", () => {
      stopConnectTimer();
      pool.ready.add(session);
      pool.lastError = undefined;
      pool.resolveFirstReady();
      pool.capacityEvents.emit("change");
    });

    const discard = (cause?: unknown) => {
      stopConnectTimer();
      if (cause instanceof Error) pool.lastError = cause;
      pool.ready.delete(session);
      pool.sessions = pool.sessions.filter(
        (candidate) => candidate !== session,
      );
      pool.inFlightBySession.delete(session);
      pool.capacityEvents.emit("change");
    };
    session.once("close", discard);
    session.once("error", discard);
    session.once("goaway", discard);

    // Give up on a connect that has produced no event of its own, drop it from
    // the pool, and record why: the pooled session is the only thing keeping a
    // dispatched request pending, so this is what turns a silent blackhole into
    // a connection error the caller can see.
    const connectTimeoutMs = http2ConnectTimeoutMs();
    connectTimer = setTimeout(() => {
      connectTimer = undefined;
      discard(
        new Error(
          `MIOSA HTTP/2 connect to ${origin} timed out after ${connectTimeoutMs} ms`,
        ),
      );
      try {
        session.destroy();
      } catch {
        // Session already closed.
      }
    }, connectTimeoutMs);
    // A pending connect must not hold the process open by itself; a request
    // already waiting on this session keeps the loop alive anyway.
    connectTimer.unref?.();
  }

  return pool;
}

// Node reports this as a session's maxConcurrentStreams before its SETTINGS
// frame has arrived (verified against Node 20/22's http2 implementation): a
// placeholder, not "unlimited". Treating it as the cap for a session we
// haven't heard from yet is exactly as conservative as Node's own client
// already is, so it adds no new risk - it only stops us from reading
// "unlimited" into a session that may turn out to allow far fewer streams.
const DEFAULT_SESSION_STREAM_CAP = 100;

function sessionStreamCapacity(
  session: import("node:http2").ClientHttp2Session,
): number {
  const advertised = session.remoteSettings?.maxConcurrentStreams;
  return typeof advertised === "number" && advertised >= 0
    ? advertised
    : DEFAULT_SESSION_STREAM_CAP;
}

// Among the ready sessions, the one with the most spare capacity under its
// own advertised stream limit - undefined only when `ready` is empty.
function leastLoadedReady(pool: Http2SessionPool):
  | {
      session: import("node:http2").ClientHttp2Session;
      spare: number;
    }
  | undefined {
  let best: import("node:http2").ClientHttp2Session | undefined;
  let bestSpare = -Infinity;
  for (const session of pool.ready) {
    const spare =
      sessionStreamCapacity(session) -
      (pool.inFlightBySession.get(session) ?? 0);
    if (spare > bestSpare) {
      bestSpare = spare;
      best = session;
    }
  }
  return best === undefined ? undefined : { session: best, spare: bestSpare };
}

function waitForCapacityChange(
  pool: Http2SessionPool,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const onChange = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      pool.capacityEvents.off("change", onChange);
      resolve();
    }, timeoutMs);
    pool.capacityEvents.once("change", onChange);
  });
}

// How long to wait, in total, for a ready session to free up a stream slot
// before dispatching onto whichever session is least bad anyway. This only
// ever triggers when every ready session is already at its own advertised
// cap - the common case (one ready session with room) returns immediately.
const CAPACITY_WAIT_STEP_MS = 20;
const CAPACITY_WAIT_BUDGET_MS = 200;

// Picks a session to dispatch onto and reserves a stream slot on it: the
// least-loaded ready session with room under its own stream cap, waiting
// briefly only while every ready session is saturated (or none is ready yet),
// and otherwise falling back to the connecting pool so a request is never
// stalled indefinitely. Selection and reservation happen in one synchronous
// step (no await between them), so a burst of concurrent callers each sees the
// load the previous one just added instead of all picking the same session.
// The caller releases the slot in its finally block. Rejects with the last
// connection error once the wait budget is spent and no session remains.
async function selectSession(
  pool: Http2SessionPool,
  waitBudgetMs: number,
): Promise<import("node:http2").ClientHttp2Session> {
  const reserve = (session: import("node:http2").ClientHttp2Session) => {
    pool.inFlightBySession.set(
      session,
      (pool.inFlightBySession.get(session) ?? 0) + 1,
    );
    return session;
  };
  const deadline = Date.now() + waitBudgetMs;
  for (;;) {
    const pick = leastLoadedReady(pool);
    if (pick !== undefined && (pick.spare > 0 || Date.now() >= deadline)) {
      return reserve(pick.session);
    }
    if (pick === undefined && Date.now() >= deadline) {
      if (pool.sessions.length > 0) {
        const candidate = pool.sessions[pool.next % pool.sessions.length]!;
        pool.next = (pool.next + 1) % pool.sessions.length;
        return reserve(candidate);
      }
      throw (
        pool.lastError ?? new Error("MIOSA HTTP/2 connection failed")
      );
    }
    await waitForCapacityChange(pool, CAPACITY_WAIT_STEP_MS);
  }
}

function hasUsableCredentials(config: MiosaConfig): boolean {
  const apiKey =
    config.apiKey ??
    (typeof process !== "undefined" ? process.env?.MIOSA_API_KEY : undefined) ??
    "";
  return apiKey.startsWith("msk_");
}

function preconnectMiosa(
  config: MiosaConfig,
  options: { onImport?: boolean } = {},
): void {
  // Preconnect runs before resolveAuth, so check credentials here too: a
  // misconfigured provider must not open a pool of TLS connections it can
  // never use. resolveAuth still raises the descriptive error on first call.
  if (!hasUsableCredentials(config)) return;

  // list/getById/getUrl/filesystem/snapshots stay on the control-plane pool
  // even when runnerMode is on (runner-sdk.d.ts), so both warm here when
  // eligible - this is additive, never a replacement for the block below.
  const runner = resolveRunnerRouting(config);
  if (runner) {
    // resolveAuth cannot throw here: the credentials were checked above. It
    // also keys the warmed client exactly as the first create will look it up.
    void getRunnerClient(resolveAuth(config)).catch(() => undefined);
  }

  const baseUrl = (config.baseUrl ?? baseUrlFromEnv()).replace(/\/+$/, "");
  const url = new URL(baseUrl);

  if (canUseNodeHttp2(url)) {
    const epoch = closeEpoch;
    if (options.onImport) {
      importPreconnect.origin = url.origin;
    } else if (config.baseUrl !== undefined) {
      releaseUnusedImportPool(url.origin);
    } else if (url.origin === importPreconnect.origin) {
      importPreconnect.claimed = true;
    }
    void ensureHttp2Sessions(url.origin, {
      abandoned: () =>
        epoch !== closeEpoch ||
        (options.onImport === true && importPreconnect.cancelled),
    }).catch(() => undefined);
  }
}

/**
 * Close every pooled HTTP/2 session.
 *
 * Sessions are unref'd while idle, so this is not required for a process to
 * exit. It is here for callers that want to release sockets deterministically,
 * such as long-lived hosts creating providers for many different origins.
 */
export function closeMiosaConnections(): void {
  closeEpoch += 1;
  for (const [origin, pool] of [...http2SessionPools]) closePool(origin, pool);
  http2SessionPools.clear();
}

/**
 * The HTTP/2 pool transport used whenever `canUseNodeHttp2` allows it.
 *
 * Exported so the pool's dispatch and capacity handling can be covered
 * directly against a real `node:http2` server; other provider tests stub
 * `fetch` and never take this path (it is disabled under `NODE_ENV=test`).
 */
export async function nodeHttp2Request(
  url: URL,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  headers: Record<string, string>,
  body?: string,
): Promise<MiosaHttpResponse> {
  const origin = url.origin;
  const pool = await ensureHttp2Sessions(origin);
  pool.used = true;

  if (pool.inFlight === 0) setPoolRef(pool, true);
  pool.inFlight += 1;

  // Cold start: nothing on this origin has connected yet. Wait for the first
  // session, then for the rest of the pool. One ready session can answer a
  // single request, but a burst spreads only once its peers are ready too:
  // dispatched any earlier, the requests concentrate on whichever session
  // connected first and each pays a handshake on its critical path. Both waits
  // are bounded (1s, then COLD_START_WARMUP_MS): if no session ever connects
  // (unreachable or misconfigured endpoint), selectSession falls through to
  // the connecting pool below and the request itself surfaces the connection
  // error promptly. Once any session is ready this whole branch is skipped, so
  // a warm client pays none of it.
  if (pool.ready.size === 0) {
    let firstReadyTimer: ReturnType<typeof setTimeout> | undefined;
    let onChange: (() => void) | undefined;
    await Promise.race([
      pool.firstReady,
      new Promise<void>((resolve) => {
        firstReadyTimer = setTimeout(resolve, 1000);
      }),
      // Every connection failed: stop waiting and let selectSession reject.
      new Promise<void>((resolve) => {
        onChange = () => {
          if (pool.sessions.length === 0) resolve();
        };
        pool.capacityEvents.on("change", onChange);
      }),
    ]);
    if (firstReadyTimer !== undefined) clearTimeout(firstReadyTimer);
    if (onChange !== undefined) pool.capacityEvents.off("change", onChange);

    await waitForPoolWarm(pool, COLD_START_WARMUP_MS);
  }

  // Dispatch to the least-loaded ready session, respecting its own advertised
  // stream cap, rather than a quorum wait at burst start: a single ready
  // session already has room for its whole cap's worth of concurrent
  // requests, so holding the burst for more sessions to connect only adds
  // latency without avoiding anything. The wait above may have already used
  // its budget finding this session, so give it none left to spend here.
  let session: import("node:http2").ClientHttp2Session | undefined;
  try {
    session = await selectSession(
      pool,
      pool.ready.size === 0 ? 0 : CAPACITY_WAIT_BUDGET_MS,
    );
    const reserved = session;
    return await new Promise<MiosaHttpResponse>((resolve, reject) => {
      let status = 0;
      const chunks: Buffer[] = [];
      const request = reserved.request({
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
  } finally {
    pool.inFlight -= 1;
    if (pool.inFlight <= 0) {
      pool.inFlight = 0;
      setPoolRef(pool, false);
    }
    if (session !== undefined) {
      const remaining = (pool.inFlightBySession.get(session) ?? 1) - 1;
      if (remaining > 0) pool.inFlightBySession.set(session, remaining);
      else pool.inFlightBySession.delete(session);
    }
    pool.capacityEvents.emit("change");
  }
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

// ── Regional sandbox endpoint ─────────────────────────────────────────
//
// MIOSA serves sandbox operations - create, exec, destroy - from regional
// endpoints at run-<region>.miosa.ai. api.miosa.ai remains the account API
// and still serves everything else. This is the default transport; turn it
// off per provider with `runnerMode: false`, or per process with
// MIOSA_RUNNER_MODE=0.
//
// Every other operation (list, getById, getInfo, getUrl/expose, filesystem,
// snapshots) keeps using the account API above: the regional endpoint does
// not expose those routes, and expose/snapshots stay on the account API
// regardless.
//
// A create the regional endpoint does not serve - templates, images,
// snapshots, and shapes above the standard sandbox size - is handed to the
// account API rather than failing, so every shape keeps working. The region
// defaults to `us` unless `runnerBaseDomain` overrides the host entirely.

/**
 * The MIOSA_RUNNER_MODE switch. Only an explicit disable turns the regional
 * endpoint off, so an unset, empty or unrecognised value leaves the default
 * (enabled) in place.
 */
function readRunnerModeEnv(): boolean | undefined {
  const raw =
    typeof process !== "undefined" ? process.env?.MIOSA_RUNNER_MODE : undefined;
  if (raw === undefined) return undefined;
  const normalised = raw.trim().toLowerCase();
  if (normalised === "0" || normalised === "false") return false;
  if (normalised === "1" || normalised === "true") return true;
  return undefined;
}

export interface RunnerRouting {
  /** Overrides `miosa.ai` - for self-hosted / test deployments (RunnerClientOptions.baseDomain). */
  readonly baseDomain?: string;
}

function resolveRunnerRouting(config: MiosaConfig): RunnerRouting | undefined {
  const explicit = config.runnerMode ?? readRunnerModeEnv();
  if (explicit === false) return undefined;
  return config.runnerBaseDomain ? { baseDomain: config.runnerBaseDomain } : {};
}

/** Resolved credentials plus the routing they were resolved for. */
interface MiosaAuth {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly runner?: RunnerRouting;
}

/**
 * Failures of an account-API create made on the regional endpoint's behalf.
 * Such a POST may have provisioned a sandbox before its response was lost,
 * so it must never be mistaken for a regional decline and sent again.
 */
const accountApiCreateFailures = new WeakSet<object>();

function markAccountApiCreateFailure(error: unknown): unknown {
  const marked =
    typeof error === "object" && error !== null
      ? error
      : new Error(String(error));
  accountApiCreateFailures.add(marked);
  return marked;
}

/** DNS failures that mean the regional hostname never resolved. */
const UNRESOLVED_HOST_CODES = new Set(["ENOTFOUND", "EAI_AGAIN"]);

/**
 * True when the regional endpoint declined a create before provisioning
 * anything, so the account API can serve it without risking a second
 * sandbox:
 * - it could not be reached (connect, reset, timeout or DNS failure);
 * - every runner tried refused it with 429 (`rate_limited` or
 *   `runtime_busy`) or `feed_stale`. The SDK already retries the next runner
 *   address on these and throws once it runs out, so by the time the error
 *   arrives here no runner has capacity for it.
 * Anything else is rethrown by the caller, because it may follow a sandbox
 * that already exists.
 */
async function regionalCreateDeclined(error: unknown): Promise<boolean> {
  if (typeof error === "object" && error !== null) {
    if (accountApiCreateFailures.has(error)) return false;
    const shaped = error as {
      name?: unknown;
      code?: unknown;
      status?: unknown;
      isRateLimited?: unknown;
      isBusy?: unknown;
      message?: unknown;
    };
    if (shaped.isRateLimited === true || shaped.isBusy === true) return true;
    // A runner answers 429 only before it admits a create.
    if (shaped.name === "RunnerError" && shaped.status === 429) return true;
    if (typeof shaped.code === "string" && UNRESOLVED_HOST_CODES.has(shaped.code)) {
      return true;
    }
    if (
      typeof shaped.message === "string" &&
      shaped.message.startsWith("RunnerClient: no runner addresses")
    ) {
      return true;
    }
  }
  return isConnectFailure(error);
}

type MiosaRunnerClient = InstanceType<typeof RunnerClient>;

const runnerClients = new Map<string, Promise<MiosaRunnerClient>>();

function runnerClientCacheKey(auth: MiosaAuth): string {
  return `${auth.apiKey}:${auth.baseUrl}:${auth.runner?.baseDomain ?? ""}`;
}

/**
 * Served by the account API when the regional endpoint declines a create -
 * a shape it does not carry, or an address it cannot reach. Only ever called
 * for a create the regional endpoint did not provision, so it cannot
 * provision a second sandbox.
 */
async function createSandboxOnAccountApi(
  auth: MiosaAuth,
  params: Record<string, unknown>,
): Promise<MiosaSandboxRecord> {
  return unwrapSandbox(
    await miosaRequest<unknown>(auth, "POST", "/sandboxes", params),
  );
}

async function getRunnerClient(auth: MiosaAuth): Promise<MiosaRunnerClient> {
  const routing = auth.runner;
  if (!routing) {
    throw new Error(
      "MIOSA regional endpoint requested without routing configured",
    );
  }
  const cacheKey = runnerClientCacheKey(auth);
  let pending = runnerClients.get(cacheKey);
  if (!pending) {
    // Static import: the SDK is loaded with this module, in the process's
    // initial module graph, so a burst of creates never pays for loading it.
    pending = Promise.resolve(
      new RunnerClient({
        apiKey: auth.apiKey,
        ...(routing.baseDomain ? { baseDomain: routing.baseDomain } : {}),
        // Hand creates the regional endpoint does not serve to the account
        // API instead of failing, so callers keep working for every shape.
        fallbackCreate: async (params: Record<string, unknown>) => {
          try {
            const record = await createSandboxOnAccountApi(auth, params);
            return { id: record.id ?? "", runnerUrl: "", data: record };
          } catch (error) {
            throw markAccountApiCreateFailure(error);
          }
        },
      }),
    );
    runnerClients.set(cacheKey, pending);
  }
  return pending;
}

/**
 * Closes every cached RunnerClient and forgets it. Mirrors
 * closeMiosaConnections() for the control-plane pool; mainly for tests and
 * long-lived hosts that want deterministic socket teardown.
 */
export async function closeMiosaRunnerConnections(): Promise<void> {
  const pending = [...runnerClients.values()];
  runnerClients.clear();
  await Promise.all(
    pending.map(async (clientPromise) => {
      try {
        const client = await clientPromise;
        await client.close();
      } catch {
        // Construction itself failed - nothing to close.
      }
    }),
  );
}

/** The runner's exec response body is the same shape as the control
 * plane's (C2): either `{ data: {...} }` or a flat result. */
function unwrapExecResult(raw: Record<string, unknown>): MiosaExecResult {
  const data = raw["data"];
  return data && typeof data === "object"
    ? (data as MiosaExecResult)
    : (raw as MiosaExecResult);
}

/** True for both MiosaApiError (control plane) and the runner's own error
 * class - both carry a numeric `.status`, so this needs no instanceof
 * against a class loaded via dynamic import. */
function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === 404
  );
}

function resolveAuth(config: MiosaConfig): MiosaAuth {
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

  const runner = resolveRunnerRouting(config);

  return {
    apiKey,
    baseUrl: (config.baseUrl ?? baseUrlFromEnv()).replace(/\/+$/, ""),
    ...(runner ? { runner } : {}),
  };
}

/**
 * Routing for a handle built from a sandbox id alone. `getById` and `list`
 * never see the handle a create returned, so they have to consult the origin
 * recorded when that sandbox was created; handing back routing that
 * contradicts it sends exec to an endpoint that does not own the sandbox.
 * An id this process never created keeps the configured default (the regional
 * endpoint when runnerMode is on), because guessing "account" for it would
 * strand a regionally-created sandbox on an API that cannot serve it.
 */
function handleAuthFor(
  config: MiosaConfig,
  auth: MiosaAuth,
  sandboxId: string,
): MiosaAuth {
  const known = sandboxTransport.get(sandboxId);
  if (known === "account") return { apiKey: auth.apiKey, baseUrl: auth.baseUrl };
  if (known === "regional") return regionalAuth(config, auth);
  return auth;
}

/**
 * Routing to the regional endpoint for a sandbox known to live there, even
 * when runnerMode has since been turned off: only that endpoint can serve
 * it, and the account API would answer 404 for it.
 */
function regionalAuth(config: MiosaConfig, auth: MiosaAuth): MiosaAuth {
  if (auth.runner) return auth;
  return {
    ...auth,
    runner: config.runnerBaseDomain ? { baseDomain: config.runnerBaseDomain } : {},
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

function toCreatedAt(value: string | null | undefined): Date {
  const parsed = value ? new Date(value) : undefined;
  // A compact create response may omit created_at. Returning an Invalid Date
  // breaks every consumer that formats it, so fall back to now.
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
}

function toMs(timeoutSec: number | null | undefined): number {
  return typeof timeoutSec === "number"
    ? timeoutSec * 1000
    : DEFAULT_TIMEOUT_MS;
}

function toStatus(state: string | null | undefined): SandboxInfo["status"] {
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
    let result: MiosaExecResult;
    if (sandbox.runner) {
      // wait/wait_timeout_ms (body, above) are accepted from the caller but
      // intentionally dropped here, not forwarded: on the runner, create
      // only answers once the launch has completed (state "running", C2),
      // so by the time exec runs there is nothing left to wait for - unlike
      // the control plane, where create/exec can return before the VM has
      // finished booting. RunnerClient.exec's typed options (runner-sdk.d.ts)
      // reflect that - they carry cwd/env/timeout only, no wait knob.
      // Everything else about the request (path, auth, response body) is
      // the same contract as the control plane (C2).
      const client = await getRunnerClient(sandbox);
      try {
        const raw = await client.exec(sandbox.record.id, fullCommand, {
          ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
          ...(options?.env !== undefined ? { env: options.env } : {}),
          ...(options?.timeout !== undefined
            ? { timeout: Math.ceil(options.timeout / 1000) }
            : {}),
        });
        result = unwrapExecResult(raw);
      } catch (error) {
        // A handle from getById/list for a sandbox created in another
        // process carries no recorded origin, so it defaults to the regional
        // endpoint. A 404 there means that endpoint does not own the sandbox
        // and ran nothing, so the account API - which serves every sandbox
        // the regional endpoint declined - can take the command. Learn the
        // origin so later calls on this handle and id go there directly. A
        // sandbox recorded as regional never takes this path.
        if (
          !isNotFoundError(error) ||
          sandboxTransport.get(sandbox.record.id) === "regional"
        ) {
          throw error;
        }
        sandboxTransport.set(sandbox.record.id, "account");
        sandbox.runner = undefined;
        const response = await miosaRequest<{ data: MiosaExecResult }>(
          sandbox,
          "POST",
          `/sandboxes/${sandbox.record.id}/exec`,
          body,
        );
        result = response.data ?? {};
      }
    } else {
      const response = await miosaRequest<{ data: MiosaExecResult }>(
        sandbox,
        "POST",
        `/sandboxes/${sandbox.record.id}/exec`,
        body,
      );
      result = response.data ?? {};
    }
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
        // Map ComputeSDK's provider-agnostic resource hints (vcpus / memory
        // in MB) onto MIOSA's size contracts. MIOSA sizes are fixed shapes,
        // so pick the smallest size that satisfies both requested dimensions
        // (same interpretation Modal/Beam/Blaxel apply to these fields).
        const requestedVcpus = options?.vcpus ?? options?.cpus ?? options?.cpu;
        const requestedMemoryMb = options?.memory ?? options?.memoryMiB;
        if (requestedVcpus !== undefined || requestedMemoryMb !== undefined) {
          const sizes: Array<{ size: string; vcpus: number; memoryMb: number }> = [
            { size: "xs", vcpus: 1, memoryMb: 2048 },
            { size: "small", vcpus: 2, memoryMb: 4096 },
            { size: "medium", vcpus: 4, memoryMb: 8192 },
            { size: "large", vcpus: 8, memoryMb: 16384 },
            { size: "xl", vcpus: 16, memoryMb: 32768 },
          ];
          const fit = sizes.find(
            (candidate) =>
              (requestedVcpus === undefined || candidate.vcpus >= requestedVcpus) &&
              (requestedMemoryMb === undefined || candidate.memoryMb >= requestedMemoryMb),
          );
          // Oversized requests clamp to the largest shape rather than failing:
          // the caller asked for "big", xl is the biggest big we sell.
          body.size = (fit ?? sizes[sizes.length - 1]).size;
        }
        if (options?.templateId !== undefined)
          body.template_id = options.templateId;
        if (options?.snapshotId !== undefined)
          body.snapshot_id = options.snapshotId;
        if (options?.name !== undefined) body.name = options.name;
        if (options?.envs !== undefined) body.env = options.envs;
        if (options?.metadata !== undefined) body.metadata = options.metadata;

        let record: MiosaSandboxRecord;
        // Where the sandbox actually landed. The account API serves the
        // creates the regional endpoint declines, and exec/destroy have to
        // follow the same path or they address a host that never saw it.
        let servedByAccountApi = false;
        if (auth.runner) {
          try {
            const created = await (
              await getRunnerClient(auth)
            ).createSandbox(body);
            record = unwrapSandbox(created.data);
            // The SDK reports an empty runnerUrl for a create it handed to
            // the account API.
            servedByAccountApi = !created.runnerUrl;
          } catch (error) {
            // An unreachable regional endpoint, or one with no capacity for
            // this create, is not a create failure: nothing was provisioned,
            // so the account API can still serve it. Deliberately narrow -
            // anything that may follow an existing sandbox is rethrown,
            // because retrying there would provision a second one.
            if (!(await regionalCreateDeclined(error))) throw error;
            record = await createSandboxOnAccountApi(auth, body);
            servedByAccountApi = true;
          }
        } else {
          record = await createSandboxOnAccountApi(auth, body);
          servedByAccountApi = true;
        }
        if (!record.id) {
          throw new Error(
            "MIOSA create sandbox returned a record without an id",
          );
        }

        // A handle created through the account API keeps using it, so its
        // exec and destroy never address the regional endpoint for a sandbox
        // that endpoint does not own.
        const handleAuth: MiosaAuth = servedByAccountApi
          ? { apiKey: auth.apiKey, baseUrl: auth.baseUrl }
          : auth;
        sandboxTransport.set(
          record.id,
          servedByAccountApi ? "account" : "regional",
        );

        return { sandbox: { record, ...handleAuth }, sandboxId: record.id };
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
          return {
            sandbox: { record, ...handleAuthFor(config, auth, record.id) },
            sandboxId: record.id,
          };
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
          sandbox: { record, ...handleAuthFor(config, auth, record.id) },
          sandboxId: record.id,
        }));
      },

      destroy: async (config: MiosaConfig, sandboxId: string) => {
        const auth = resolveAuth(config);
        const known = sandboxTransport.get(sandboxId);

        const destroyOnAccountApi = () =>
          miosaRequest<unknown>(auth, "DELETE", `/sandboxes/${sandboxId}`);
        const destroyOnRegionalEndpoint = async (): Promise<void> => {
          await (
            await getRunnerClient(regionalAuth(config, auth))
          ).destroySandbox(sandboxId);
        };
        // Resolves true only when the endpoint answered 404, meaning it never
        // had this sandbox - which says nothing about the other endpoint.
        const missing = async (run: () => Promise<unknown>): Promise<boolean> => {
          try {
            await run();
            return false;
          } catch (error) {
            if (isNotFoundError(error)) return true;
            throw error;
          }
        };

        // Address only the endpoint recorded at create time - a regional
        // sandbox stays on the regional endpoint even if runnerMode has been
        // turned off since, because the account API cannot delete it. An id
        // this process never created - one made in another process, or before
        // a restart - has no entry, so a 404 from either endpoint is not
        // conclusive on its own and both are tried; the account API goes
        // first because it is the registry, and is the only transport
        // available when runnerMode is off.
        if (known === "regional") {
          await missing(destroyOnRegionalEndpoint);
        } else if (known === "account" || auth.runner === undefined) {
          await missing(destroyOnAccountApi);
        } else if (await missing(destroyOnAccountApi)) {
          await missing(destroyOnRegionalEndpoint);
        }

        // Reaching here means the sandbox was deleted or is confirmed absent,
        // so its entry can go. A transient failure throws above and keeps it:
        // clearing it then would send the retry to the other endpoint, where
        // a 404 reads as "already destroyed" while the sandbox still runs.
        sandboxTransport.delete(sandboxId);
      },

      runCommand: execInSandbox,

      getInfo: async (sandbox: MiosaSandbox): Promise<SandboxInfo> => {
        // The handle's record is a snapshot from create/getById and goes stale
        // as soon as the sandbox stops or fails. Refetch so callers polling
        // status see live state, and refresh the handle for later reads. This
        // also repairs fields the compact create response may have omitted.
        let record = sandbox.record;
        let missing = false;
        try {
          const payload = await miosaRequest<unknown>(
            { apiKey: sandbox.apiKey, baseUrl: sandbox.baseUrl },
            "GET",
            `/sandboxes/${record.id}`,
          );
          record = unwrapSandbox(payload);
          sandbox.record = record;
        } catch (error) {
          if (!(error instanceof MiosaApiError && error.status === 404)) throw error;
          // Already destroyed: report it as stopped rather than echoing the
          // last known running state back to the caller.
          missing = true;
        }

        return {
          id: record.id,
          provider: "miosa",
          status: missing ? "stopped" : toStatus(record.state),
          createdAt: toCreatedAt(record.created_at),
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
        const record = response.data ?? response;
        if (record?.id)
          snapshotSandboxIndex.set(snapshotIndexKey(auth, record.id), sandboxId);
        return record;
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
        const records = response.data ?? [];
        for (const record of records) {
          // The listing is already scoped to options.sandboxId, so that is the
          // owner even when the record itself omits sandbox_id. Recording it
          // unconditionally is what lets a later delete() skip the scan.
          const owner = record?.sandbox_id ?? options.sandboxId;
          if (record?.id && owner)
            snapshotSandboxIndex.set(snapshotIndexKey(auth, record.id), owner);
        }
        return records;
      },

      delete: async (
        config: MiosaConfig,
        snapshotId: string,
      ): Promise<void> => {
        const auth = resolveAuth(config);
        const indexKey = snapshotIndexKey(auth, snapshotId);
        let sandboxId = snapshotSandboxIndex.get(indexKey);
        let scanCapped = false;
        if (!sandboxId) {
          // Snapshot minted outside this process: resolve the owning sandbox
          // by scanning the caller's sandboxes. The scan is sequential and
          // hard-capped at SNAPSHOT_SCAN_LIMIT sandboxes so a delete() with
          // an unknown id can never amplify into an unbounded request storm.
          const listing = await miosaRequest<{
            data?: Array<{ id: string }>;
          }>(auth, "GET", "/sandboxes");
          const all = listing.data ?? [];
          const candidates = all.slice(0, SNAPSHOT_SCAN_LIMIT);
          scanCapped = all.length > candidates.length;
          for (const candidate of candidates) {
            try {
              const snaps = await miosaRequest<{
                data?: MiosaSnapshotRecord[];
              }>(auth, "GET", `/sandboxes/${candidate.id}/snapshots`);
              if ((snaps.data ?? []).some((snap) => snap.id === snapshotId)) {
                sandboxId = candidate.id;
                break;
              }
            } catch (error) {
              if (error instanceof MiosaApiError && error.status === 404)
                continue;
              throw error;
            }
          }
        }
        if (!sandboxId) {
          if (scanCapped) {
            // The scan stopped at SNAPSHOT_SCAN_LIMIT before examining every
            // sandbox, so "not found" here does not mean "does not exist".
            // Reporting success would leave a live snapshot billing silently.
            throw new MiosaApiError(
              `MIOSA could not resolve the sandbox owning snapshot ${snapshotId} ` +
                `within the first ${SNAPSHOT_SCAN_LIMIT} sandboxes. Delete it via ` +
                `the owning sandbox (DELETE /sandboxes/:id/snapshots/${snapshotId}), ` +
                `or call snapshot.list({ sandboxId }) first so the provider learns ` +
                `the mapping.`,
              409,
              "SNAPSHOT_OWNER_UNRESOLVED",
            );
          }
          // Every sandbox was examined and none owns it: genuinely gone.
          // Deletion is idempotent, so report success.
          return;
        }
        try {
          await miosaRequest(
            auth,
            "DELETE",
            `/sandboxes/${sandboxId}/snapshots/${snapshotId}`,
          );
          snapshotSandboxIndex.delete(indexKey);
        } catch (error) {
          if (error instanceof MiosaApiError && error.status === 404) {
            // Already gone server-side: the mapping is stale, drop it.
            snapshotSandboxIndex.delete(indexKey);
            return;
          }
          // Transient failure: keep the mapping so a retry can use the
          // shortcut instead of re-running the fallback scan.
          throw error;
        }
      },
    },
  },
});

export const miosa: typeof createMiosaProvider = (config) => {
  preconnectMiosa(config);
  return createMiosaProvider(config);
};

export default miosa;

/**
 * Whether importing this module should open its connections.
 *
 * Only an explicit disable turns it off, matching MIOSA_RUNNER_MODE: an unset,
 * empty or unrecognised value leaves the preconnect in place.
 */
function preconnectOnImport(): boolean {
  const raw =
    typeof process !== "undefined" ? process.env?.MIOSA_PRECONNECT : undefined;
  if (raw === undefined) return true;
  const normalised = raw.trim().toLowerCase();
  return !(normalised === "0" || normalised === "false");
}

// A caller that constructs the provider inside its own timer - a benchmark
// task, a request handler, a serverless invocation - gives the pool no lead
// time, so the connection handshake lands on its first request. Opening the
// pool when this module is imported moves that handshake ahead of the caller's
// timer instead. This is best-effort and must never interfere with the import:
// nothing connects without a usable key, a malformed base URL is swallowed
// rather than thrown, and idle sessions stay unref'd so a script that imports
// the provider still exits on its own. A provider given an explicit baseUrl on
// another origin releases the default pool if nothing used it. Opt out with MIOSA_PRECONNECT=0.
if (preconnectOnImport()) {
  try {
    preconnectMiosa({ baseUrl: baseUrlFromEnv() }, { onImport: true });
  } catch {
    // Importing the provider must never fail because of preconnect.
  }
}
