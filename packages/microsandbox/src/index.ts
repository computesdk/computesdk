import { randomUUID } from 'node:crypto';
import { posix as posixPath } from 'node:path';
import { performance } from 'node:perf_hooks';
import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  CreateSandboxOptions,
  CreateSnapshotOptions,
  FileEntry,
  ListSnapshotsOptions,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';
import type {
  DefaultBackend,
  Sandbox as NativeSandbox,
  SandboxHandle as NativeSandboxHandle,
} from 'microsandbox';

const PROVIDER = 'microsandbox' as const;
const LABEL_MARKER = 'computesdk.sandbox';
const LABEL_METADATA_PREFIX = 'computesdk.metadata.';
const SNAPSHOT_LABEL_MARKER = 'computesdk.snapshot';
const SNAPSHOT_LABEL_SANDBOX = 'computesdk.sandbox-id';
const DEFAULT_IMAGE = 'alpine:3.21';
const DEFAULT_CPUS = 1;
const DEFAULT_MEMORY_MIB = 512;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_NAME_PREFIX = 'csdk-';
const DEFAULT_LIST_PAGE_SIZE = 100;

type MicrosandboxModule = typeof import('microsandbox');

export interface MicrosandboxPort {
  /** Host TCP port. Local backend only. */
  host: number;
  /** Guest TCP port. */
  guest: number;
  /** Optional local bind address. */
  bind?: string;
}

export interface MicrosandboxConfig {
  /**
   * Execution backend. Cloud is the default; pass `local` to use the runtime
   * installed on the calling machine.
   */
  backend?: 'cloud' | 'local';
  /** Cloud API key. Falls back to the microsandbox SDK's `MSB_API_KEY` resolution. */
  apiKey?: string;
  /** Hosted API endpoint override. Requires `apiKey`. */
  apiUrl?: string;
  /** Named microsandbox cloud profile. Cannot be combined with `apiKey` or `apiUrl`. */
  profile?: string;
  /** Default OCI image. */
  image?: string;
  /** Default number of guest vCPUs. */
  cpus?: number;
  /** Default guest memory in MiB. */
  memoryMib?: number;
  /** Default writable root disk size in MiB. */
  rootDiskMib?: number;
  /** Default working directory inside the guest. */
  workdir?: string;
  /** Prefix for generated sandbox names. */
  namePrefix?: string;
  /** Local TCP port mappings. A number maps the same host and guest port. */
  ports?: Array<number | MicrosandboxPort>;
  /** Default sandbox lifetime and command timeout in milliseconds. */
  timeout?: number;
  /** OCI pull policy. */
  pullPolicy?: 'always' | 'if-missing' | 'never';
  /** Enable guest networking. Defaults to true. */
  networkEnabled?: boolean;
}

export interface MicrosandboxSandbox {
  name: string;
  backendKind: 'local' | 'cloud';
  sandbox: NativeSandbox | null;
  handle: NativeSandboxHandle | null;
  createdAt: Date;
  timeoutMs: number;
  metadata: Record<string, unknown>;
  ports: Map<number, number>;
}

export interface MicrosandboxSnapshot {
  id: string;
  provider: typeof PROVIDER;
  createdAt: Date;
  metadata: {
    name: string;
    sandboxId?: string;
    imageRef?: string;
    sizeBytes?: bigint;
    labels?: Record<string, string>;
  };
}

interface RecoveredConfig {
  labels?: Record<string, string>;
  network?: {
    ports?: Array<{
      host?: number;
      guest?: number;
      hostPort?: number;
      guestPort?: number;
      bind?: string;
      hostBind?: string;
    }>;
  };
}

interface BackendSelection {
  kind: 'local' | 'cloud';
  override?: DefaultBackend;
}

interface RecoveredPorts {
  hostPorts: Map<number, number>;
  hostBinds: Map<number, string>;
}

let sdkPromise: Promise<MicrosandboxModule> | undefined;
let backendQueue = Promise.resolve();

/**
 * Keep credential-bearing backend configuration out of the public sandbox
 * object returned by getInstance(). The mapping is only needed when a sandbox
 * created in this process must lazily recover its native handle.
 */
const sandboxBackends = new WeakMap<MicrosandboxSandbox, BackendSelection>();

/** Preserve bind addresses without changing the public `getInstance()` shape. */
const sandboxPortBinds = new WeakMap<MicrosandboxSandbox, Map<number, string>>();

function loadSdk(): Promise<MicrosandboxModule> {
  sdkPromise ??= import('microsandbox');
  return sdkPromise;
}

