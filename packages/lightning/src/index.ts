/**
 * Lightning AI Provider - Factory-based Implementation
 *
 * Wraps the official `@lightningai/sdk` (Lightning AI Sandbox SDK) so Lightning
 * sandboxes can be driven through the ComputeSDK provider interface.
 *
 * The Lightning SDK is published ESM-only, so it is loaded lazily via dynamic
 * `import()` to keep this package consumable from both ESM and CommonJS. The SDK
 * authenticates through module-global configuration (`Sandbox.configure`), which
 * is (re)applied from the provider config before every collection operation.
 */

import { defineProvider } from '@computesdk/provider';

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions, CreateSnapshotOptions, ListSnapshotsOptions, CreateTemplateOptions } from '@computesdk/provider';

/** Default instance type used when none is supplied via config. */
const DEFAULT_INSTANCE_TYPE = 'cpu-1';

/** Minimal view of the `@lightningai/sdk` `FileStat` we rely on. */
interface LightningFileStat {
  fileType: string;
  size: number;
  mtime: Date;
  mode: string;
}

/** Minimal view of the `@lightningai/sdk` `SnapshotData` we rely on. */
interface LightningSnapshotData {
  id: string;
  /** `saving` | `ready` | `failed`; only `ready` snapshots are restorable. */
  status: string;
  sizeBytes: number;
  sourceSandboxId: string;
  sourceSandboxName: string;
  runtime: string;
  /** `true` for control-plane auto-snapshots; `false` for user snapshots. */
  auto: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}

/** ComputeSDK-normalized snapshot returned by the snapshot method group. */
export interface LightningSnapshot {
  id: string;
  provider: 'lightning';
  createdAt: Date;
  metadata: {
    status: string;
    sizeBytes: number;
    sourceSandboxId: string;
    sourceSandboxName: string;
    runtime: string;
    auto: boolean;
    expiresAt: Date | null;
  };
}

/** Native Lightning sandbox instance surface we depend on. */
interface LightningNativeSandbox {
  readonly sandboxId: string;
  readonly name: string;
  readonly status: string;
  readonly ports: string[];
  /** Public HTTPS URLs for the sandbox's exposed ports, keyed by port number. */
  readonly portUrls: Record<string, string>;
  readonly instanceType: string;
  readonly runtime: string;
  readonly timeout: number;
  readonly createdAt: Date;
  /** Return the public URL for one of the sandbox's exposed ports; throws if the port was not declared at create time. */
  getPortUrl(port: number | string): string;
  /** Capture a filesystem snapshot of this sandbox (waits for `ready` by default). */
  createSnapshot(params?: { excludes?: string[]; expiration?: number; wait?: boolean; waitTimeoutMs?: number }): Promise<LightningSnapshotData>;
  runCommand(opts: { cmd: string; args?: string[]; cwd?: string; env?: Record<string, string>; detached?: boolean }): Promise<{ output: string; exitCode: number | null }>;
  writeFile(params: { path: string; content: string }): Promise<void>;
  readFile(params: { path: string }): Promise<string | null>;
  delete(): Promise<void>;
  fs: {
    mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
    exists(path: string): Promise<boolean>;
    readdir(path: string): Promise<string[]>;
    stat(path: string): Promise<LightningFileStat>;
    rm(path: string, opts?: { recursive?: boolean }): Promise<void>;
  };
}

/** Static surface of the Lightning `Sandbox` class we depend on. */
interface LightningSandboxStatic {
  configure(config: { apiKey?: string; baseUrl?: string }): void;
  create(params: Record<string, unknown>): Promise<LightningNativeSandbox>;
  get(params: { sandboxId: string }): Promise<LightningNativeSandbox>;
  list(params?: { pageToken?: string; limit?: number }): Promise<{ sandboxes: LightningNativeSandbox[] }>;
  listSnapshots(params?: { name?: string; pageToken?: string; limit?: number; sortOrder?: 'asc' | 'desc' }): Promise<{ snapshots: LightningSnapshotData[] }>;
  getSnapshot(snapshotId: string): Promise<LightningSnapshotData>;
  deleteSnapshot(snapshotId: string): Promise<void>;
}

let _SandboxClass: LightningSandboxStatic | null = null;

/** Lazily load the ESM-only Lightning SDK (works under both ESM and CJS). */
async function loadSandbox(): Promise<LightningSandboxStatic> {
  if (!_SandboxClass) {
    const mod = await import('@lightningai/sdk');
    _SandboxClass = (mod as { Sandbox: unknown }).Sandbox as LightningSandboxStatic;
  }
  return _SandboxClass;
}

