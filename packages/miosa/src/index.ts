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

import { defineProvider, escapeShellArg, resolveVolumeRef, withVolumeSettle } from "@computesdk/provider";
import { RunnerClient } from "./runner-entry";

import {
  LAZY_CREATE_ENV,
  LazyCreate,
  RunRefused,
  canRunInCreate,
  isPlaceholderId,
  isRunRefusal,
  placeholderId,
  readRun,
  withRun,
  withoutRun,
} from "./lazy-create";
import type { RunOutcome, RunSpec } from "./lazy-create";

import type {
  CommandResult,
  InstanceInfo,
  CreateInstanceOptions,
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
   * default against MIOSA's own account API; off by default when `baseUrl`
   * (or `MIOSA_BASE_URL`) names a custom control plane, so that its key is
   * not sent to the public regional host, unless this is `true`,
   * `MIOSA_RUNNER_MODE=1` or `runnerBaseDomain` is set. Set `false` here or
   * `MIOSA_RUNNER_MODE=0` to send sandbox operations to the account API. Sandbox shapes the regional
   * endpoint does not serve (templates, snapshots, non-xs sizes) and an
   * unreachable endpoint both fall back to the account API per request.
   */
  runnerMode?: boolean;
  /** Overrides `miosa.ai` for the regional endpoint - self-hosted / test deployments only. */
  runnerBaseDomain?: string;
  /**
   * Defers `create()` until the sandbox is first used. `create()` returns a
   * handle without any network call; the first `runCommand()` sends one
   * request that creates the sandbox and runs the command, and any other
   * first call creates the sandbox before doing its own work. Errors from
   * the create surface on that first call. Only applies while the regional
   * endpoint is in use. Off by default; `MIOSA_LAZY_CREATE=1` turns it on
   * for every provider that does not set this explicitly.
   *
   * `sandboxId` is a client-side placeholder for the whole life of the handle,
   * before and after the sandbox exists; it is only meaningful inside this
   * process and for this API key. Read the real id from `getInfo().id`.
   */
  lazyCreate?: boolean;
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
  /**
   * Set while the sandbox is created lazily (see `MiosaConfig.lazyCreate`).
   * Until the create has run, `record` is a placeholder; the create fills in
   * `record`, `runner` and the credentials' routing in place, so every
   * holder of this handle sees the real sandbox.
   */
  lazy?: LazyHandle;
}

/** A sandbox whose create has not happened yet, or is happening now. */
export interface LazyHandle {
  readonly id: string;
  readonly create: LazyCreate<CreatedSandbox>;
}

/** What a create produced, and where the sandbox now lives. */
export interface CreatedSandbox {
  readonly record: MiosaSandboxRecord;
  /** True when the account API, not the regional endpoint, holds the sandbox. */
  readonly servedByAccountApi: boolean;
  /** The first command's outcome, when the create ran it. */
  readonly run?: RunOutcome;
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