/**
 * The SDK's backend scope is process-wide rather than task-local. Serialize all
 * provider static entry points so local and cloud calls cannot observe each
 * other's temporary backend while create/get/list/remove is awaiting I/O.
 */
async function withBackend<T>(
  selection: BackendSelection,
  operation: (sdk: MicrosandboxModule) => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const previous = backendQueue;
  backendQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const sdk = await loadSdk();
    const run = async () => {
      const resolvedKind = sdk.defaultBackendKind();
      if (resolvedKind !== selection.kind) {
        throw new Error(
          `Microsandbox cloud is the default, but no cloud credentials or profile were resolved. ` +
          `Provide 'apiKey', set MSB_API_KEY, configure an active cloud profile, or pass backend: 'local'.`,
        );
      }
      return operation(sdk);
    };
    return await (selection.override ? sdk.withDefaultBackend(selection.override, run) : run());
  } finally {
    release();
  }
}

function selectBackend(config: MicrosandboxConfig): BackendSelection {
  const kind = config.backend ?? 'cloud';
  const hasApiKey = Boolean(config.apiKey);
  const hasApiUrl = Boolean(config.apiUrl);
  const hasProfile = Boolean(config.profile);

  if (kind === 'local') {
    if (hasApiKey || hasApiUrl || hasProfile) {
      throw new Error(`Microsandbox cloud credentials cannot be used with backend: 'local'.`);
    }
    return { kind, override: 'local' };
  }

  if (hasProfile && (hasApiKey || hasApiUrl)) {
    throw new Error(`Microsandbox 'profile' cannot be combined with 'apiKey' or 'apiUrl'.`);
  }
  if (hasApiUrl && !hasApiKey) {
    throw new Error(`Microsandbox 'apiUrl' requires 'apiKey'.`);
  }
  if (config.profile) {
    return { kind, override: { kind: 'cloud', profile: config.profile } };
  }
  if (config.apiKey) {
    return {
      kind,
      override: {
        kind: 'cloud',
        apiKey: config.apiKey,
        ...(config.apiUrl ? { url: config.apiUrl } : {}),
      },
    };
  }

  // Let the SDK resolve MSB_API_KEY, MSB_PROFILE, or the active profile, then
  // enforce cloud so an unconfigured machine does not silently fall back local.
  return { kind };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: string }).code === 'sandboxNotFound';
}

function requireLocal(backendKind: 'local' | 'cloud', capability: string): void {
  if (backendKind === 'cloud') {
    throw new Error(
      `Microsandbox cloud does not currently support ${capability}. Use the local backend for this operation.`,
    );
  }
}

function timeoutFor(config: MicrosandboxConfig, options?: CreateSandboxOptions): number {
  return options?.timeout ?? config.timeout ?? DEFAULT_TIMEOUT_MS;
}

function cpusFor(config: MicrosandboxConfig, options?: CreateSandboxOptions): number {
  return options?.cpus ?? options?.vcpus ?? options?.cpu ?? config.cpus ?? DEFAULT_CPUS;
}

function memoryFor(config: MicrosandboxConfig, options?: CreateSandboxOptions): number {
  return options?.memoryMiB ?? options?.memMiB ?? options?.memoryMb ?? options?.memory ?? config.memoryMib ?? DEFAULT_MEMORY_MIB;
}

function normalizePorts(
  config: MicrosandboxConfig,
  options?: CreateSandboxOptions,
): MicrosandboxPort[] {
  const raw = [
    ...(config.ports ?? []),
    ...((options?.ports as Array<number | MicrosandboxPort> | undefined) ?? []),
  ];
  const byGuest = new Map<number, MicrosandboxPort>();
  for (const entry of raw) {
    const port = typeof entry === 'number' ? { host: entry, guest: entry } : entry;
    byGuest.set(port.guest, port);
  }
  return [...byGuest.values()];
}

function bindAddressesFor(ports: MicrosandboxPort[]): Map<number, string> {
  const binds = new Map<number, string>();
  for (const port of ports) {
    if (port.bind) binds.set(port.guest, port.bind);
  }
  return binds;
}

function encodeMetadata(metadata: Record<string, unknown>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    try {
      labels[`${LABEL_METADATA_PREFIX}${key}`] = JSON.stringify(value);
    } catch {
      labels[`${LABEL_METADATA_PREFIX}${key}`] = String(value);
    }
  }
  return labels;
}

