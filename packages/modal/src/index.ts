/**
 * Modal Provider - Factory-based Implementation
 */

import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

import { ModalClient, SandboxFilesystemNotFoundError } from 'modal';
import type { Sandbox, App, Image, SandboxCreateParams } from 'modal';

type ModalNativeSandbox = Sandbox;


const DEFAULT_IMAGE = 'node:20';
const DEFAULT_APP_NAME = 'computesdk-modal';
const DEFAULT_DAEMON_SSE_PORT = 38989;

function mergeExposedPorts(primary?: number[], fallback?: number[], daemonSsePort?: number | false): number[] {
  const daemonPort = daemonSsePort === false ? undefined : (daemonSsePort ?? DEFAULT_DAEMON_SSE_PORT);
  const merged = [...(primary ?? fallback ?? [])];
  if (typeof daemonPort === 'number') merged.push(daemonPort);
  return Array.from(new Set(merged.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535)));
}

async function loadImage(client: ModalClient, app: App, sourceId: string | undefined): Promise<Image> {
  let image: Image;
  if (sourceId) {
    try {
      image = await client.images.fromId(sourceId);
    } catch {
      image = client.images.fromRegistry(sourceId);
    }
  } else {
    image = client.images.fromRegistry(DEFAULT_IMAGE);
  }
  return image.build(app);
}


export interface ModalConfig {
  tokenId?: string;
  tokenSecret?: string;
  timeout?: number;
  environment?: string;
  ports?: number[];
  daemonSsePort?: number | false;
  appName?: string;
  scalableSandboxes?: boolean;
}

export interface ModalCreateSandboxOptions extends CreateSandboxOptions {
  daemonSsePort?: number | false;
  scalableSandboxes?: boolean;
}

/**
 * extends ModalConfig with resources initialised once at
 * factory time so they don't need to be recreated on every sandbox operation.
 */
interface ModalInternalConfig extends ModalConfig {
  _client: ModalClient;
  _appPromise: Promise<App>;
  _imageCache: Map<string, Promise<Image>>;
}


interface ModalSandbox {
  sandbox: ModalNativeSandbox;
  sandboxId: string;
}

/** The framework-supplied command runner handed to filesystem callbacks. */
type CommandRunner = (
  sandbox: ModalSandbox,
  command: string,
  options?: RunCommandOptions,
) => Promise<CommandResult>;

const FALLBACK_WORKDIR = '/';

/** Cached `pwd` probes: relative filesystem paths resolve against the cwd a
 *  `runCommand` exec would use, so `writeFile('a.txt')` and `cat a.txt` agree. */
const workdirs = new WeakMap<ModalSandbox, Promise<string>>();

function workdirOf(sandbox: ModalSandbox, runCommand: CommandRunner): Promise<string> {
  let probe = workdirs.get(sandbox);
  if (!probe) {
    probe = runCommand(sandbox, 'pwd').then((result) => {
      const dir = result.stdout.trim();
      if (result.exitCode === 0 && dir.startsWith('/')) return dir;
      // runCommand reports exec failures as results, not rejections, so a
      // transient failure must not pin the workdir to the fallback forever —
      // evict and let the next filesystem op probe again.
      workdirs.delete(sandbox);
      return FALLBACK_WORKDIR;
    });
    workdirs.set(sandbox, probe);
    probe.catch(() => workdirs.delete(sandbox));
  }
  return probe;
}

/** Join `path` onto the sandbox workdir. Absolute paths pass through and skip
 *  the probe; empty and `.` segments are dropped; `..` segments are preserved
 *  for the sandbox filesystem to resolve physically — collapsing them
 *  lexically would mis-resolve when a preceding component is a symlink. */
