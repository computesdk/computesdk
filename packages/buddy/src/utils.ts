/**
 * Shared types, config resolution and SDK plumbing for the Buddy provider.
 *
 * All API access goes through `@buddy-works/sandbox-sdk`. The provider uses the
 * SDK's `BuddyApiClient` rather than its high-level `Sandbox` façade for sandbox
 * creation: `Sandbox.create()` waits for `setup_status: SUCCESS` and
 * `status: RUNNING` with a 1 s poll, and since a sandbox from Buddy's warm pool
 * is usable in ~400 ms that wait would dominate time-to-first-command. The
 * façade's `Command`, `FileSystem` and snapshot helpers are used as-is.
 */

import { API_URLS, BuddyApiClient, FileSystem } from '@buddy-works/sandbox-sdk';

export const PROVIDER = 'buddy' as const;
export const DEFAULT_OS = 'ubuntu:24.04';
export const DEFAULT_REGION: BuddyRegion = 'US';
/** Buddy stops a sandbox after this many ms of life unless overridden. */
export const DEFAULT_TIMEOUT_MS = 3_600_000;
/** Working directory of the default `buddy` user — relative paths resolve here. */
export const SANDBOX_HOME = '/buddy';

/**
 * Buddy installation, in the spelling its tunnel API uses. Each installation is
 * a separate deployment with its own API host, workspaces and tokens — `US` is
 * not a placement hint within one API.
 */
export type BuddyRegion = 'US' | 'EU';

/** Interpreter Buddy runs a command with. `BASH` is the default. */
export type BuddyCommandRuntime = 'BASH' | 'JAVASCRIPT' | 'TYPESCRIPT' | 'PYTHON';

/** Tunnel protocol. Only `HTTP` yields a public `endpoint_url`. */
export type BuddyTunnelType = 'HTTP' | 'TLS' | 'TCP' | 'SSH';

/**
 * Buddy resource preset, `"{vCPU}x{RAM in GB}"`. RAM is always 2 GB per vCPU.
 */
export type BuddyResources =
  | '1x2' | '2x4' | '3x6' | '4x8' | '5x10' | '6x12'
  | '7x14' | '8x16' | '9x18' | '10x20' | '11x22' | '12x24';

export const MAX_CPU = 12;

/** A port to expose publicly. A bare number means `{ port, type: 'HTTP' }`. */
export interface BuddyPort {
  port: number;
  /** Tunnel name. Becomes the first label of the public hostname. */
  name?: string;
  type?: BuddyTunnelType;
  region?: BuddyRegion;
}

export type BuddyPortInput = number | BuddyPort;

export interface BuddyConfig {
  /** API token with the `SANDBOX_MANAGE` scope. Falls back to `BUDDY_TOKEN`. */
  token?: string;
  /** Workspace domain. Falls back to `BUDDY_WORKSPACE`. */
  workspace?: string;
  /** Project the sandboxes belong to. Falls back to `BUDDY_PROJECT`. */
  project?: string;
  /** Base OS image — `'ubuntu:24.04'` (default) or `'ubuntu:22.04'`. */
  os?: string;
  /** Resource preset. Buddy's own default applies when omitted. */
  resources?: BuddyResources;
  /**
   * Buddy installation to use. Selects both the API host and where tunnels
   * terminate. Defaults to `'US'`. A token is only valid on its own
   * installation.
   */
  region?: BuddyRegion;
  /** Sandbox lifetime in milliseconds, after which Buddy stops it. */
  timeout?: number;
  /** Ports to expose on every sandbox this provider creates. */
  ports?: BuddyPortInput[];
  /** API base URL. Overrides `region` — set it for on-premise installations. */
  apiUrl?: string;
}

/** Config after env-var fallbacks and validation — what the methods receive. */
export interface ResolvedBuddyConfig {
  token: string;
  workspace: string;
  project: string;
  os: string;
  resources?: BuddyResources;
  region: BuddyRegion;
  timeout: number;
  ports?: BuddyPortInput[];
  apiUrl: string;
}

const SETUP_HINT =
  'Create a token with the SANDBOX_MANAGE scope at ' +
  'https://app.buddy.works/my-id/tokens';

/** The SDK's API host table is keyed by the same region names we use. */
export function apiUrlForRegion(region: BuddyRegion): string {
  return API_URLS[region];
}

/**
 * One resolved config per config object handed to `buddy()`. The provider
 * methods each receive the raw config, and resolving it to a stable object is
 * what lets the SDK client below be reused across calls — a fresh client per
 * call would give up Node's keep-alive connections between `create` and the
 * first command.
 */