function decodeMetadata(labels: Record<string, string> | undefined): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(labels ?? {})) {
    if (!key.startsWith(LABEL_METADATA_PREFIX)) continue;
    const metadataKey = key.slice(LABEL_METADATA_PREFIX.length);
    try {
      metadata[metadataKey] = JSON.parse(value);
    } catch {
      metadata[metadataKey] = value;
    }
  }
  return metadata;
}

function portsFromConfig(config: RecoveredConfig): RecoveredPorts {
  const hostPorts = new Map<number, number>();
  const hostBinds = new Map<number, string>();
  for (const port of config.network?.ports ?? []) {
    const host = Number(port.host ?? port.hostPort);
    const guest = Number(port.guest ?? port.guestPort);
    const bind = port.bind ?? port.hostBind;
    if (Number.isInteger(host) && Number.isInteger(guest)) {
      hostPorts.set(guest, host);
      if (bind) hostBinds.set(guest, bind);
    }
  }
  return { hostPorts, hostBinds };
}

function urlHostForBind(bind: string | undefined): string {
  if (!bind || bind === '0.0.0.0') return '127.0.0.1';
  if (bind === '::' || bind === '[::]') return '[::1]';
  if (bind.startsWith('[') && bind.endsWith(']')) return bind;
  return bind.includes(':') ? `[${bind}]` : bind;
}

function handleFromNative(
  handle: NativeSandboxHandle,
  backend: BackendSelection,
  timeoutMs: number,
): MicrosandboxSandbox {
  const config = handle.config() as RecoveredConfig;
  const recoveredPorts = portsFromConfig(config);
  const sandbox: MicrosandboxSandbox = {
    name: handle.name,
    backendKind: handle.backendKind,
    sandbox: null,
    handle,
    createdAt: handle.createdAt ?? new Date(),
    timeoutMs,
    metadata: decodeMetadata(config.labels),
    ports: recoveredPorts.hostPorts,
  };
  sandboxBackends.set(sandbox, backend);
  sandboxPortBinds.set(sandbox, recoveredPorts.hostBinds);
  return sandbox;
}

async function nativeHandle(sandbox: MicrosandboxSandbox): Promise<NativeSandboxHandle> {
  if (sandbox.handle) return sandbox.handle;
  const backend = sandboxBackends.get(sandbox);
  if (!backend) throw new Error(`Microsandbox backend state is unavailable for sandbox "${sandbox.name}".`);
  sandbox.handle = await withBackend(backend, async ({ Sandbox }) => Sandbox.get(sandbox.name));
  return sandbox.handle;
}

async function connectedSandbox(sandbox: MicrosandboxSandbox): Promise<NativeSandbox> {
  if (sandbox.sandbox) return sandbox.sandbox;
  const handle = await nativeHandle(sandbox);
  sandbox.sandbox = handle.status === 'running' || handle.status === 'draining'
    ? await handle.connect()
    : await handle.startDetached();
  return sandbox.sandbox;
}

function mapStatus(status: string): SandboxInfo['status'] {
  if (status === 'running' || status === 'draining') return 'running';
  if (status === 'stopped') return 'stopped';
  return 'error';
}

function configureExec<T extends {
  args(args: string[]): T;
  cwd(cwd: string): T;
  envs(env: Record<string, string>): T;
  timeout(timeout: number): T;
}>(builder: T, script: string, options?: RunCommandOptions, includeTimeout = true): T {
  let configured = builder.args(['-c', script]);
  if (options?.cwd) configured = configured.cwd(options.cwd);
  if (options?.env && Object.keys(options.env).length > 0) configured = configured.envs(options.env);
  if (includeTimeout && options?.timeout) configured = configured.timeout(options.timeout);
  return configured;
}

