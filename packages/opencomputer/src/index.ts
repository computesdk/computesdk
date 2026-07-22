/**
 * OpenComputer Provider - Factory-based Implementation
 *
 * Wraps the official `@opencomputer/sdk` so OpenComputer sandboxes can be used
 * through the ComputeSDK provider interface.
 */

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

interface OpenComputerSandboxOpts {
  template?: string;
  timeout?: number;
  apiKey?: string;
  apiUrl?: string;
  envs?: Record<string, string>;
  metadata?: Record<string, string>;
  cpuCount?: number;
  memoryMB?: number;
  diskMB?: number;
  secretStore?: string;
  snapshot?: string;
  burst?: boolean;
  sandboxFamily?: 'spot';
  previewAuth?: { scheme?: 'bearer'; token?: 'auto' | string };
  webhooks?: Array<{ url: string; secret?: string; eventTypes?: string[] }>;
}

interface OpenComputerProcessResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

interface OpenComputerEntryInfo {
  name: string;
  isDir: boolean;
  path: string;
  size: number;
}

interface OpenComputerCheckpointInfo {
  id: string;
  sandboxId?: string;
  orgId?: string;
  name?: string;
  status?: string;
  sizeBytes?: number;
  createdAt?: string;
  sandboxConfig?: Record<string, unknown>;
}

interface OpenComputerPreviewURLResult {
  hostname?: string;
  customHostname?: string;
  port: number;
}

interface OpenComputerNativeSandbox {
  readonly sandboxId: string;
  readonly id: string;
  readonly status: string;
  readonly previewAuthToken?: string;
  readonly webhooks?: Array<{ id: string; url: string; secret?: string }>;
  readonly commands: {
    run(command: string, opts?: { cwd?: string; env?: Record<string, string>; timeout?: number; timeoutMs?: number }): Promise<OpenComputerProcessResult>;
  };
  readonly exec?: {
    run(command: string, opts?: { cwd?: string; env?: Record<string, string>; timeout?: number; timeoutMs?: number }): Promise<OpenComputerProcessResult>;
  };
  readonly files: {
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    makeDir(path: string): Promise<void>;
    list(path?: string): Promise<OpenComputerEntryInfo[]>;
    exists(path: string): Promise<boolean>;
    remove(path: string): Promise<void>;
  };
  getPreviewDomain(port: number): string;
  createPreviewURL(opts: { port: number; domain?: string; authConfig?: Record<string, unknown> }): Promise<OpenComputerPreviewURLResult>;
  listPreviewURLs(): Promise<OpenComputerPreviewURLResult[]>;
  kill(): Promise<void>;
  isRunning(): Promise<boolean>;
  createCheckpoint(name: string, opts?: { kind?: 'full' | 'disk_only'; promoteToFull?: boolean; retentionPolicy?: unknown }): Promise<OpenComputerCheckpointInfo>;
  listCheckpoints(): Promise<OpenComputerCheckpointInfo[]>;
  deleteCheckpoint(checkpointId: string): Promise<void>;
}

interface OpenComputerSandboxStatic {
  create(opts?: OpenComputerSandboxOpts): Promise<OpenComputerNativeSandbox>;
  connect(sandboxId: string, opts?: Pick<OpenComputerSandboxOpts, 'apiKey' | 'apiUrl'>): Promise<OpenComputerNativeSandbox>;
  createFromCheckpoint(checkpointId: string, opts?: Pick<OpenComputerSandboxOpts, 'apiKey' | 'apiUrl' | 'timeout' | 'envs' | 'secretStore'>): Promise<OpenComputerNativeSandbox>;
}

let _SandboxClass: OpenComputerSandboxStatic | null = null;

async function loadSandbox(): Promise<OpenComputerSandboxStatic> {
  if (!_SandboxClass) {
    const mod = await import('@opencomputer/sdk');
    _SandboxClass = (mod as { Sandbox: OpenComputerSandboxStatic }).Sandbox;
  }
  return _SandboxClass;
}