  // With the regional endpoint in use, create/exec/destroy never touch the
  // account API, so only the runner client is warmed. The account API pool
  // (list, getById, getUrl, filesystem, snapshots, fallback creates) opens
  // when a call first goes there: warming it here would put its TLS
  // handshakes on the thread ahead of the runner connections.
  const runner = resolveRunnerRouting(config);
  if (runner) {
    // resolveAuth cannot throw here: the credentials were checked above. It
    // also keys the warmed client exactly as the first create will look it up.
    void getRunnerClient(resolveAuth(config)).catch(() => undefined);
    return;
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

/**
 * Whether the account API in use is MIOSA's own. A custom base URL, from the
 * config or MIOSA_BASE_URL, names a different control plane (white-label or
 * self-hosted), whose API key the public regional endpoint must not see.
 */
function usesDefaultAccountApi(config: MiosaConfig): boolean {
  const baseUrl = (config.baseUrl ?? baseUrlFromEnv()).replace(/\/+$/, "");
  return baseUrl === DEFAULT_BASE_URL;
}

/**
 * Regional routing is on by default only against MIOSA's own account API. A
 * provider pointed at a custom control plane stays on it unless the caller
 * asks for the regional endpoint, with `runnerMode: true`,
 * MIOSA_RUNNER_MODE=1, or a `runnerBaseDomain` of their own choosing.
 * `runnerMode: false` and MIOSA_RUNNER_MODE=0 always win.
 */
function resolveRunnerRouting(config: MiosaConfig): RunnerRouting | undefined {
  const explicit = config.runnerMode ?? readRunnerModeEnv();
  if (explicit === false) return undefined;
  const asked = explicit === true || config.runnerBaseDomain !== undefined;
  if (!asked && !usesDefaultAccountApi(config)) return undefined;
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
 * True only when the regional endpoint provably refused a create before it
 * provisioned anything, so the account API can serve it without risking a
 * second sandbox:
 * - the request was never sent: the connection could not be opened
 *   (`RunnerConnectError`), the hostname did not resolve, or it resolved to
 *   no runner;
 * - every runner tried answered that it would not admit the create: 429
 *   (`rate_limited`, `runtime_busy`), `feed_stale`, or 401 for a key the
 *   runners have not learned yet. The SDK already moves on to the next
 *   runner address for these and throws once it runs out.
 *
 * Everything else is rethrown by the caller, including a timeout, a reset
 * connection and any 5xx. Those can follow a request the runner received and
 * acted on, and sending the create again could provision a second sandbox.
 */
function refusedBeforeProvisioning(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  // A failed account-API create made for the regional endpoint's sake may
  // have provisioned a sandbox; it is never a regional refusal.
  if (accountApiCreateFailures.has(error)) return false;
  const shaped = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    isRateLimited?: unknown;
    isBusy?: unknown;
    message?: unknown;
  };
  if (shaped.name === "RunnerConnectError") return true;
  if (shaped.name === "RunnerError") {
    if (shaped.isRateLimited === true || shaped.isBusy === true) return true;
    return shaped.status === 429 || shaped.status === 401;
  }
  if (typeof shaped.code === "string" && UNRESOLVED_HOST_CODES.has(shaped.code)) {
    return true;
  }
  return (
    typeof shaped.message === "string" &&
    shaped.message.startsWith("RunnerClient: no runner addresses")
  );
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
  // The account API does not know the create-and-run fields.
  return unwrapSandbox(
    await miosaRequest<unknown>(auth, "POST", "/sandboxes", withoutRun(params)),
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

// Headroom past the command's own server-side timeout for the exec stream
// to finish: the runner enforces `timeout` seconds on the command itself,
// so a stream still open this long after it must be wedged - readiness
// queueing and final drain ride inside the slack.
const RUNNER_EXEC_DRAIN_SLACK_MS = 120_000;

// How long exec waits for a runner sandbox to finish launching. Runner
// create answers while the machine is still coming up (its create result
// reports state "stopped"), and an exec issued mid-launch parks in a
// server-side hold that drops the stream after about a minute - before
// the command ever runs. A fresh sandbox needs the launch window plus a
// margin; a warm one costs this call a single GET.
const RUNNER_READY_WAIT_MS = 180_000;
const RUNNER_READY_POLL_MS = 2_000;

// While a fresh sandbox attaches, the per-sandbox GET answers 404 - a
// keep-waiting signal, but only inside this window. A 404 that outlives it
// means the runner never owned the sandbox (its create went to the account
// API), and the error must surface so exec's catch can route around the
// endpoint instead of stalling here for the whole launch budget.
const RUNNER_NOT_FOUND_GRACE_MS = 30_000;

/**
 * Waits until the runner reports the sandbox ready to exec. While it
 * launches the per-sandbox GET answers 404 (the runner has not attached
 * the sandbox record on its host yet) - a keep-waiting signal only until
 * the attach window is plainly past, when the 404 means "not mine" and
 * rethrows. `stopping`/gone sandboxes throw; anything else unusual
 * surfaces on expiry.
 */
async function waitForRunnerReady(
  client: MiosaRunnerClient,
  sandboxId: string,
  budgetMs: number,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let lastState: string | undefined;
  let notFoundSince: number | undefined;
  for (;;) {
    try {
      const record = await client.get(sandboxId);
      notFoundSince = undefined;
      lastState = record.state;
      if (record.state === "ready") return;
      if (record.state === "stopping" || record.state === "stopped") {
        throw new Error(
          `miosa runner sandbox ${sandboxId} is ${record.state} - not running the command`,
        );
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      lastState = undefined;
      notFoundSince ??= Date.now();
      if (Date.now() - notFoundSince >= RUNNER_NOT_FOUND_GRACE_MS) throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `miosa runner sandbox ${sandboxId} still ${lastState ?? "not provisioned"} after ${Math.round(budgetMs / 1000)}s - never became ready`,
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(RUNNER_READY_POLL_MS, deadline - Date.now())),
    );
  }
}

/**
 * Runs a command on the runner via exec/stream and folds the events into
 * the buffered result shape callers receive.
 *
 * RunnerClient.exec rides on a transport request whose deadline is the
 * SDK's 30s default - exec never overrides it - so every buffered exec
 * dies client-side at 30s no matter what server-side `timeout` it asked
 * for, and any install/build legitimately past that reads as a command
 * failure. exec/stream carries no transport deadline (the request settles
 * on response headers), so it is the only runner exec that can outlive
 * 30s. The caller's own budget still binds: the server-side `timeout`
 * enforces it, and the client deadline here stops a wedged stream at
 * budget + slack.
 */
async function execOnRunner(
  client: MiosaRunnerClient,
  sandboxId: string,
  command: string,
  options?: RunCommandOptions,
): Promise<MiosaExecResult> {
  // A create-then-exec sequence reaches here while the sandbox is still
  // launching; without the wait the exec's stream dies in the server-side
  // hold and the command never runs.
  await waitForRunnerReady(client, sandboxId, RUNNER_READY_WAIT_MS);
  const events = await client.execStream(sandboxId, command, {
    ...(options?.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options?.env !== undefined ? { env: options.env } : {}),
    ...(options?.timeout !== undefined
      ? { timeout: Math.ceil(options.timeout / 1000) }
      : {}),
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | undefined;

  // Server-side exec timeout defaults to 30s when the caller sends none.
  const commandBudgetMs = options?.timeout ?? 30_000;
  const deadline = Date.now() + commandBudgetMs + RUNNER_EXEC_DRAIN_SLACK_MS;
  const iterator = events[Symbol.asyncIterator]();
  const STALLED = Symbol("stalled");
  let stalled = false;
  let eventsSeen = 0;
  let firstUnrecognized: unknown;
  let lastUnrecognized: unknown;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      stalled = true;
      break;
    }
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const raced = await Promise.race([
      iterator.next(),
      new Promise<typeof STALLED>((resolve) => {
        stallTimer = setTimeout(() => resolve(STALLED), remaining);
      }),
    ]);
    if (stallTimer !== undefined) clearTimeout(stallTimer);
    if (raced === STALLED) {
      stalled = true;
      break;
    }
    if (raced.done) break;
    const event = raced.value;
    eventsSeen += 1;
    // Terminal-event shape follows the SDK's normalizeExecEvent: `exit` is
    // the documented type, but a frame carrying an exit code under any
    // other event name, or a bare numeric payload, is the same signal.
    // The runner's real wire shape is flatter than its type declaration:
    // output frames arrive as `{"text": "<chunk>"}` with no channel field
    // (stdout and stderr are merged), so text frames fold into stdout.
    const raw = event as Record<string, unknown>;
    if (typeof raw?.["text"] === "string") {
      stdout.push(raw["text"]);
    } else if (event.type === "stdout") stdout.push(event.line);
    else if (event.type === "stderr") stderr.push(event.line);
    else {
      const code =
        raw?.["exit_code"] ?? raw?.["exitCode"] ?? (typeof raw === "number" ? raw : undefined);
      if (typeof code === "number" && Number.isFinite(code)) {
        exitCode = code;
      } else {
        if (firstUnrecognized === undefined) firstUnrecognized = raw;
        lastUnrecognized = raw;
      }
    }
  }

  if (stalled) {
    stderr.push(
      `runner exec stream did not finish within ${Math.ceil(commandBudgetMs / 1000)}s + drain slack\n`,
    );
  } else if (exitCode === undefined) {
    // The stream closed without an exit event - the server dropped the
    // command mid-run, so it cannot report success.
    const tail =
      lastUnrecognized === undefined
        ? ""
        : ` last event: ${JSON.stringify(lastUnrecognized).slice(0, 300)}`;
    stderr.push(
      `runner exec stream ended without an exit event after ${eventsSeen} event(s)${tail}\n`,
    );
  } else if (exitCode !== 0 && firstUnrecognized !== undefined) {
    // A failed command whose output frames arrived in a shape the fold
    // does not recognize - surface the wire shape for diagnosis.
    stderr.push(
      `runner stream events unrecognized: first=${JSON.stringify(firstUnrecognized).slice(0, 200)} last=${JSON.stringify(lastUnrecognized).slice(0, 200)}\n`,
    );
  }
  // `line` is a raw output chunk (it carries its own newline), so the fold
  // is plain concatenation - the same fold the SDK's own client uses.
  return {
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    exit_code: exitCode ?? 127,
  };
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

/** The control plane and the runner both refuse a destroy while another
 * lifecycle operation (create, exec, stop, snapshot) is still running on
 * the sandbox. The refusal comes back as code/message `SANDBOX_BUSY` on
 * either error class - distinct from the runner's admission `runtime_busy`
 * (see RunnerError.isBusy), which is about capacity, not this sandbox. */
function isSandboxBusyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const shaped = error as { code?: unknown; message?: unknown };
  return (
    (typeof shaped.code === "string" &&
      shaped.code.startsWith("SANDBOX_BUSY")) ||
    (typeof shaped.message === "string" &&
      shaped.message.includes("SANDBOX_BUSY"))
  );
}

// How long destroy waits for an in-flight lifecycle operation to release
// the sandbox before reporting the refusal. SANDBOX_BUSY means the destroy
// was refused, not attempted: a short bounded retry turns a drain window
// into a clean teardown instead of a leaked sandbox.
const DESTROY_BUSY_BUDGET_MS = 60_000;
const DESTROY_BUSY_INTERVAL_MS = 2_000;

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

/**
 * True when this sandbox is recorded as living on the regional endpoint.
 * Regionally-created sandboxes are unknown to the account API - it answers
 * 404 for their /sandboxes/:id/fs routes - and the regional endpoint exposes
 * no fs routes, so filesystem methods must be composed over exec, the same
 * reason `exists` is `test -e` rather than an API round-trip. A handle whose
 * origin was never recorded tries the account API first - cheaper than an
 * exec round-trip for the account-owned case - and falls back to exec on a
 * 404 (a reattached regional sandbox), mirroring exec's own origin learning.
 */
function usesRegionalTransport(sandbox: MiosaSandbox): boolean {
  return sandboxTransport.get(sandbox.record.id) === "regional";
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

function toStatus(state: string | null | undefined): InstanceInfo["status"] {
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

  // Errors from creating the sandbox are create errors, not command results:
  // they are thrown, as an eager create() would have thrown them.
  if (sandbox.lazy) {
    const first = await runFirstCommand(sandbox, command, options, startTime);
    if (first) return first;
  }

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
        // Streamed, not buffered: the buffered exec dies on the transport's
        // 30s request deadline whatever the command's own timeout is.
        result = await execOnRunner(
          client,
          sandbox.record.id,
          fullCommand,
          options,
        );
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
        const response = await miosaRequest<{ data: MiosaExecResult }>(
          sandbox,
          "POST",
          `/sandboxes/${sandbox.record.id}/exec`,
          body,
        );
        // The account API answering is what proves it owns the sandbox: a
        // regional sandbox still attaching 404s on the runner too, so
        // caching "account" on that signal alone would misroute every later
        // command on this handle even after the sandbox attaches. If this
        // request 404s as well nothing is learned - the handle stays on the
        // runner and a later command can succeed once attach completes.
        sandboxTransport.set(sandbox.record.id, "account");
        sandbox.runner = undefined;
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

// ── Creating a sandbox ──────────────────────────────────────────────────────

/**
 * Creates the sandbox on the regional endpoint, or on the account API when
 * the regional endpoint is off or provably refused it (see
 * refusedBeforeProvisioning). The one place a create is sent, so the eager
 * and lazy paths cannot diverge.
 */
async function createSandboxRecord(
  auth: MiosaAuth,
  body: Record<string, unknown>,
): Promise<CreatedSandbox> {
  if (auth.runner) {
    try {
      const created = await (await getRunnerClient(auth)).createSandbox(body);
      const run = readRun(created.data);
      return {
        record: withoutRun(unwrapSandbox(created.data)) as MiosaSandboxRecord,
        // The SDK reports an empty runnerUrl for a create it handed to the
        // account API.
        servedByAccountApi: !created.runnerUrl,
        ...(run ? { run } : {}),
      };
    } catch (error) {
      // An unreachable regional endpoint, or one with no capacity for this
      // create, is not a create failure: nothing was provisioned, so the
      // account API can still serve it. Deliberately narrow - anything that
      // may follow an existing sandbox is rethrown, because retrying there
      // would provision a second one.
      if (!refusedBeforeProvisioning(error)) throw error;
    }
  }
  return {
    record: await createSandboxOnAccountApi(auth, body),
    servedByAccountApi: true,
  };
}

/**
 * Records where a created sandbox lives and returns the credentials its
 * handle must carry: a sandbox on the account API keeps using it, so its
 * exec and destroy never address the regional endpoint for a sandbox that
 * endpoint does not own.
 */
function settleCreated(auth: MiosaAuth, created: CreatedSandbox): MiosaAuth {
  if (!created.record.id) {
    throw new Error("MIOSA create sandbox returned a record without an id");
  }
  sandboxTransport.set(
    created.record.id,
    created.servedByAccountApi ? "account" : "regional",
  );
  return created.servedByAccountApi
    ? { apiKey: auth.apiKey, baseUrl: auth.baseUrl }
    : auth;
}

// ── Lazy creation ───────────────────────────────────────────────────────────
//
// With `lazyCreate` on, create() hands back a handle and sends nothing. The
// handle's create happens on first use (see lazy-create.ts for the wire
// contract). Handles are found again by their placeholder id, because the
// operations that only receive an id - getById, destroy, snapshots - have no
// handle to look at.

/**
 * Lazy handles by credential and placeholder id, kept for as long as the
 * framework may still call back with that id, which is until the sandbox is
 * destroyed. A handle that is created, used and never destroyed stays here,
 * as its sandbox stays on the server.
 *
 * The credential is part of the key, as it is for the snapshot index: a
 * process serving several tenants must never let one tenant's id reach
 * another tenant's handle, to create it, cancel it or snapshot it.
 */
const lazyHandles = new Map<string, MiosaSandbox>();

function lazyHandleKey(apiKey: string, placeholder: string): string {
  return `${apiKey}:${placeholder}`;
}

function readLazyCreateEnv(): boolean {
  const raw =
    typeof process !== "undefined" ? process.env?.[LAZY_CREATE_ENV] : undefined;
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  return normalised === "1" || normalised === "true";
}

function lazyCreateEnabled(config: MiosaConfig, auth: MiosaAuth): boolean {
  // Create-and-run is a regional endpoint feature; without it a deferred
  // create would only move the same request later, so keep it eager.
  return auth.runner !== undefined && (config.lazyCreate ?? readLazyCreateEnv());
}

function placeholderRecord(id: string): MiosaSandboxRecord {
  return {
    id,
    slug: id,
    name: null,
    state: "pending",
    template_id: null,
    cpu_count: null,
    memory_mb: null,
    timeout_sec: null,
    metadata: null,
    preview_url: null,
    preview_domain: null,
    created_at: new Date().toISOString(),
  };
}

function newLazySandbox(
  auth: MiosaAuth,
  body: Record<string, unknown>,
): MiosaSandbox {
  const id = placeholderId();
  const sandbox: MiosaSandbox = {
    record: placeholderRecord(id),
    ...auth,
  };
  sandbox.lazy = {
    id,
    create: new LazyCreate<CreatedSandbox>(async (run) => {
      let created: CreatedSandbox;
      try {
        created = await createSandboxRecord(
          auth,
          run ? withRun(body, run) : body,
        );
      } catch (error) {
        // The runner refused the command and created nothing.
        if (run && isRunRefusal(error)) throw new RunRefused(error);
        throw error;
      }
      const handleAuth = settleCreated(auth, created);
      // Fill the handle in place: the framework and the caller hold this
      // object, and every later call must see the real sandbox.
      sandbox.record = created.record;
      sandbox.apiKey = handleAuth.apiKey;
      sandbox.baseUrl = handleAuth.baseUrl;
      if (handleAuth.runner) sandbox.runner = handleAuth.runner;
      else delete sandbox.runner;
      return created;
    }),
  };
  lazyHandles.set(lazyHandleKey(auth.apiKey, id), sandbox);
  return sandbox;
}

/**
 * Makes sure the sandbox behind `sandbox` exists, creating it if this is
 * the first use. Rejects with the create's own error. A no-op for a handle
 * that was never lazy.
 */
async function ensureCreated(sandbox: MiosaSandbox): Promise<void> {
  if (sandbox.lazy) await sandbox.lazy.create.begin().result;
}

/** The real id behind an id the caller may have got from a lazy handle. */
async function resolveSandboxId(
  apiKey: string,
  sandboxId: string,
): Promise<string> {
  if (!isPlaceholderId(sandboxId)) return sandboxId;
  const sandbox = lazyHandles.get(lazyHandleKey(apiKey, sandboxId));
  if (!sandbox) return sandboxId;
  await ensureCreated(sandbox);
  return sandbox.record.id;
}

/**
 * The first command of a lazy sandbox. Returns its result when the create
 * request ran it, and undefined when the sandbox now exists but the command
 * still has to be sent the ordinary way: another call created it first, the
 * command needs options the create request cannot carry, or the endpoint
 * answered a plain create. Rejects with the create's own error.
 */
async function runFirstCommand(
  sandbox: MiosaSandbox,
  command: string,
  options: RunCommandOptions | undefined,
  startTime: number,
): Promise<CommandResult | undefined> {
  const lazy = sandbox.lazy;
  if (!lazy) return undefined;
  const run: RunSpec | undefined = canRunInCreate(options)
    ? {
        command,
        ...(options?.timeout !== undefined ? { timeoutMs: options.timeout } : {}),
      }
    : undefined;
  const { starter, result } = lazy.create.begin(run);
  let created: CreatedSandbox;
  try {
    created = await result;
  } catch (error) {
    // The runner refused the command and created nothing. Report it as an
    // exec refusal is reported: a failed command, not a create error. The
    // handle is untouched and a later call creates the sandbox as usual.
    if (error instanceof RunRefused) {
      return {
        stdout: "",
        stderr: error.message,
        exitCode: 127,
        durationMs: Date.now() - startTime,
      };
    }
    throw error;
  }
  // Only the call that started the create asked for its command to run in it.
  if (!starter || !created.run) return undefined;
  if (created.run.error !== undefined) {
    // The command produced no result (deadline, spawn failure). The sandbox
    // exists and the command has been tried; do not run it again.
    return {
      stdout: created.run.stdout,
      stderr: created.run.error,
      exitCode: 127,
      durationMs: created.run.durationMs ?? Date.now() - startTime,
    };
  }
  return {
    stdout: created.run.stdout,
    stderr: created.run.stderr,
    exitCode: created.run.exitCode ?? 0,
    durationMs: created.run.durationMs ?? Date.now() - startTime,
  };
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
    instances: {
      create: async (config: MiosaConfig, options?: CreateInstanceOptions) => {
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

        if (lazyCreateEnabled(config, auth)) {
          const sandbox = newLazySandbox(auth, body);
          return { instance: sandbox, instanceId: sandbox.record.id };
        }

        const created = await createSandboxRecord(auth, body);
        const handleAuth = settleCreated(auth, created);
        return {
          instance: { record: created.record, ...handleAuth },
          instanceId: created.record.id,
        };
      },

      getById: async (config: MiosaConfig, requestedId: string) => {
        const auth = resolveAuth(config);
        // A lazy handle's placeholder id names no sandbox yet. Looking it up
        // creates the sandbox first, so the caller gets a real one.
        const sandboxId = await resolveSandboxId(auth.apiKey, requestedId);
        try {
          const payload = await miosaRequest<unknown>(
            auth,
            "GET",
            `/sandboxes/${sandboxId}`,
          );
          const record = unwrapSandbox(payload);
          return {
            instance: { record, ...handleAuthFor(config, auth, record.id) },
            instanceId: record.id,
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
          instance: { record, ...handleAuthFor(config, auth, record.id) },
          instanceId: record.id,
        }));
      },

      destroy: async (config: MiosaConfig, requestedId: string) => {
        const auth = resolveAuth(config);

        // A lazy sandbox that was never used does not exist, so there is
        // nothing to destroy and no request to send. One whose create ran,
        // or is running, is destroyed by its real id.
        let sandboxId = requestedId;
        const lazyKey = lazyHandleKey(auth.apiKey, requestedId);
        const lazy = lazyHandles.get(lazyKey)?.lazy;
        if (lazy) {
          // Cancelled first, in the same synchronous step as the check below:
          // from here no call can start a create, including a call that was
          // waiting on a create the runner refused and would now start its
          // own. Whatever create is already running is the last one.
          lazy.create.cancel();
          if (!lazy.create.started) {
            lazyHandles.delete(lazyKey);
            return;
          }
          const created = await lazy.create.settled();
          // The create failed or was refused: nothing exists to destroy.
          if (!created) {
            lazyHandles.delete(lazyKey);
            return;
          }
          sandboxId = created.record.id;
        }
        const known = sandboxTransport.get(sandboxId);

        const destroyOnAccountApi = () =>
          miosaRequest<unknown>(auth, "DELETE", `/sandboxes/${sandboxId}`);
        const destroyOnRegionalEndpoint = async (): Promise<void> => {
          await (
            await getRunnerClient(regionalAuth(config, auth))
          ).destroySandbox(sandboxId);
        };
        // Resolves true only when the endpoint answered 404, meaning it never
        // had this sandbox - which says nothing about the other endpoint. A
        // SANDBOX_BUSY refusal retries inside the shared busy budget: the
        // busy window is sandbox-scoped, not endpoint-scoped, so the budget
        // is wall-clock across whichever endpoints get tried.
        const busyDeadline = Date.now() + DESTROY_BUSY_BUDGET_MS;
        const missing = async (run: () => Promise<unknown>): Promise<boolean> => {
          for (;;) {
            try {
              await run();
              return false;
            } catch (error) {
              if (isNotFoundError(error)) return true;
              if (!isSandboxBusyError(error) || Date.now() >= busyDeadline) {
                throw error;
              }
              await new Promise((resolve) =>
                setTimeout(resolve, DESTROY_BUSY_INTERVAL_MS),
              );
            }
          }
        };

        // Address only the endpoint recorded at create time - a regional
        // sandbox stays on the regional endpoint even if runnerMode has been
        // turned off since, because the account API cannot delete it. An id
        // this process never created - one made in another process, or before
        // a restart - has no entry, so a 404 from either endpoint is not
        // conclusive on its own and both are tried; the account API goes
        // first because it is the registry.
        //
        // That holds with runnerMode off too: opting out stops new sandboxes
        // being created regionally, it does not make an older regional
        // sandbox disappear from the account API's 404. The one exception is a
        // custom control plane, whose key the public regional endpoint has no
        // business seeing.
        if (known === "regional") {
          await missing(destroyOnRegionalEndpoint);
        } else if (known === "account") {
          await missing(destroyOnAccountApi);
        } else if (await missing(destroyOnAccountApi)) {
          if (auth.runner !== undefined || auth.baseUrl === DEFAULT_BASE_URL) {
            await missing(destroyOnRegionalEndpoint);
          }
        }

        // Reaching here means the sandbox was deleted or is confirmed absent,
        // so its entry can go. A transient failure throws above and keeps it:
        // clearing it then would send the retry to the other endpoint, where
        // a 404 reads as "already destroyed" while the sandbox still runs.
        sandboxTransport.delete(sandboxId);
        lazyHandles.delete(lazyKey);
      },

      runCommand: execInSandbox,

      getInfo: async (sandbox: MiosaSandbox): Promise<InstanceInfo> => {
        await ensureCreated(sandbox);
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
        await ensureCreated(sandbox);
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

      attachVolume: async (sandbox, volume, mountPath) => {
        // Volume calls always go to the account API, never the regional
        // endpoint. A lazy handle has to exist before it can name a computer.
        await ensureCreated(sandbox);
        const auth = { apiKey: sandbox.apiKey, baseUrl: sandbox.baseUrl };
        const ref = resolveVolumeRef(volume);
        // Volumes attach to "computers" — the sandbox record carries a
        // computer_id (untyped in @miosa/sdk's SandboxData). The sandbox id
        // itself is not a computer id: POSTing it 404s "computer not found",
        // so fail clearly instead of making an impossible request.
        const computerId = (sandbox.record as { computer_id?: string }).computer_id;
        if (!computerId) {
          throw new Error(
            `Miosa volumes attach to computers, not sandboxes — sandbox ${sandbox.record.id} has no computer_id`
          );
        }
        await miosaRequest(auth, "POST", `/computers/${computerId}/volumes`, {
          volume_id: ref.id ?? ref.name,
          mount_path: mountPath,
        });
      },
      detachVolume: async (sandbox, volume, mountPath) => {
        // Volume calls always go to the account API, never the regional
        // endpoint. A lazy handle has to exist before it can name a computer.
        await ensureCreated(sandbox);
        const auth = { apiKey: sandbox.apiKey, baseUrl: sandbox.baseUrl };
        const ref = resolveVolumeRef(volume);
        const computerId = (sandbox.record as { computer_id?: string }).computer_id;
        if (!computerId) {
          throw new Error(
            `Miosa volumes attach to computers, not sandboxes — sandbox ${sandbox.record.id} has no computer_id`
          );
        }
        await miosaRequest(auth, "DELETE", `/computers/${computerId}/volumes/${ref.id ?? ref.name}`);
      },

      filesystem: {
        // Native: GET /sandboxes/:id/fs/read?path=…  → { path, content }
        // Regional sandboxes go over exec instead: the account API answers
        // 404 for their /sandboxes/:id/fs routes and the regional endpoint
        // exposes no fs routes at all.
        readFile: async (
          sandbox: MiosaSandbox,
          path: string,
          runCommand: (
            sandbox: MiosaSandbox,
            command: string,
            options?: RunCommandOptions,
          ) => Promise<CommandResult>,
        ): Promise<string> => {
          await ensureCreated(sandbox);
          const overExec = async (): Promise<string> => {
            const result = await runCommand(
              sandbox,
              `cat "${escapeShellArg(path)}"`,
            );
            if (result.exitCode !== 0)
              throw new Error(
                `MIOSA readFile failed for ${path}: ${result.stderr || `exit ${result.exitCode}`}`,
              );
            return result.stdout;
          };
          if (usesRegionalTransport(sandbox)) return overExec();
          try {
            const response = await miosaRequest<{ content: string }>(
              sandbox,
              "GET",
              `/sandboxes/${sandbox.record.id}/fs/read?path=${encodeURIComponent(path)}`,
            );
            return response.content;
          } catch (error) {
            // A handle for a sandbox the account API does not own - a
            // regional sandbox reattached with no recorded origin - 404s
            // here; serve the read over exec instead.
            if (isNotFoundError(error)) return overExec();
            throw error;
          }
        },

        // Native: POST /sandboxes/:id/fs/write  { path, content }
        writeFile: async (
          sandbox: MiosaSandbox,
          path: string,
          content: string,
          runCommand: (
            sandbox: MiosaSandbox,
            command: string,
            options?: RunCommandOptions,
          ) => Promise<CommandResult>,
        ): Promise<void> => {
          await ensureCreated(sandbox);
          const overExec = async (): Promise<void> => {
            // base64 round-trip so arbitrary content needs no shell escaping.
            const b64 = Buffer.from(content, "utf8").toString("base64");
            const result = await runCommand(
              sandbox,
              `printf '%s' "${b64}" | base64 -d > "${escapeShellArg(path)}"`,
            );
            if (result.exitCode !== 0)
              throw new Error(
                `MIOSA writeFile failed for ${path}: ${result.stderr || `exit ${result.exitCode}`}`,
              );
          };
          if (usesRegionalTransport(sandbox)) return overExec();
          try {
            await miosaRequest<unknown>(
              sandbox,
              "POST",
              `/sandboxes/${sandbox.record.id}/fs/write`,
              {
                path,
                content,
              },
            );
          } catch (error) {
            if (isNotFoundError(error)) return overExec();
            throw error;
          }
        },

        // Native: POST /sandboxes/:id/fs/mkdir  { path, recursive }
        mkdir: async (
          sandbox: MiosaSandbox,
          path: string,
          runCommand: (
            sandbox: MiosaSandbox,
            command: string,
            options?: RunCommandOptions,
          ) => Promise<CommandResult>,
        ): Promise<void> => {
          await ensureCreated(sandbox);
          const overExec = async (): Promise<void> => {
            const result = await runCommand(
              sandbox,
              `mkdir -p "${escapeShellArg(path)}"`,
            );
            if (result.exitCode !== 0)
              throw new Error(
                `MIOSA mkdir failed for ${path}: ${result.stderr || `exit ${result.exitCode}`}`,
              );
          };
          if (usesRegionalTransport(sandbox)) return overExec();
          try {
            await miosaRequest<unknown>(
              sandbox,
              "POST",
              `/sandboxes/${sandbox.record.id}/fs/mkdir`,
              {
                path,
                recursive: true,
              },
            );
          } catch (error) {
            if (isNotFoundError(error)) return overExec();
            throw error;
          }
        },

        // Native: GET /sandboxes/:id/fs?path=…  → { files: [{name, type, size_bytes, modified_at}] }
        readdir: async (
          sandbox: MiosaSandbox,
          path: string,
          runCommand: (
            sandbox: MiosaSandbox,
            command: string,
            options?: RunCommandOptions,
          ) => Promise<CommandResult>,
        ): Promise<FileEntry[]> => {
          await ensureCreated(sandbox);
          const overExec = async (): Promise<FileEntry[]> => {
            const result = await runCommand(
              sandbox,
              `ls -la "${escapeShellArg(path)}"`,
            );
            if (result.exitCode !== 0)
              throw new Error(
                `MIOSA readdir failed for ${path}: ${result.stderr || `exit ${result.exitCode}`}`,
              );
            const entries: FileEntry[] = [];
            for (const line of result.stdout.split("\n")) {
              const parts = line.trim().split(/\s+/);
              // Skip the "total" line, malformed rows, and . / ..
              if (parts.length < 9 || !/^[-dl]/.test(parts[0])) continue;
              let name = parts.slice(8).join(" ");
              if (parts[0].startsWith("l")) name = name.split(" -> ")[0];
              if (name === "." || name === "..") continue;
              // ls prints "Mmm dd HH:MM" for recent files (no year) and
              // "Mmm dd YYYY" otherwise.
              const [month, day, timeOrYear] = parts.slice(5, 8);
              const dateStr = timeOrYear.includes(":")
                ? `${month} ${day} ${new Date().getFullYear()} ${timeOrYear}`
                : `${month} ${day} ${timeOrYear}`;
              const modified = new Date(dateStr);
              entries.push({
                name,
                type: parts[0].startsWith("d")
                  ? ("directory" as const)
                  : ("file" as const),
                size: Number(parts[4]) || 0,
                modified: isNaN(modified.getTime())
                  ? new Date(0)
                  : modified,
              });
            }
            return entries;
          };
          if (usesRegionalTransport(sandbox)) return overExec();
          try {
            const response = await miosaRequest<{
              files: MiosaFileListEntry[];
            }>(
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
          } catch (error) {
            if (isNotFoundError(error)) return overExec();
            throw error;
          }
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
        remove: async (
          sandbox: MiosaSandbox,
          path: string,
          runCommand: (
            sandbox: MiosaSandbox,
            command: string,
            options?: RunCommandOptions,
          ) => Promise<CommandResult>,
        ): Promise<void> => {
          await ensureCreated(sandbox);
          const overExec = async (): Promise<void> => {
            const result = await runCommand(
              sandbox,
              `rm -rf "${escapeShellArg(path)}"`,
            );
            if (result.exitCode !== 0)
              throw new Error(
                `MIOSA remove failed for ${path}: ${result.stderr || `exit ${result.exitCode}`}`,
              );
          };
          if (usesRegionalTransport(sandbox)) return overExec();
          try {
            await miosaRequest<unknown>(
              sandbox,
              "DELETE",
              `/sandboxes/${sandbox.record.id}/fs?path=${encodeURIComponent(path)}`,
            );
          } catch (error) {
            if (isNotFoundError(error)) return overExec();
            throw error;
          }
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
        sandboxId = await resolveSandboxId(auth.apiKey, sandboxId);
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
        const ownerId = await resolveSandboxId(auth.apiKey, options.sandboxId);
        const response = await miosaRequest<{ data: MiosaSnapshotRecord[] }>(
          auth,
          "GET",
          `/sandboxes/${ownerId}/snapshots`,
        );
        const records = response.data ?? [];
        for (const record of records) {
          // The listing is already scoped to this sandbox, so that is the
          // owner even when the record itself omits sandbox_id. Recording it
          // unconditionally is what lets a later delete() skip the scan.
          const owner = record?.sandbox_id ?? ownerId;
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

    volume: {
      create: async (config: MiosaConfig, options) => {
        const auth = resolveAuth(config);
        const created = await miosaRequest<any>(auth, "POST", "/volumes", {
          name: options.name,
          backend: "local",
          // MIOSA 422s on a missing size_bytes — floor at 1 GiB when the
          // caller doesn't specify one.
          size_bytes: options.sizeBytes ?? 1_073_741_824,
        });
        const v = created?.volume ?? created;
        return { id: v?.id, name: v?.name ?? options.name, native: v };
      },
      get: async (config: MiosaConfig, id: string) => {
        const auth = resolveAuth(config);
        try {
          const res = await miosaRequest<any>(auth, "GET", `/volumes/${id}`);
          const v = res?.volume ?? res;
          return v ? { id: v.id ?? id, name: v.name, native: v } : null;
        } catch { return null; }
      },
      list: async (config: MiosaConfig) => {
        const auth = resolveAuth(config);
        const res = await miosaRequest<any>(auth, "GET", "/volumes");
        const items = res?.volumes ?? res ?? [];
        return (items as any[]).map((v) => ({ id: v.id, name: v.name, native: v }));
      },
      delete: async (config: MiosaConfig, id: string) => {
        const auth = resolveAuth(config);
        await withVolumeSettle(() => miosaRequest(auth, "DELETE", `/volumes/${id}`));
      },
    }
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