const resolved = new WeakMap<BuddyConfig, ResolvedBuddyConfig>();
/**
 * `buddy()` with no config reads the environment on every call, so a token
 * rotated in `process.env` is picked up; the result is cached by value so the
 * SDK client (and its connection pool) is still shared while nothing changed.
 */
const resolvedFromEnv = new Map<string, ResolvedBuddyConfig>();

export function resolveConfig(config?: BuddyConfig): ResolvedBuddyConfig {
  if (!config) {
    const key = [
      process.env.BUDDY_TOKEN, process.env.BUDDY_WORKSPACE, process.env.BUDDY_PROJECT,
    ].join('\u0000');
    let value = resolvedFromEnv.get(key);
    if (!value) {
      value = buildConfig({});
      resolvedFromEnv.clear();
      resolvedFromEnv.set(key, value);
    }
    return value;
  }
  const cached = resolved.get(config);
  if (cached) return cached;
  const value = buildConfig(config);
  resolved.set(config, value);
  return value;
}

function buildConfig(config: BuddyConfig): ResolvedBuddyConfig {
  const token = config.token ?? process.env.BUDDY_TOKEN;
  const workspace = config.workspace ?? process.env.BUDDY_WORKSPACE;
  const project = config.project ?? process.env.BUDDY_PROJECT;

  if (!token) {
    throw new Error(
      'Missing Buddy API token.\n\n' +
      `${SETUP_HINT}\n` +
      'Then pass it: buddy({ token: "xxx" })\n' +
      'Or set BUDDY_TOKEN in your environment.',
    );
  }
  if (!workspace) {
    throw new Error(
      'Missing Buddy workspace domain.\n\n' +
      'It is the workspace segment of your Buddy URL ' +
      '(https://app.buddy.works/<workspace>/...).\n' +
      'Pass it: buddy({ workspace: "my-workspace" }) or set BUDDY_WORKSPACE.',
    );
  }
  if (!project) {
    throw new Error(
      'Missing Buddy project name.\n\n' +
      'Sandboxes always belong to a project. Create one in the Buddy UI, then\n' +
      'pass it: buddy({ project: "my-project" }) or set BUDDY_PROJECT.',
    );
  }

  const region = config.region ?? DEFAULT_REGION;

  return {
    token,
    workspace,
    project,
    os: config.os ?? DEFAULT_OS,
    resources: config.resources,
    region,
    timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
    ports: config.ports,
    apiUrl: (config.apiUrl ?? apiUrlForRegion(region)).replace(/\/+$/, ''),
  };
}

/**
 * One SDK client per resolved config. Reusing it matters: creating a sandbox
 * and running the first command is several round trips, and a shared client
 * keeps Node's connection pool warm across them.
 */
const clients = new WeakMap<ResolvedBuddyConfig, BuddyApiClient>();

/**
 * Per-request timeout for the SDK client. Its default is 30 s, which is too
 * short for `POST /commands`: Buddy holds that request until the sandbox has
 * booted, and a drained warm pool has been measured to take over 10 s. On a
 * timeout the SDK retries the POST, which would submit the command twice.
 */
export const CLIENT_REQUEST_TIMEOUT_MS = 120_000;

export function getClient(config: ResolvedBuddyConfig): BuddyApiClient {
  let client = clients.get(config);
  if (!client) {
    client = new BuddyApiClient({
      workspace: config.workspace,
      project_name: config.project,
      apiUrl: config.apiUrl,
      token: config.token,
      timeout: CLIENT_REQUEST_TIMEOUT_MS,
    });
    clients.set(config, client);
  }
  return client;
}

/**
 * HTTP status behind an SDK error. `BuddySDKError` carries `statusCode`; the
 * lower-level `HttpError` the raw client throws carries `status` and is not
 * exported, so both are read structurally.
 */
export function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { statusCode?: unknown; status?: unknown };
  const status = candidate.statusCode ?? candidate.status;
  return typeof status === 'number' && status > 0 ? status : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isNotFound(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 404) return true;
  // The content endpoints answer 400 "Path not find in browser" for a missing
  // path instead of 404, so the message has to be inspected as well.
  return status === 400 && /not (found|find)/i.test(messageOf(error));
}

/**
 * Buddy sandbox ids are fixed-length, so an id of any other shape never reaches
 * the handler and comes back as 400 "Invalid url" rather than 404. For a lookup
 * both answers mean the same thing: no such sandbox.
 */