export interface OpenComputerConfig {
  /** OpenComputer API key - falls back to OPENCOMPUTER_API_KEY. */
  apiKey?: string;
  /** OpenComputer API URL - falls back to OPENCOMPUTER_API_URL, then production. */
  apiUrl?: string;
  /** Default template for new sandboxes. Defaults to OpenComputer's `base` template. */
  template?: string;
  /** Default idle timeout in milliseconds. OpenComputer receives this as seconds. */
  timeout?: number;
  /** Default environment variables for new sandboxes. */
  envs?: Record<string, string>;
  /** Default metadata for new sandboxes. */
  metadata?: Record<string, string>;
  /** OpenComputer CPU count for new sandboxes. */
  cpuCount?: number;
  /** OpenComputer memory size in MB for new sandboxes. */
  memoryMB?: number;
  /** OpenComputer workspace disk size in MB for new sandboxes. */
  diskMB?: number;
  /** Secret store to attach to new sandboxes. */
  secretStore?: string;
  /** Create Burst sandboxes by default. */
  burst?: boolean;
  /** Require bearer auth on preview URLs. */
  previewAuth?: { scheme?: 'bearer'; token?: 'auto' | string };
}

export interface OpenComputerSnapshot {
  id: string;
  provider: 'opencomputer';
  createdAt: Date;
  metadata: {
    sandboxId?: string;
    orgId?: string;
    name?: string;
    status?: string;
    sizeBytes?: number;
    sandboxConfig?: Record<string, unknown>;
  };
}

function env(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}

function baseOpts(config: OpenComputerConfig): Pick<OpenComputerSandboxOpts, 'apiKey' | 'apiUrl'> {
  return {
    apiKey: config.apiKey || env('OPENCOMPUTER_API_KEY'),
    apiUrl: config.apiUrl || env('OPENCOMPUTER_API_URL'),
  };
}

function toSeconds(milliseconds: number | undefined): number | undefined {
  return milliseconds == null ? undefined : Math.ceil(milliseconds / 1000);
}

function stringifyMetadata(metadata: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!metadata) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

function createOpts(config: OpenComputerConfig, options?: CreateSandboxOptions): OpenComputerSandboxOpts {
  return {
    ...baseOpts(config),
    template: options?.templateId || config.template,
    timeout: toSeconds(options?.timeout ?? config.timeout),
    envs: { ...config.envs, ...options?.envs },
    metadata: { ...config.metadata, ...stringifyMetadata(options?.metadata) },
    cpuCount: (options as any)?.cpuCount ?? config.cpuCount,
    memoryMB: (options as any)?.memoryMB ?? (options as any)?.memory ?? config.memoryMB,
    diskMB: (options as any)?.diskMB ?? config.diskMB,
    secretStore: (options as any)?.secretStore ?? config.secretStore,
    burst: (options as any)?.burst ?? config.burst,
    sandboxFamily: (options as any)?.sandboxFamily,
    previewAuth: (options as any)?.previewAuth ?? config.previewAuth,
    webhooks: (options as any)?.webhooks,
  };
}