export interface LightningConfig {
  /** Lightning AI API key - falls back to LIGHTNING_SANDBOX_API_KEY, then LIGHTNING_API_KEY env vars. */
  apiKey?: string;
  /** Lightning Cloud base URL - falls back to LIGHTNING_CLOUD_URL, then production. */
  baseUrl?: string;
  /** Instance type for new sandboxes (e.g. "cpu-1", "cpu-2", ... "cpu-16"). Defaults to "cpu-1". */
  instanceType?: string;
  /** Curated runtime image for new sandboxes (e.g. "node24", "python313"). */
  runtime?: string;
  /** Whether new sandboxes persist filesystem state across stops via auto-snapshots. */
  persistent?: boolean;
  /** Request spot capacity for new sandboxes. */
  spot?: boolean;
  /** Ports to expose on new sandboxes when none are supplied per-create. */
  ports?: number[];
  /** Maximum sandbox lifetime in milliseconds before auto-stop. */
  timeout?: number;
}

/**
 * Resolve the API key from config or environment, throwing a helpful error if missing.
 * Env precedence matches the Lightning SDK: `LIGHTNING_SANDBOX_API_KEY` wins over `LIGHTNING_API_KEY`.
 */
function resolveApiKey(config: LightningConfig): string {
  const apiKey =
    config.apiKey ||
    (typeof process !== 'undefined' && (process.env?.LIGHTNING_SANDBOX_API_KEY || process.env?.LIGHTNING_API_KEY)) ||
    '';

  if (!apiKey) {
    throw new Error(
      'Missing Lightning AI API key. Provide `apiKey` in config or set the ' +
        'LIGHTNING_SANDBOX_API_KEY (or LIGHTNING_API_KEY) environment variable.\n' +
        'Generate a key from your Lightning AI account settings: https://lightning.ai/'
    );
  }

  return apiKey;
}

/**
 * Resolve the Cloud base URL from config or environment. Returns `undefined` when
 * neither is set, letting the SDK default to production (`https://lightning.ai`).
 */
function resolveBaseUrl(config: LightningConfig): string | undefined {
  return (
    config.baseUrl ||
    (typeof process !== 'undefined' ? process.env?.LIGHTNING_CLOUD_URL : undefined) ||
    undefined
  );
}

/**
 * Per-config concurrency gate.
 *
 * The Lightning SDK keeps auth/base-url in process-global state
 * (`Sandbox.configure`) and reads it lazily on every HTTP request (including the
 * polling `get` calls issued inside `create`). If two provider instances used
 * DIFFERENT API keys, a concurrent `configure()` from one could clobber the
 * global before the other's request read it, sending a request with the wrong
 * key — a cross-tenant credential hazard.
 *
 * This gate installs exactly one config at a time and holds it for the *whole*
 * operation. Operations sharing the active config run concurrently (so the
 * common single-key case is never serialized), while an operation that needs a
 * different config waits until the active ones drain, then switches. New same-
 * key arrivals also queue once a switch is pending, so a waiting config can
 * never be starved.
 */
interface ConfigWaiter {
  config: LightningConfig;
  key: string;
  resolve: (release: () => void) => void;
}

let _activeConfigKey: string | null = null;
let _activeOps = 0;
const _configWaiters: ConfigWaiter[] = [];

/** Identity of a config for gating: resolved API key + base URL. Validates the key is present. */
function configKey(config: LightningConfig): string {
  return `${resolveApiKey(config)} ${resolveBaseUrl(config) ?? ''}`;
}

/** Install a config into the SDK's process-global state. `_SandboxClass` must be loaded. */
function installConfig(config: LightningConfig): void {
  _SandboxClass!.configure({ apiKey: resolveApiKey(config), baseUrl: resolveBaseUrl(config) });
}

/** Release one held slot; when the active epoch drains, admit the next waiting config. */
function releaseConfig(): void {
  _activeOps--;
  if (_activeOps > 0) return;
  _activeConfigKey = null;
  const next = _configWaiters.shift();
  if (!next) return;
  _activeConfigKey = next.key;
  _activeOps = 1;
  installConfig(next.config);
  next.resolve(releaseConfig);
}