export function isUnroutableId(error: unknown): boolean {
  return statusOf(error) === 400 && /invalid url/i.test(messageOf(error));
}

/**
 * A sandbox that has not finished booting yet. Commands submitted to a
 * `STARTING` sandbox are queued by Buddy, but the `content/` and `download/`
 * endpoints reject outright with 400 "Instance is not running" — measured to
 * last up to ~8 s when the warm pool is drained.
 */
export function isInstanceNotRunning(error: unknown): boolean {
  return statusOf(error) === 400 && /instance is not running/i.test(messageOf(error));
}

/**
 * A sandbox with a lifecycle operation in flight. Buddy rejects configuration
 * changes, including opening a tunnel, until the boot or snapshot finishes.
 */
export function isOperationInProgress(error: unknown): boolean {
  return statusOf(error) === 400 && /operation in progress/i.test(messageOf(error));
}

export function isAuthError(error: unknown): boolean {
  const status = statusOf(error);
  return status === 401 || status === 403;
}

/** Resolves a caller-supplied path to an absolute one and collapses slashes. */
export function normalizeSandboxPath(path: string): string {
  const absolute = path.startsWith('/') ? path : `${SANDBOX_HOME}/${path}`;
  const segments = absolute.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('Path must not be empty or the filesystem root.');
  }
  return `/${segments.join('/')}`;
}

/**
 * The SDK takes content paths as a single URL segment it encodes itself, with
 * no leading slash — a leading slash produces an empty segment and a 400 from
 * the gateway.
 */
export function toContentPath(path: string): string {
  return normalizeSandboxPath(path).slice(1);
}

export type SandboxStatus = 'running' | 'stopped' | 'error';

/**
 * Buddy exposes more states than ComputeSDK. `STARTING` and `RESTORING` map to
 * `running` on purpose: the API queues commands submitted against a sandbox in
 * those states, so it is already usable.
 */
export function mapStatus(status: string | undefined): SandboxStatus {
  switch (status) {
    case 'RUNNING':
    case 'STARTING':
    case 'RESTORING':
      return 'running';
    case 'STOPPED':
    case 'STOPPING':
      return 'stopped';
    case 'FAILED':
      return 'error';
    default:
      return 'stopped';
  }
}

/**
 * Picks a resource preset from the cross-provider `cpu`/`memory` knobs.
 * Buddy only offers `N` vCPU with `2N` GB RAM, so whichever request is larger
 * wins and the result is clamped to the largest preset.
 */
export function resolveResources(
  options: Record<string, unknown> = {},
  fallback?: BuddyResources,
): BuddyResources | undefined {
  if (typeof options.resources === 'string') return options.resources as BuddyResources;

  const requestedCpu = firstPositiveNumber([options.cpu, options.vcpus, options.cpus]);
  const requestedMemoryGb = memoryToGb(options);
  if (requestedCpu === undefined && requestedMemoryGb === undefined) return fallback;

  const cpuForMemory = requestedMemoryGb === undefined ? 0 : Math.ceil(requestedMemoryGb / 2);
  const cpu = Math.min(MAX_CPU, Math.max(1, requestedCpu ?? 0, cpuForMemory));
  return `${cpu}x${cpu * 2}` as BuddyResources;
}

function firstPositiveNumber(values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.ceil(value);
  }
  return undefined;
}

/** Memory knobs are unnormalized across providers — MB for some, MiB for others. */
function memoryToGb(options: Record<string, unknown>): number | undefined {
  const mb = firstPositiveNumber([options.memory, options.memoryMb]);
  if (mb !== undefined) return mb / 1024;
  const mib = firstPositiveNumber([options.memoryMiB, options.memMiB]);
  if (mib !== undefined) return (mib * 1024 * 1024) / 1e9;
  return undefined;
}

/** Buddy identifiers allow alphanumerics, `_` and inner `-` only. */
export function toIdentifier(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  // Trim after truncating, or the cut can leave a hyphen in the last position.
  return cleaned.slice(0, 60).replace(/^-+|-+$/g, '') || 'computesdk';
}

