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

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

/** Default instance type used when none is supplied via config. */
const DEFAULT_INSTANCE_TYPE = 'cpu-1';

/** Minimal view of the `@lightningai/sdk` `FileStat` we rely on. */
interface LightningFileStat {
  fileType: string;
  size: number;
  mtime: Date;
  mode: string;
}

/** Native Lightning sandbox instance surface we depend on. */
interface LightningNativeSandbox {
  readonly sandboxId: string;
  readonly name: string;
  readonly status: string;
  readonly ports: string[];
  readonly instanceType: string;
  readonly runtime: string;
  readonly timeout: number;
  readonly createdAt: Date;
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
  /** Lightning AI API key - falls back to LIGHTNING_API_KEY / LIGHTNING_SANDBOX_API_KEY env vars. */
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

/** Resolve the API key from config or environment, throwing a helpful error if missing. */
function resolveApiKey(config: LightningConfig): string {
  const apiKey =
    config.apiKey ||
    (typeof process !== 'undefined' && (process.env?.LIGHTNING_API_KEY || process.env?.LIGHTNING_SANDBOX_API_KEY)) ||
    '';

  if (!apiKey) {
    throw new Error(
      'Missing Lightning AI API key. Provide `apiKey` in config or set the ' +
        'LIGHTNING_API_KEY (or LIGHTNING_SANDBOX_API_KEY) environment variable.\n' +
        'Generate a key from your Lightning AI account settings: https://lightning.ai/'
    );
  }

  return apiKey;
}

/** Load the SDK and apply module-global auth/base-url config for this provider call. */
async function configured(config: LightningConfig): Promise<LightningSandboxStatic> {
  const Sandbox = await loadSandbox();
  Sandbox.configure({ apiKey: resolveApiKey(config), baseUrl: config.baseUrl });
  return Sandbox;
}

/** Map a Lightning sandbox status string onto the ComputeSDK status enum. */
function mapStatus(status: string): SandboxInfo['status'] {
  const s = (status || '').toLowerCase();
  if (s.includes('fail') || s.includes('error')) return 'error';
  if (s.includes('stop') || s.includes('pause') || s.includes('terminat') || s.includes('delet')) return 'stopped';
  return 'running';
}

export const lightning = defineProvider<LightningNativeSandbox, LightningConfig>({
  name: 'lightning',
  methods: {
    sandbox: {
      create: async (config: LightningConfig, options?: CreateSandboxOptions) => {
        const Sandbox = await configured(config);

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
          const sandbox = await Sandbox.create(params);
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
          const Sandbox = await configured(config);
          const sandbox = await Sandbox.get({ sandboxId });
          return { sandbox, sandboxId };
        } catch {
          return null;
        }
      },

      list: async (config: LightningConfig) => {
        try {
          const Sandbox = await configured(config);
          const { sandboxes } = await Sandbox.list();
          return sandboxes.map((sandbox) => ({ sandbox, sandboxId: sandbox.sandboxId }));
        } catch {
          return [];
        }
      },

      destroy: async (config: LightningConfig, sandboxId: string) => {
        try {
          const Sandbox = await configured(config);
          const sandbox = await Sandbox.get({ sandboxId });
          await sandbox.delete();
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
          const result = await sandbox.runCommand({
            cmd: 'sh',
            args: ['-c', fullCommand],
            cwd: options?.cwd,
            env: hasEnv ? options!.env : undefined,
          });

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
        },
      }),

      getUrl: async (_sandbox: LightningNativeSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        throw new Error(
          `Lightning AI does not support generating public port URLs through the SDK. ` +
            `Ports declared at create time are reachable from inside the sandbox at http://127.0.0.1:${options.port}.`
        );
      },

      filesystem: {
        readFile: async (sandbox: LightningNativeSandbox, path: string): Promise<string> => {
          const content = await sandbox.readFile({ path });
          if (content === null) throw new Error(`File not found: ${path}`);
          return content;
        },
        writeFile: async (sandbox: LightningNativeSandbox, path: string, content: string): Promise<void> => {
          await sandbox.writeFile({ path, content });
        },
        mkdir: async (sandbox: LightningNativeSandbox, path: string): Promise<void> => {
          await sandbox.fs.mkdir(path, { recursive: true });
        },
        readdir: async (sandbox: LightningNativeSandbox, path: string): Promise<FileEntry[]> => {
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
        },
        exists: async (sandbox: LightningNativeSandbox, path: string): Promise<boolean> => {
          return sandbox.fs.exists(path);
        },
        remove: async (sandbox: LightningNativeSandbox, path: string): Promise<void> => {
          await sandbox.fs.rm(path, { recursive: true });
        },
      },

      getInstance: (sandbox: LightningNativeSandbox): LightningNativeSandbox => sandbox,
    },
  },
});