/** Acquire the gate for `config`, returning a release fn. */
async function acquireConfig(config: LightningConfig): Promise<() => void> {
  await loadSandbox(); // ensure the SDK class is available for installConfig
  const key = configKey(config);
  // Fast path: join the active epoch when it already matches and no switch is
  // pending (preserves same-key concurrency without starving waiters).
  if (_activeConfigKey === key && _configWaiters.length === 0) {
    _activeOps++;
    return releaseConfig;
  }
  // Claim an idle gate.
  if (_activeConfigKey === null && _configWaiters.length === 0) {
    _activeConfigKey = key;
    _activeOps = 1;
    installConfig(config);
    return releaseConfig;
  }
  // Otherwise wait for our turn.
  return new Promise<() => void>((resolve) => {
    _configWaiters.push({ config, key, resolve });
  });
}

/** Run `fn` with `config` installed and held for the whole operation. */
async function withSandbox<T>(config: LightningConfig, fn: (Sandbox: LightningSandboxStatic) => Promise<T>): Promise<T> {
  const release = await acquireConfig(config);
  try {
    return await fn(_SandboxClass!);
  } finally {
    release();
  }
}

/** Non-enumerable stamp so instance ops (runCommand/filesystem) can re-apply their originating config under the gate. */
const CONFIG_STAMP = Symbol('computesdk.lightning.config');

function stampConfig(sandbox: LightningNativeSandbox, config: LightningConfig): LightningNativeSandbox {
  Object.defineProperty(sandbox, CONFIG_STAMP, { value: config, enumerable: false, configurable: true, writable: true });
  return sandbox;
}

function sandboxConfig(sandbox: LightningNativeSandbox): LightningConfig {
  return (sandbox as unknown as Record<symbol, LightningConfig>)[CONFIG_STAMP] ?? {};
}

/** Run an instance operation under the gate using the sandbox's stamped config. */
function withStamped<T>(sandbox: LightningNativeSandbox, fn: () => Promise<T>): Promise<T> {
  return withSandbox(sandboxConfig(sandbox), () => fn());
}

/** Map a Lightning sandbox status string onto the ComputeSDK status enum. */
function mapStatus(status: string): SandboxInfo['status'] {
  const s = (status || '').toLowerCase();
  if (s.includes('fail') || s.includes('error')) return 'error';
  if (s.includes('stop') || s.includes('pause') || s.includes('terminat') || s.includes('delet')) return 'stopped';
  return 'running';
}

/** Normalize a Lightning `SnapshotData` onto the ComputeSDK snapshot shape. */
function toSnapshot(snap: LightningSnapshotData): LightningSnapshot {
  return {
    id: snap.id,
    provider: 'lightning',
    createdAt: snap.createdAt instanceof Date ? snap.createdAt : new Date(snap.createdAt ?? Date.now()),
    metadata: {
      status: snap.status,
      sizeBytes: snap.sizeBytes ?? 0,
      sourceSandboxId: snap.sourceSandboxId,
      sourceSandboxName: snap.sourceSandboxName,
      runtime: snap.runtime,
      auto: snap.auto ?? false,
      expiresAt: snap.expiresAt ?? null,
    },
  };
}

/** ComputeSDK-normalized template returned by the template method group. */
export interface LightningTemplate {
  id: string;
  provider: 'lightning';
  name: string;
  createdAt: Date;
  metadata: {
    status: string;
    sizeBytes: number;
    sourceSandboxId: string;
    sourceSandboxName: string;
    runtime: string;
    auto: boolean;
    expiresAt: Date | null;
    source?: string;
    sandboxId?: string;
    [key: string]: unknown;
  };
}