function backgroundScript(command: string): string {
  const quoted = `'${command.replace(/'/g, `'\\''`)}'`;
  return `nohup /bin/sh -c ${quoted} >/dev/null 2>&1 &`;
}

async function runCommand(
  sandbox: MicrosandboxSandbox,
  command: string,
  options?: RunCommandOptions,
): Promise<CommandResult> {
  const startedAt = performance.now();
  const native = await connectedSandbox(sandbox);
  const script = options?.background ? backgroundScript(command) : command;
  const output = await native.execWith('/bin/sh', (builder) => configureExec(builder, script, options));
  return {
    stdout: output.stdout(),
    stderr: output.stderr(),
    exitCode: output.code,
    durationMs: performance.now() - startedAt,
  };
}

async function streamCommand(
  sandbox: MicrosandboxSandbox,
  command: string,
  options: RunCommandOptions,
): Promise<CommandResult> {
  if (options.background) return runCommand(sandbox, command, options);

  const startedAt = performance.now();
  const native = await connectedSandbox(sandbox);
  const execution = await native.execStreamWith('/bin/sh', (builder) => configureExec(builder, command, options, false));
  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  let stdout = '';
  let stderr = '';
  let exitCode = 1;
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  if (options.timeout) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      // Killing the native exec handle also closes its output stream. The
      // iterator below then exits normally or throws a cancellation error.
      void execution.kill().catch(() => {});
    }, options.timeout);
  }

  try {
    for await (const event of execution) {
      if (event.kind === 'stdout') {
        const chunk = stdoutDecoder.decode(event.data, { stream: true });
        stdout += chunk;
        if (chunk) options.onStdout?.(chunk);
      } else if (event.kind === 'stderr') {
        const chunk = stderrDecoder.decode(event.data, { stream: true });
        stderr += chunk;
        if (chunk) options.onStderr?.(chunk);
      } else if (event.kind === 'exited') {
        exitCode = event.code;
      }
    }
  } catch (error) {
    if (!timedOut) throw error;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  const stdoutTail = stdoutDecoder.decode();
  const stderrTail = stderrDecoder.decode();
  stdout += stdoutTail;
  stderr += stderrTail;
  if (stdoutTail) options.onStdout?.(stdoutTail);
  if (stderrTail) options.onStderr?.(stderrTail);

  return {
    stdout,
    stderr,
    exitCode: timedOut ? 124 : exitCode,
    durationMs: performance.now() - startedAt,
  };
}

async function removeSandbox(handle: NativeSandboxHandle): Promise<void> {
  if (handle.status === 'running' || handle.status === 'draining') {
    await handle.stopWithTimeout(10_000);
  }
  await handle.remove();
}

function snapshotFromNative(snapshot: {
  digest: string;
  name: string | null;
  createdAt: Date;
  imageRef?: string;
  sizeBytes?: bigint | null;
}, sandboxId?: string): MicrosandboxSnapshot {
  return {
    id: snapshot.name ?? snapshot.digest,
    provider: PROVIDER,
    createdAt: snapshot.createdAt,
    metadata: {
      name: snapshot.name ?? snapshot.digest,
      ...(sandboxId ? { sandboxId } : {}),
      ...(snapshot.imageRef ? { imageRef: snapshot.imageRef } : {}),
      ...(snapshot.sizeBytes != null ? { sizeBytes: snapshot.sizeBytes } : {}),
    },
  };
}

const _microsandbox = defineProvider<
  MicrosandboxSandbox,
  MicrosandboxConfig,
  never,
  MicrosandboxSnapshot
>({
  name: PROVIDER,
  methods: {
    sandbox: {
      create: async (config, options) => withBackend(selectBackend(config), async (sdk) => {
        options?.signal?.throwIfAborted();
        const backendKind = sdk.defaultBackendKind();
        const name = options?.name ?? `${config.namePrefix ?? DEFAULT_NAME_PREFIX}${randomUUID()}`;
        const timeoutMs = timeoutFor(config, options);
        const metadata = options?.metadata ?? {};
        const ports = normalizePorts(config, options);
        let builder = sdk.Sandbox.builder(name);

        if (options?.snapshotId) {
          requireLocal(backendKind, 'disk snapshots');
          builder = builder.fromSnapshot(options.snapshotId);
        } else {
          builder = builder.image(options?.image ?? options?.templateId ?? config.image ?? DEFAULT_IMAGE);
          if (config.rootDiskMib) builder = builder.rootDisk(config.rootDiskMib);
        }

        builder = builder
          .cpus(cpusFor(config, options))
          .memory(memoryFor(config, options))
          .detached(true)
          .maxDuration(Math.max(1, Math.ceil(timeoutMs / 1000)))
          .labels({
            [LABEL_MARKER]: 'true',
            ...encodeMetadata(metadata),
          });

        const workdir = options?.directory ?? config.workdir;
        if (workdir) builder = builder.workdir(workdir);
        if (options?.envs && Object.keys(options.envs).length > 0) builder = builder.envs(options.envs);
        if (config.pullPolicy) builder = builder.pullPolicy(config.pullPolicy);
        if (config.networkEnabled === false) builder = builder.disableNetwork();
        if (backendKind === 'local') {
          for (const port of ports) {
            builder = port.bind
              ? builder.portBind(port.bind, port.host, port.guest)
              : builder.port(port.host, port.guest);
          }
        }

        const native = await builder.create();
        if (options?.signal?.aborted) {
          try {
            await native.stopWithTimeout(5_000);
            const handle = await sdk.Sandbox.get(name);
            await handle.remove();
          } catch {
            // Preserve the caller's abort reason even if best-effort cleanup fails.
          }
          options.signal.throwIfAborted();
        }

        const sandbox: MicrosandboxSandbox = {
          name,
          backendKind: native.backendKind,
          sandbox: native,
          handle: null,
          createdAt: new Date(),
          timeoutMs,
          metadata,
          ports: new Map(ports.map((port) => [port.guest, port.host])),
        };
        sandboxBackends.set(sandbox, selectBackend(config));
        sandboxPortBinds.set(sandbox, bindAddressesFor(ports));

        return {
          sandbox,
          sandboxId: name,
        };
      }),

      getById: async (config, sandboxId) => withBackend(selectBackend(config), async ({ Sandbox }) => {
        try {
          const handle = await Sandbox.get(sandboxId);
          return {
            sandbox: handleFromNative(handle, selectBackend(config), config.timeout ?? DEFAULT_TIMEOUT_MS),
            sandboxId,
          };
        } catch (error) {
          if (isNotFound(error)) return null;
          throw error;
        }
      }),

      list: async (config) => withBackend(selectBackend(config), async ({ Sandbox }) => {
        const sandboxes: Array<{ sandbox: MicrosandboxSandbox; sandboxId: string }> = [];
        let cursor: string | undefined;
        do {
          const page = await Sandbox.listWith((list) => {
            let configured = list.limit(DEFAULT_LIST_PAGE_SIZE).label(LABEL_MARKER, 'true');
            if (cursor) configured = configured.cursor(cursor);
            return configured;
          });
          sandboxes.push(...page.sandboxes.map((handle) => ({
            sandbox: handleFromNative(handle, selectBackend(config), config.timeout ?? DEFAULT_TIMEOUT_MS),
            sandboxId: handle.name,
          })));
          cursor = page.nextCursor;
        } while (cursor);
        return sandboxes;
      }),

      destroy: async (config, sandboxId) => withBackend(selectBackend(config), async ({ Sandbox }) => {
        try {
          await removeSandbox(await Sandbox.get(sandboxId));
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }),

      runCommand,
      streamCommand,

      getInfo: async (sandbox) => {
        try {
          const handle = await nativeHandle(sandbox);
          const refreshed = await handle.refresh();
          sandbox.handle = refreshed;
          sandbox.createdAt = refreshed.createdAt ?? sandbox.createdAt;
          return {
            id: sandbox.name,
            provider: PROVIDER,
            status: mapStatus(refreshed.status),
            createdAt: sandbox.createdAt,
            timeout: sandbox.timeoutMs,
            metadata: {
              ...sandbox.metadata,
              backend: sandbox.backendKind,
              isolation: 'microvm',
            },
          };
        } catch (error) {
          if (!isNotFound(error)) throw error;
          return {
            id: sandbox.name,
            provider: PROVIDER,
            status: 'stopped',
            createdAt: sandbox.createdAt,
            timeout: sandbox.timeoutMs,
            metadata: { ...sandbox.metadata, backend: sandbox.backendKind, isolation: 'microvm' },
          };
        }
      },

      getUrl: async (sandbox, options) => {
        requireLocal(sandbox.backendKind, 'published ports');
        const hostPort = sandbox.ports.get(options.port);
        if (hostPort == null) {
          throw new Error(
            `Guest port ${options.port} was not published. Configure it before creating the microsandbox sandbox.`,
          );
        }
        const bind = sandboxPortBinds.get(sandbox)?.get(options.port);
        const host = urlHostForBind(bind);
        return `${options.protocol ?? 'http'}://${host}:${hostPort}`;
      },

      getInstance: (sandbox) => sandbox,

      filesystem: {
        readFile: async (sandbox, path) => (await connectedSandbox(sandbox)).fs().readToString(path),
        writeFile: async (sandbox, path, content) => {
          const fs = (await connectedSandbox(sandbox)).fs();
          const parent = posixPath.dirname(path);
          if (parent !== '.' && parent !== '/' && !(await fs.exists(parent))) await fs.mkdir(parent);
          await fs.write(path, content);
        },
        mkdir: async (sandbox, path) => (await connectedSandbox(sandbox)).fs().mkdir(path),
        readdir: async (sandbox, path): Promise<FileEntry[]> => {
          const entries = await (await connectedSandbox(sandbox)).fs().list(path);
          return entries.map((entry) => ({
            name: posixPath.basename(entry.path),
            type: entry.kind === 'directory' ? 'directory' : 'file',
            size: Number(entry.size),
            ...(entry.modified ? { modified: entry.modified } : {}),
          }));
        },
        exists: async (sandbox, path) => (await connectedSandbox(sandbox)).fs().exists(path),
        remove: async (sandbox, path) => {
          const fs = (await connectedSandbox(sandbox)).fs();
          const stat = await fs.stat(path);
          if (stat.kind === 'directory') await fs.removeDir(path);
          else await fs.remove(path);
        },
      },
    },

    snapshot: {
      create: async (config, sandboxId, options?: CreateSnapshotOptions) => withBackend(selectBackend(config), async (sdk) => {
        requireLocal(sdk.defaultBackendKind(), 'disk snapshots');
        const handle = await sdk.Sandbox.get(sandboxId);
        const wasRunning = handle.status === 'running' || handle.status === 'draining';
        if (wasRunning) await handle.stopWithTimeout(10_000);

        const name = options?.name ?? `csdk-snapshot-${Date.now().toString(36)}`;
        let builder = sdk.Snapshot.builder(name).fromSandbox(sandboxId);
        const labels = {
          [SNAPSHOT_LABEL_MARKER]: 'true',
          [SNAPSHOT_LABEL_SANDBOX]: sandboxId,
          ...encodeMetadata(options?.metadata ?? {}),
        };
        for (const [key, value] of Object.entries(labels)) {
          builder = builder.label(key, value);
        }

        let snapshotError: unknown;
        let snapshot: Awaited<ReturnType<typeof builder.create>> | undefined;
        try {
          snapshot = await builder.create();
        } catch (error) {
          snapshotError = error;
        }

        if (wasRunning) {
          try {
            await (await sdk.Sandbox.get(sandboxId)).startDetached();
          } catch (restartError) {
            if (!snapshotError) {
              throw new Error(
                `Snapshot ${name} was created, but restarting sandbox ${sandboxId} failed: ${errorMessage(restartError)}`,
              );
            }
          }
        }
        if (snapshotError) throw snapshotError;

        return {
          // ComputeSDK feeds this id back to create({ snapshotId }). The SDK's
          // restore builder resolves snapshot names and paths, so return the
          // stable name rather than the content digest used by its index.
          id: name,
          provider: PROVIDER,
          createdAt: new Date(snapshot?.createdAt ?? Date.now()),
          metadata: {
            name,
            sandboxId,
            ...(snapshot?.imageRef ? { imageRef: snapshot.imageRef } : {}),
            ...(snapshot?.sizeBytes != null ? { sizeBytes: snapshot.sizeBytes } : {}),
            labels: Object.fromEntries(snapshot?.labels ?? []),
          },
        };
      }),

      list: async (config, options?: ListSnapshotsOptions) => withBackend(selectBackend(config), async (sdk) => {
        requireLocal(sdk.defaultBackendKind(), 'disk snapshots');
        const snapshots: MicrosandboxSnapshot[] = [];
        for (const handle of await sdk.Snapshot.list()) {
          const live = await sdk.Snapshot.get(handle.digest);
          const snapshot = await live.open();
          const labels = Object.fromEntries(snapshot.labels);
          if (labels[SNAPSHOT_LABEL_MARKER] !== 'true') continue;
          const sandboxId = labels[SNAPSHOT_LABEL_SANDBOX] ?? snapshot.sourceSandbox ?? undefined;
          if (options?.sandboxId && sandboxId !== options.sandboxId) continue;
          snapshots.push({
            ...snapshotFromNative(handle, sandboxId),
            metadata: {
              ...snapshotFromNative(handle, sandboxId).metadata,
              labels,
            },
          });
          if (options?.limit && snapshots.length >= options.limit) break;
        }
        return snapshots;
      }),

      delete: async (config, snapshotId) => withBackend(selectBackend(config), async (sdk) => {
        requireLocal(sdk.defaultBackendKind(), 'disk snapshots');
        await sdk.Snapshot.remove(snapshotId);
      }),
    },
  },
});

/** Create a cloud-first microsandbox provider, or opt into the local runtime explicitly. */
export function microsandbox(config: MicrosandboxConfig = {}): ReturnType<typeof _microsandbox> {
  return _microsandbox(config);
}

export default microsandbox;