async function resolveSandboxPath(
  sandbox: ModalSandbox,
  path: string,
  runCommand: CommandRunner,
): Promise<string> {
  const combined = path.startsWith('/')
    ? path
    : `${await workdirOf(sandbox, runCommand)}/${path}`;
  const segments: string[] = [];
  for (const segment of combined.split('/')) {
    if (segment === '' || segment === '.') continue;
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

const _modal = defineProvider<ModalSandbox, ModalInternalConfig>({
  name: 'modal',
  methods: {
    sandbox: {
      create: async (config: ModalInternalConfig, options?: CreateSandboxOptions) => {
        try {
          const client = config._client;

          const app = await config._appPromise;

          const modalOptions = (options ?? {}) as ModalCreateSandboxOptions;
          const {
            timeout: optTimeout,
            envs,
            name,
            metadata: _metadata,
            templateId,
            snapshotId,
            sandboxId: _sandboxId,
            namespace: _namespace,
            directory: _directory,
            ports: optPorts,
            daemonSsePort: optDaemonSsePort,
            scalableSandboxes: optScalableSandboxes,
            ...providerOptions
          } = modalOptions;

          const sourceId = snapshotId || templateId;
          const cacheKey = sourceId ?? DEFAULT_IMAGE;
          let promise = config._imageCache.get(cacheKey);
          if (!promise) {
            promise = loadImage(client, app, sourceId).catch((err) => {
              config._imageCache.delete(cacheKey);
              throw err;
            });
            config._imageCache.set(cacheKey, promise);
          }
          const image = await promise;

          const sandboxOptions: SandboxCreateParams = {
            ...(providerOptions as Partial<SandboxCreateParams>),
          };

          const ports = mergeExposedPorts(optPorts, config.ports, optDaemonSsePort ?? config.daemonSsePort);
          if (ports && ports.length > 0) sandboxOptions.encryptedPorts = ports;

          const timeout = optTimeout ?? config.timeout;
          if (timeout) sandboxOptions.timeoutMs = timeout;

          if (envs && Object.keys(envs).length > 0) sandboxOptions.env = envs;
          if (name) sandboxOptions.name = name;

          const useScalableSandboxes = optScalableSandboxes ?? config.scalableSandboxes ?? false;
          const sandbox = useScalableSandboxes
            ? await client.sandboxes.experimentalCreate(app, image, sandboxOptions)
            : await client.sandboxes.create(app, image, sandboxOptions);
          const sandboxId = sandbox.sandboxId;

          return { sandbox: { sandbox, sandboxId }, sandboxId };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('credentials')) {
              throw new Error(`Modal authentication failed. Please provide tokenId and tokenSecret via config or set the MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables.`);
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(`Modal quota exceeded. Please check your usage at https://modal.com/`);
            }
          }
          throw new Error(`Failed to create Modal sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: ModalInternalConfig, sandboxId: string) => {
        try {
          const client = config._client;
          const sandbox = await client.sandboxes.fromId(sandboxId);
          return { sandbox: { sandbox, sandboxId }, sandboxId };
        } catch { return null; }
      },

      list: async (_config: ModalConfig) => {
        throw new Error(`Modal provider does not support listing sandboxes.`);
      },

      destroy: async (config: ModalInternalConfig, sandboxId: string) => {
        try {
          const client = config._client;
          const sandbox = await client.sandboxes.fromId(sandboxId);
          if (sandbox && typeof sandbox.terminate === 'function') await sandbox.terminate();
        } catch { /* already terminated */ }
      },

      runCommand: async (modalSandbox: ModalSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();
        try {
          let fullCommand = command;
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env).map(([k, v]) => `${k}="${escapeShellArg(String(v))}"`).join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }
          if (options?.cwd) fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          if (options?.background) fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          
          const process = await modalSandbox.sandbox.exec(['sh', '-c', fullCommand], { stdout: 'pipe', stderr: 'pipe' });
          const [stdout, stderr, exitCode] = await Promise.all([process.stdout.readText(), process.stderr.readText(), process.wait()]);
          return { stdout: stdout || '', stderr: stderr || '', exitCode: exitCode || 0, durationMs: Date.now() - startTime };
        } catch (error) {
          return { stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 127, durationMs: Date.now() - startTime };
        }
      },

      getInfo: async (modalSandbox: ModalSandbox): Promise<SandboxInfo> => {
        let status: 'running' | 'stopped' | 'error' = 'running';
        try {
          const pollResult = await modalSandbox.sandbox.poll();
          if (pollResult !== null) status = pollResult === 0 ? 'stopped' : 'error';
        } catch { status = 'running'; }

        return {
          id: modalSandbox.sandboxId,
          provider: 'modal',
          status,
          createdAt: new Date(),
          timeout: 300000,
          metadata: { modalSandboxId: modalSandbox.sandboxId, realModalImplementation: true, runtime: 'node' }
        };
      },

      getUrl: async (modalSandbox: ModalSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          const tunnels = await modalSandbox.sandbox.tunnels();
          const tunnel = tunnels[options.port];
          if (!tunnel) throw new Error(`No tunnel found for port ${options.port}. Available ports: ${Object.keys(tunnels).join(', ')}`);
          let url = tunnel.url;
          if (options.protocol) { const urlObj = new URL(url); urlObj.protocol = options.protocol + ':'; url = urlObj.toString(); }
          return url;
        } catch (error) {
          throw new Error(`Failed to get Modal tunnel URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      filesystem: {
        readFile: async (modalSandbox: ModalSandbox, path: string, runCommand: CommandRunner): Promise<string> => {
          const resolved = await resolveSandboxPath(modalSandbox, path, runCommand);
          try {
            return await modalSandbox.sandbox.filesystem.readText(resolved);
          } catch (error) {
            throw new Error(`Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
        writeFile: async (modalSandbox: ModalSandbox, path: string, content: string, runCommand: CommandRunner): Promise<void> => {
          const resolved = await resolveSandboxPath(modalSandbox, path, runCommand);
          try {
            await modalSandbox.sandbox.filesystem.writeText(content, resolved);
          } catch (error) {
            throw new Error(`Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
        mkdir: async (modalSandbox: ModalSandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          const resolved = await resolveSandboxPath(modalSandbox, path, runCommand);
          try {
            await modalSandbox.sandbox.filesystem.makeDirectory(resolved, { createParents: true });
          } catch (error) {
            throw new Error(`mkdir failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
        readdir: async (modalSandbox: ModalSandbox, path: string, runCommand: CommandRunner): Promise<FileEntry[]> => {
          const resolved = await resolveSandboxPath(modalSandbox, path, runCommand);
          try {
            const entries = await modalSandbox.sandbox.filesystem.listFiles(resolved);
            return entries.map((entry) => ({
              name: entry.name,
              type: entry.type === 'directory' ? 'directory' as const : 'file' as const,
              size: entry.size,
              modified: new Date(entry.modifiedTime * 1000),
            }));
          } catch (error) {
            throw new Error(`ls failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        },
        exists: async (modalSandbox: ModalSandbox, path: string, runCommand: CommandRunner): Promise<boolean> => {
          const resolved = await resolveSandboxPath(modalSandbox, path, runCommand);
          try {
            await modalSandbox.sandbox.filesystem.stat(resolved);
            return true;
          } catch (error) {
            if (error instanceof SandboxFilesystemNotFoundError) return false;
            throw error;
          }
        },
        remove: async (modalSandbox: ModalSandbox, path: string, runCommand: CommandRunner): Promise<void> => {
          // An empty or dot-only path would resolve to the workdir itself —
          // refuse it rather than recursively delete the sandbox's whole cwd.
          if (path.split('/').every((s) => s === '' || s === '.')) {
            throw new Error(`remove: refusing ambiguous path: ${JSON.stringify(path)}`);
          }
          const resolved = await resolveSandboxPath(modalSandbox, path, runCommand);
          try {
            await modalSandbox.sandbox.filesystem.remove(resolved, { recursive: true });
          } catch (error) {
            if (error instanceof SandboxFilesystemNotFoundError) return;
            throw new Error(`rm failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      },

      getInstance: (sandbox: ModalSandbox): ModalSandbox => sandbox,
    },

    snapshot: {
      create: async (config: ModalInternalConfig, sandboxId: string) => {
        try {
          const client = config._client;
          const sandbox = await client.sandboxes.fromId(sandboxId);
          const image = await sandbox.snapshotFilesystem();
          return { id: image.imageId, image, provider: 'modal', createdAt: new Date() };
        } catch (error) {
          throw new Error(`Failed to create Modal snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      },
      list: async (_config: ModalConfig) => [],
      delete: async (_config: ModalConfig, _snapshotId: string) => { /* No-op */ }
    }
  }
});

/**
 * Create a Modal provider instance.
 */
export function modal(config: ModalConfig = {}): ReturnType<typeof _modal> {
  const appName = config.appName ?? DEFAULT_APP_NAME;
  const client = new ModalClient({ tokenId: config.tokenId, tokenSecret: config.tokenSecret, environment: config.environment });
  const appPromise = client.apps.fromName(appName, { createIfMissing: true });

  return _modal({
    ...config,
    appName,
    _client: client,
    _appPromise: appPromise,
    _imageCache: new Map(),
  });
}