export function generateSandboxName(): string {
  return `computesdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizePort(input: BuddyPortInput, config: ResolvedBuddyConfig): Required<BuddyPort> {
  const port = typeof input === 'number' ? { port: input } : input;
  return {
    port: port.port,
    name: port.name ?? `p${port.port}`,
    type: port.type ?? 'HTTP',
    region: port.region ?? config.region,
  };
}

/** Buddy's tunnel object. `endpoint` holds the sandbox-side port as a string. */
export interface BuddyEndpoint {
  name?: string;
  endpoint?: string;
  type?: BuddyTunnelType;
  /** As reported by the API, which may know installations this provider does not offer. */
  region?: string;
  endpoint_url?: string;
  active?: boolean;
  whitelist?: string[];
  [key: string]: unknown;
}

export function toEndpointPayload(port: Required<BuddyPort>): BuddyEndpoint {
  return {
    name: port.name,
    endpoint: String(port.port),
    type: port.type,
    region: port.region,
  };
}

/** Only HTTP and TLS tunnels get a public URL; TCP and SSH report host and port. */
export function endpointPublicUrl(endpoint: BuddyEndpoint): string | undefined {
  return endpoint.endpoint_url;
}

export function endpointMatchesPort(endpoint: BuddyEndpoint, port: number): boolean {
  return Number(endpoint.endpoint) === port;
}

/** Fields Buddy reports but rejects when an endpoint is sent back in an update. */
const READ_ONLY_ENDPOINT_FIELDS = ['endpoint_url', 'active', 'target_latency'] as const;

/**
 * Prepares an existing endpoint for the replace-all update. Everything
 * writable — `whitelist`, `timeout`, `http`, `tls` and whatever Buddy adds
 * later — has to survive, or opening a new port would reset those tunnels.
 */
export function toEndpointUpdate(endpoint: BuddyEndpoint): BuddyEndpoint {
  const update: BuddyEndpoint = { ...endpoint };
  for (const field of READ_ONLY_ENDPOINT_FIELDS) delete update[field];
  return update;
}

/** Swaps the scheme of a URL, for callers asking for `wss` on an HTTP tunnel. */
export function applyProtocol(url: string, protocol?: string): string {
  if (!protocol) return url;
  const normalized = protocol.replace(/:$/, '');
  return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, `${normalized}://`);
}

/**
 * What the provider passes between its own methods, and what `getInstance()`
 * hands back to callers. `client` and `fs` come straight from the SDK, so
 * consumers can drop down to it without building their own client.
 */
export interface BuddySandboxHandle {
  sandboxId: string;
  identifier: string;
  config: ResolvedBuddyConfig;
  client: BuddyApiClient;
  fs: FileSystem;
  createdAt: Date;
  /** True unless this process created the sandbox; Buddy reports no creation date. */
  createdAtIsReconnectTime: boolean;
  timeout: number;
  os?: string;
  resources?: string;
  /** Tunnels known so far. `getUrl` extends this when it opens a new one. */
  endpoints: BuddyEndpoint[];
}

/** Sandbox as the API returns it, narrowed to the fields the provider reads. */
export interface BuddySandboxData {
  id?: string;
  identifier?: string;
  name?: string;
  status?: string;
  setup_status?: string;
  os?: string;
  resources?: string;
  timeout?: number;
  endpoints?: BuddyEndpoint[];
  ssh_host?: string;
  ssh_port?: number;
}

/**
 * Buddy's sandbox resource carries no creation date (only projects and
 * snapshots do), and `SandboxInfo.createdAt` is a required `Date`, so a handle
 * rebuilt by `getById` or `list` can only record when it was reconnected.
 * `getInfo` marks that case with `metadata.createdAtIsReconnectTime`.
 */
export function toHandle(
  config: ResolvedBuddyConfig,
  sandbox: BuddySandboxData,
  createdAt = new Date(),
  createdAtIsReconnectTime = true,
): BuddySandboxHandle {
  const sandboxId = sandbox.id;
  if (!sandboxId) {
    throw new Error('Buddy API returned a sandbox without an id.');
  }
  const client = getClient(config);

  return {
    sandboxId,
    identifier: sandbox.identifier ?? sandboxId,
    config,
    client,
    fs: new FileSystem(client, sandboxId),
    createdAt,
    createdAtIsReconnectTime,
    timeout: sandbox.timeout != null ? sandbox.timeout * 1000 : config.timeout,
    os: sandbox.os,
    resources: sandbox.resources,
    endpoints: sandbox.endpoints ?? [],
  };
}

export async function getSandboxData(
  config: ResolvedBuddyConfig,
  sandboxId: string,
): Promise<BuddySandboxData> {
  return await getClient(config).getSandboxById({ path: { id: sandboxId } }) as BuddySandboxData;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}
