/**
 * Modal Provider - Factory-based Implementation
 */

import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

import { ModalClient } from 'modal';
import type { Sandbox, App, Image, SandboxCreateParams } from 'modal';

type ModalNativeSandbox = Sandbox;


const DEFAULT_IMAGE = 'node:20';
const DEFAULT_APP_NAME = 'computesdk-modal';


export interface ModalConfig {
  tokenId?: string;
  tokenSecret?: string;
  timeout?: number;
  environment?: string;
  ports?: number[];
  appName?: string;
}

/**
 * extends ModalConfig with resources initialised once at
 * factory time so they don't need to be recreated on every sandbox operation.
 */
interface ModalInternalConfig extends ModalConfig {
  _client: ModalClient;
  _appPromise: Promise<App>;
}


interface ModalSandbox {
  sandbox: ModalNativeSandbox;
  sandboxId: string;
}

const _modal = defineProvider<ModalSandbox, ModalInternalConfig>({
  name: 'modal',
  methods: {
    sandbox: {
      create: async (config: ModalInternalConfig, options?: CreateSandboxOptions) => {
        try {
          const client = config._client;

          const app = await config._appPromise;

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
            ...providerOptions
          } = options || {};

          let image: Image;
          const sourceId = snapshotId || templateId;
          if (sourceId) {
            try {
              image = await client.images.fromId(sourceId);
            } catch {
              image = client.images.fromRegistry(sourceId);
            }
          } else {
            image = client.images.fromRegistry(DEFAULT_IMAGE);
          }

          const sandboxOptions: SandboxCreateParams = {
            ...(providerOptions as Partial<SandboxCreateParams>),
          };

          const ports = optPorts ?? config.ports;
          if (ports && ports.length > 0) sandboxOptions.unencryptedPorts = ports;

          const timeout = optTimeout ?? config.timeout;
          if (timeout) sandboxOptions.timeoutMs = timeout;

          if (envs && Object.keys(envs).length > 0) sandboxOptions.env = envs;
          if (name) sandboxOptions.name = name;

          const sandbox = await client.sandboxes.create(app, image, sandboxOptions);
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
          const [stdout, stderr] = await Promise.all([process.stdout.readText(), process.stderr.readText()]);
          const exitCode = await process.wait();
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
        readFile: async (modalSandbox: ModalSandbox, path: string): Promise<string> => {
          try {
            const file = await modalSandbox.sandbox.open(path);
            try {
              const data = await file.read();
              const content = new TextDecoder().decode(data);
              return content;
            } finally {
              await file.close();
            }
          } catch (error) {
            try {
              const process = await modalSandbox.sandbox.exec(['cat', path], { stdout: 'pipe', stderr: 'pipe' });
              const [content, stderr] = await Promise.all([process.stdout.readText(), process.stderr.readText()]);
              const exitCode = await process.wait();
              if (exitCode !== 0) throw new Error(`cat failed: ${stderr}`);
              return content.trim();
            } catch {
              throw new Error(`Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        },
        writeFile: async (modalSandbox: ModalSandbox, path: string, content: string): Promise<void> => {
          const file = await modalSandbox.sandbox.open(path, 'w');
          try {
            await file.write(new TextEncoder().encode(content));
          } finally {
            await file.close();
          }
        },
        mkdir: async (modalSandbox: ModalSandbox, path: string): Promise<void> => {
          const process = await modalSandbox.sandbox.exec(['mkdir', '-p', path], { stdout: 'pipe', stderr: 'pipe' });
          const [, stderr] = await Promise.all([process.stdout.readText(), process.stderr.readText()]);
          const exitCode = await process.wait();
          if (exitCode !== 0) throw new Error(`mkdir failed: ${stderr}`);
        },
        readdir: async (modalSandbox: ModalSandbox, path: string): Promise<FileEntry[]> => {
          const process = await modalSandbox.sandbox.exec(['ls', '-la', path], { stdout: 'pipe', stderr: 'pipe' });
          const [output, stderr] = await Promise.all([process.stdout.readText(), process.stderr.readText()]);
          const exitCode = await process.wait();
          if (exitCode !== 0) throw new Error(`ls failed: ${stderr}`);
          const lines = output.split('\n').slice(1);
          return lines.filter((l: string) => l.trim()).map((line: string) => {
            const parts = line.trim().split(/\s+/);
            const permissions = parts[0] || '';
            const size = parseInt(parts[4]) || 0;
            const dateStr = (parts[5] || '') + ' ' + (parts[6] || '');
            const date = dateStr.trim() ? new Date(dateStr) : new Date();
            const name = parts.slice(8).join(' ') || parts[parts.length - 1] || 'unknown';
            return { name, type: permissions.startsWith('d') ? 'directory' as const : 'file' as const, size, modified: isNaN(date.getTime()) ? new Date() : date };
          });
        },
        exists: async (modalSandbox: ModalSandbox, path: string): Promise<boolean> => {
          try { const process = await modalSandbox.sandbox.exec(['test', '-e', path]); return await process.wait() === 0; } catch { return false; }
        },
        remove: async (modalSandbox: ModalSandbox, path: string): Promise<void> => {
          const process = await modalSandbox.sandbox.exec(['rm', '-rf', path], { stdout: 'pipe', stderr: 'pipe' });
          const [, stderr] = await Promise.all([process.stdout.readText(), process.stderr.readText()]);
          const exitCode = await process.wait();
          if (exitCode !== 0) throw new Error(`rm failed: ${stderr}`);
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
  });
}