function snapshotToCompute(snapshot: OpenComputerCheckpointInfo): OpenComputerSnapshot {
  const id = snapshot.sandboxId ? `${snapshot.sandboxId}:${snapshot.id}` : snapshot.id;
  return {
    id,
    provider: 'opencomputer',
    createdAt: snapshot.createdAt ? new Date(snapshot.createdAt) : new Date(),
    metadata: {
      sandboxId: snapshot.sandboxId,
      orgId: snapshot.orgId,
      name: snapshot.name,
      status: snapshot.status,
      sizeBytes: snapshot.sizeBytes,
      sandboxConfig: snapshot.sandboxConfig,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCheckpointReady(
  sandbox: OpenComputerNativeSandbox,
  checkpoint: OpenComputerCheckpointInfo,
  timeoutMs = 300_000,
): Promise<OpenComputerCheckpointInfo> {
  if (checkpoint.status === 'ready') return checkpoint;
  if (checkpoint.status === 'failed') {
    throw new Error(`OpenComputer checkpoint ${checkpoint.id} failed.`);
  }

  const deadline = Date.now() + timeoutMs;
  let delay = 1_000;

  for (;;) {
    if (Date.now() >= deadline) {
      throw new Error(`OpenComputer checkpoint ${checkpoint.id} was not ready after ${timeoutMs}ms.`);
    }

    const checkpoints = await sandbox.listCheckpoints();
    const current = checkpoints.find((candidate) => candidate.id === checkpoint.id);
    if (!current) {
      throw new Error(`OpenComputer checkpoint ${checkpoint.id} disappeared while waiting for readiness.`);
    }
    if (current.status === 'ready') return current;
    if (current.status === 'failed') {
      throw new Error(`OpenComputer checkpoint ${checkpoint.id} failed.`);
    }

    await sleep(delay);
    delay = Math.min(delay * 1.5, 5_000);
  }
}

function isCheckpointIndexMiss(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes('404') && error.message.includes('checkpoint not found');
}

async function createFromCheckpointWithRetry(
  Sandbox: OpenComputerSandboxStatic,
  checkpointId: string,
  opts: Pick<OpenComputerSandboxOpts, 'apiKey' | 'apiUrl' | 'timeout' | 'envs' | 'secretStore'>,
  timeoutMs = 60_000,
): Promise<OpenComputerNativeSandbox> {
  const deadline = Date.now() + timeoutMs;
  let delay = 1_000;

  for (;;) {
    try {
      return await Sandbox.createFromCheckpoint(checkpointId, opts);
    } catch (error) {
      if (!isCheckpointIndexMiss(error) || Date.now() >= deadline) {
        throw error;
      }
      await sleep(delay);
      delay = Math.min(delay * 1.5, 5_000);
    }
  }
}

async function createSandbox(config: OpenComputerConfig, options?: CreateSandboxOptions) {
  const Sandbox = await loadSandbox();
  const opts = createOpts(config, options);

  if (options?.snapshotId) {
    const checkpointId = options.snapshotId.includes(':')
      ? options.snapshotId.slice(options.snapshotId.indexOf(':') + 1)
      : options.snapshotId;
    const sandbox = await createFromCheckpointWithRetry(Sandbox, checkpointId, {
      ...baseOpts(config),
      timeout: opts.timeout,
      envs: opts.envs,
      secretStore: opts.secretStore,
    });
    return { sandbox, sandboxId: sandbox.sandboxId || sandbox.id };
  }

  const sandbox = await Sandbox.create(opts);
  return { sandbox, sandboxId: sandbox.sandboxId || sandbox.id };
}

const _provider = defineProvider<OpenComputerNativeSandbox, OpenComputerConfig, any, OpenComputerSnapshot>({
  name: 'opencomputer',
  methods: {
    sandbox: {
      create: createSandbox,

      getById: async (config: OpenComputerConfig, sandboxId: string) => {
        const Sandbox = await loadSandbox();
        try {
          const sandbox = await Sandbox.connect(sandboxId, baseOpts(config));
          return { sandbox, sandboxId: sandbox.sandboxId || sandbox.id || sandboxId };
        } catch (error) {
          if (error instanceof Error && (error.message.includes('404') || error.message.includes('not found'))) {
            return null;
          }
          throw new Error(`Failed to get OpenComputer sandbox ${sandboxId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      list: async () => {
        throw new Error('OpenComputer provider does not support listing sandboxes via the TypeScript SDK.');
      },

      destroy: async (config: OpenComputerConfig, sandboxId: string) => {
        const Sandbox = await loadSandbox();
        try {
          const sandbox = await Sandbox.connect(sandboxId, baseOpts(config));
          await sandbox.kill();
        } catch (error) {
          if (error instanceof Error && (error.message.includes('404') || error.message.includes('not found'))) {
            return;
          }
          throw new Error(`Failed to destroy OpenComputer sandbox ${sandboxId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      runCommand: async (sandbox: OpenComputerNativeSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          const runOptions = {
            cwd: options?.cwd,
            env: options?.env,
            timeout: toSeconds(options?.timeout),
            timeoutMs: options?.timeout,
          };
          const result = await (sandbox.exec ?? sandbox.commands).run(
            options?.background ? `nohup ${command} > /dev/null 2>&1 &` : command,
            runOptions,
          );
          return {
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            exitCode: result.exitCode ?? 0,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          throw new Error(`OpenComputer command execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getInfo: async (sandbox: OpenComputerNativeSandbox): Promise<SandboxInfo> => {
        let status = sandbox.status;
        try {
          status = (await sandbox.isRunning()) ? 'running' : sandbox.status;
        } catch {
          status = sandbox.status;
        }

        return {
          id: sandbox.sandboxId || sandbox.id,
          provider: 'opencomputer',
          status: status === 'running' ? 'running' : status === 'error' ? 'error' : 'stopped',
          createdAt: new Date(),
          timeout: 0,
          metadata: {
            opencomputerSandboxId: sandbox.sandboxId || sandbox.id,
            previewAuthToken: sandbox.previewAuthToken || undefined,
            webhooks: sandbox.webhooks,
          },
        };
      },

      getUrl: async (sandbox: OpenComputerNativeSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        const protocol = options.protocol || 'https';
        const domain = sandbox.getPreviewDomain(options.port);
        if (domain) {
          return `${protocol}://${domain}`;
        }

        const preview = await sandbox.createPreviewURL({ port: options.port });
        const hostname = preview.customHostname || preview.hostname;
        if (!hostname) {
          throw new Error(`OpenComputer did not return a preview hostname for port ${options.port}.`);
        }
        return `${protocol}://${hostname}`;
      },

      filesystem: {
        readFile: async (sandbox: OpenComputerNativeSandbox, path: string): Promise<string> =>
          sandbox.files.read(path),
        writeFile: async (sandbox: OpenComputerNativeSandbox, path: string, content: string): Promise<void> => {
          await sandbox.files.write(path, content);
        },
        mkdir: async (sandbox: OpenComputerNativeSandbox, path: string): Promise<void> => {
          await sandbox.files.makeDir(path);
        },
        readdir: async (sandbox: OpenComputerNativeSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await sandbox.files.list(path);
          return entries.map((entry) => ({
            name: entry.name,
            type: entry.isDir ? 'directory' as const : 'file' as const,
            size: entry.size,
            modified: new Date(),
          }));
        },
        exists: async (sandbox: OpenComputerNativeSandbox, path: string): Promise<boolean> =>
          sandbox.files.exists(path),
        remove: async (sandbox: OpenComputerNativeSandbox, path: string): Promise<void> => {
          await sandbox.files.remove(path);
        },
      },

      getInstance: (sandbox: OpenComputerNativeSandbox): OpenComputerNativeSandbox => sandbox,
    },

    snapshot: {
      create: async (config: OpenComputerConfig, sandboxId: string, options?: CreateSnapshotOptions) => {
        const Sandbox = await loadSandbox();
        const sandbox = await Sandbox.connect(sandboxId, baseOpts(config));
        const metadata = options?.metadata as
          | { kind?: 'full' | 'disk_only'; promoteToFull?: boolean; retentionPolicy?: unknown }
          | undefined;
        const kind = metadata?.kind ?? 'disk_only';
        const snapshot = await sandbox.createCheckpoint(options?.name || `snapshot-${Date.now()}`, {
          kind,
          promoteToFull: metadata?.promoteToFull ?? (kind === 'disk_only' ? true : undefined),
          retentionPolicy: metadata?.retentionPolicy,
        });
        return snapshotToCompute(await waitForCheckpointReady(sandbox, snapshot));
      },
      list: async (config: OpenComputerConfig, options?: ListSnapshotsOptions) => {
        if (!options?.sandboxId) {
          throw new Error('OpenComputer snapshots are scoped to a sandbox. Pass `sandboxId` to list snapshots.');
        }
        const Sandbox = await loadSandbox();
        const sandbox = await Sandbox.connect(options.sandboxId, baseOpts(config));
        const snapshots = await sandbox.listCheckpoints();
        return snapshots.map(snapshotToCompute);
      },
      delete: async (config: OpenComputerConfig, snapshotId: string) => {
        const sandboxId = snapshotId.split(':', 1)[0];
        if (!sandboxId || sandboxId === snapshotId) {
          throw new Error('OpenComputer snapshot deletion requires a sandbox-scoped id in the form `sandboxId:checkpointId`.');
        }
        const checkpointId = snapshotId.slice(sandboxId.length + 1);
        const Sandbox = await loadSandbox();
        const sandbox = await Sandbox.connect(sandboxId, baseOpts(config));
        await sandbox.deleteCheckpoint(checkpointId);
      },
    },
  },
});

export const opencomputer = (config: OpenComputerConfig = {}) => _provider(config);
export type { OpenComputerNativeSandbox };