export const lightning = defineProvider<LightningNativeSandbox, LightningConfig>({
  name: 'lightning',
  methods: {
    sandbox: {
      create: async (config: LightningConfig, options?: CreateSandboxOptions) => {
        const {
          timeout: optTimeout,
          envs: _envs,
          name,
          metadata: _metadata,
          templateId,
          snapshotId,
          sandboxId: _sandboxId,
          namespace: _namespace,
          directory: _directory,
          ports: optPorts,
          ...providerOptions
        } = options || {};

        const params: Record<string, unknown> = {
          ...providerOptions,
          instanceType: config.instanceType ?? DEFAULT_INSTANCE_TYPE,
        };

        if (name) params.name = name;

        const ports = (optPorts && optPorts.length > 0) ? optPorts : config.ports;
        if (ports && ports.length > 0) params.ports = ports;

        const timeout = optTimeout ?? config.timeout;
        if (timeout) params.timeout = timeout;

        if (config.runtime) params.runtime = config.runtime;
        if (config.spot !== undefined) params.spot = config.spot;
        if (config.persistent !== undefined) params.persistent = config.persistent;

        const source = snapshotId || templateId;
        if (source) params.snapshotId = source;

        try {
          // The gate is held across the whole create (including the SDK's internal
          // polling), so every request uses this config's credentials.
          const sandbox = await withSandbox(config, (Sandbox) => Sandbox.create(params));
          stampConfig(sandbox, config);
          return { sandbox, sandboxId: sandbox.sandboxId };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('401') || error.message.toLowerCase().includes('unauthorized') || error.message.toLowerCase().includes('api key')) {
              throw new Error('Lightning AI authentication failed. Please check your LIGHTNING_API_KEY.');
            }
            if (error.message.toLowerCase().includes('quota') || error.message.toLowerCase().includes('limit')) {
              throw new Error('Lightning AI quota exceeded. Please check your usage at https://lightning.ai/');
            }
          }
          throw new Error(`Failed to create Lightning sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: LightningConfig, sandboxId: string) => {
        try {
          const sandbox = await withSandbox(config, (Sandbox) => Sandbox.get({ sandboxId }));
          stampConfig(sandbox, config);
          return { sandbox, sandboxId };
        } catch {
          return null;
        }
      },

      list: async (config: LightningConfig) => {
        try {
          const { sandboxes } = await withSandbox(config, (Sandbox) => Sandbox.list());
          return sandboxes.map((sandbox) => ({ sandbox: stampConfig(sandbox, config), sandboxId: sandbox.sandboxId }));
        } catch {
          return [];
        }
      },

      destroy: async (config: LightningConfig, sandboxId: string) => {
        try {
          // get + delete run under a single held config so the delete request
          // can't pick up another instance's credentials.
          await withSandbox(config, async (Sandbox) => {
            const sandbox = await Sandbox.get({ sandboxId });
            await sandbox.delete();
          });
        } catch {
          /* Sandbox may already be deleted - ignore. */
        }
      },

      runCommand: async (sandbox: LightningNativeSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          let fullCommand = command;
          if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;

          const hasEnv = options?.env && Object.keys(options.env).length > 0;
          const result = await withStamped(sandbox, () => sandbox.runCommand({
            cmd: 'sh',
            args: ['-c', fullCommand],
            cwd: options?.cwd,
            env: hasEnv ? options!.env : undefined,
          }));

          // Lightning exposes a single combined stdout/stderr stream via `output`.
          return {
            stdout: result.output ?? '',
            stderr: '',
            exitCode: result.exitCode ?? 0,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
          };
        }
      },

      getInfo: async (sandbox: LightningNativeSandbox): Promise<SandboxInfo> => ({
        id: sandbox.sandboxId,
        provider: 'lightning',
        status: mapStatus(sandbox.status),
        createdAt: sandbox.createdAt instanceof Date ? sandbox.createdAt : new Date(sandbox.createdAt ?? Date.now()),
        timeout: sandbox.timeout || 0,
        metadata: {
          name: sandbox.name,
          instanceType: sandbox.instanceType,
          runtime: sandbox.runtime,
          ports: sandbox.ports,
          portUrls: sandbox.portUrls,
        },
      }),

      getUrl: async (sandbox: LightningNativeSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        // Lightning returns a public HTTPS URL per port declared at create time
        // (e.g. https://8080-<sandbox-id>-s.cloudspaces.litng.ai). `getPortUrl`
        // throws a helpful error when the port was not exposed.
        const url = sandbox.getPortUrl(options.port);
        // Honor a caller-requested scheme (e.g. `wss` for websockets) while
        // keeping Lightning's proxy host; default to the SDK's https URL.
        return options.protocol ? url.replace(/^[a-z]+:\/\//i, `${options.protocol}://`) : url;
      },

      filesystem: {
        readFile: async (sandbox: LightningNativeSandbox, path: string): Promise<string> => {
          const content = await withStamped(sandbox, () => sandbox.readFile({ path }));
          if (content === null) throw new Error(`File not found: ${path}`);
          return content;
        },
        writeFile: async (sandbox: LightningNativeSandbox, path: string, content: string): Promise<void> => {
          await withStamped(sandbox, () => sandbox.writeFile({ path, content }));
        },
        mkdir: async (sandbox: LightningNativeSandbox, path: string): Promise<void> => {
          await withStamped(sandbox, () => sandbox.fs.mkdir(path, { recursive: true }));
        },
        readdir: async (sandbox: LightningNativeSandbox, path: string): Promise<FileEntry[]> => {
          // The whole listing (readdir + per-entry stat) runs under one held config.
          return withStamped(sandbox, async () => {
            const names = await sandbox.fs.readdir(path);
            const base = path.endsWith('/') ? path.slice(0, -1) : path;
            return Promise.all(
              names.map(async (name): Promise<FileEntry> => {
                try {
                  const stat = await sandbox.fs.stat(`${base}/${name}`);
                  return {
                    name,
                    type: stat.fileType.toLowerCase().includes('directory') ? 'directory' : 'file',
                    size: stat.size ?? 0,
                    modified: stat.mtime instanceof Date ? stat.mtime : new Date(stat.mtime ?? Date.now()),
                  };
                } catch {
                  return { name, type: 'file', size: 0, modified: new Date() };
                }
              })
            );
          });
        },
        exists: async (sandbox: LightningNativeSandbox, path: string): Promise<boolean> => {
          return withStamped(sandbox, () => sandbox.fs.exists(path));
        },
        remove: async (sandbox: LightningNativeSandbox, path: string): Promise<void> => {
          await withStamped(sandbox, () => sandbox.fs.rm(path, { recursive: true }));
        },
      },

      getInstance: (sandbox: LightningNativeSandbox): LightningNativeSandbox => sandbox,
    },

    snapshot: {
      // Capture a filesystem snapshot of an existing sandbox. Lightning snapshots
      // are unnamed, so `options.name`/`options.metadata` are accepted for API
      // parity but not persisted. Restore via `snapshotId` on sandbox create.
      create: async (config: LightningConfig, sandboxId: string, _options?: CreateSnapshotOptions): Promise<LightningSnapshot> => {
        try {
          // get + createSnapshot run under a single held config.
          const snapshot = await withSandbox(config, async (Sandbox) => {
            const sandbox = await Sandbox.get({ sandboxId });
            return sandbox.createSnapshot();
          });
          return toSnapshot(snapshot);
        } catch (error) {
          throw new Error(
            `Failed to create Lightning snapshot for sandbox '${sandboxId}': ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      list: async (config: LightningConfig, options?: ListSnapshotsOptions): Promise<LightningSnapshot[]> => {
        try {
          const { snapshots } = await withSandbox(config, (Sandbox) => Sandbox.listSnapshots(options?.limit ? { limit: options.limit } : undefined));
          // Lightning's list API has no sandbox filter, so narrow client-side.
          const filtered = options?.sandboxId
            ? snapshots.filter((snap) => snap.sourceSandboxId === options.sandboxId)
            : snapshots;
          return filtered.map(toSnapshot);
        } catch {
          return [];
        }
      },

      delete: async (config: LightningConfig, snapshotId: string): Promise<void> => {
        try {
          await withSandbox(config, (Sandbox) => Sandbox.deleteSnapshot(snapshotId));
        } catch {
          /* Snapshot may already be deleted - ignore. */
        }
      },
    },

    template: {
      create: async (config: LightningConfig, options: CreateTemplateOptions): Promise<LightningTemplate> => {
        if (!options.from) {
          throw new Error(`Lightning does not support building templates from spec. Use { from: sandboxId } to capture from a running sandbox.`);
        }
        try {
          const snapshot = await withSandbox(config, async (Sandbox) => {
            const sandbox = await Sandbox.get({ sandboxId: options.from! });
            return sandbox.createSnapshot();
          });
          const normalized = toSnapshot(snapshot);
          return {
            id: normalized.id,
            provider: 'lightning',
            name: options.name,
            createdAt: normalized.createdAt,
            metadata: { ...normalized.metadata, ...options.metadata, source: 'capture', sandboxId: options.from },
          };
        } catch (error) {
          throw new Error(
            `Failed to create Lightning template for sandbox '${options.from}': ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      list: async (config: LightningConfig): Promise<LightningTemplate[]> => {
        try {
          const { snapshots } = await withSandbox(config, (Sandbox) => Sandbox.listSnapshots());
          return snapshots.map((snap) => {
            const normalized = toSnapshot(snap);
            return {
              id: normalized.id,
              provider: 'lightning',
              name: normalized.metadata.sourceSandboxName || 'unnamed',
              createdAt: normalized.createdAt,
              metadata: normalized.metadata,
            };
          });
        } catch {
          return [];
        }
      },

      delete: async (config: LightningConfig, templateId: string): Promise<void> => {
        try {
          await withSandbox(config, (Sandbox) => Sandbox.deleteSnapshot(templateId));
        } catch {
          /* Template may already be deleted - ignore. */
        }
      },
    },
  },
});
