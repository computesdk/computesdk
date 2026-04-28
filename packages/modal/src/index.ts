/**
 * Modal Provider - Factory-based Implementation
 * 
 * Full-featured provider with serverless sandbox execution using the factory pattern.
 * Leverages Modal's JavaScript SDK for real sandbox management.
 */

import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

// Import Modal SDK
import { App, Sandbox, initializeClient } from 'modal';

/**
 * Modal-specific configuration options
 */
export interface ModalConfig {
  /** Modal API token ID - if not provided, will fallback to MODAL_TOKEN_ID environment variable */
  tokenId?: string;
  /** Modal API token secret - if not provided, will fallback to MODAL_TOKEN_SECRET environment variable */
  tokenSecret?: string;
  /** Default runtime environment (e.g. 'node', 'python') */
  runtime?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Modal environment (sandbox or main) */
  environment?: string;
  /** Ports to expose */
  ports?: number[];
}

type ModalExecPipe = {
  readText: () => Promise<string>;
};

type ModalExecProcess = {
  stdout: ModalExecPipe;
  stderr: ModalExecPipe;
  wait: () => Promise<number>;
};

type ModalFileHandle = {
  read?: () => Promise<string | Uint8Array>;
  write?: (content: Uint8Array) => Promise<void>;
  close?: () => Promise<void>;
};

type ModalTunnel = { url: string };

type ModalNativeSandbox = {
  sandboxId: string;
  exec: (args: string[], options?: Record<string, unknown>) => Promise<ModalExecProcess>;
  poll: () => Promise<number | null>;
  tunnels: () => Promise<Record<number, ModalTunnel>>;
  open: (path: string) => Promise<ModalFileHandle>;
  terminate?: () => Promise<void>;
};

type ModalSnapshotImage = { objectId?: string };

type ModalSnapshotCapableSandbox = ModalNativeSandbox & {
  snapshotFilesystem: () => Promise<ModalSnapshotImage>;
};

type ModalSandboxStatics = typeof Sandbox & {
  fromSnapshot?: (snapshotId: string) => Promise<unknown>;
};

/**
 * Modal sandbox interface - wraps Modal's Sandbox class
 */
interface ModalSandbox {
  sandbox: ModalNativeSandbox;
  sandboxId: string;
}

/**
 * Detect runtime from code content
 */
function detectRuntime(code: string): string {
  // Strong Node.js indicators
  if (code.includes('console.log') || 
      code.includes('process.') ||
      code.includes('require(') ||
      code.includes('module.exports') ||
      code.includes('__dirname') ||
      code.includes('__filename') ||
      code.includes('throw new Error') ||
      code.includes('new Error(')) {
    return 'node';
  }

  // Strong Python indicators
  if (code.includes('print(') ||
      code.includes('import ') ||
      code.includes('def ') ||
      code.includes('sys.') ||
      code.includes('json.') ||
      code.includes('f"') ||
      code.includes("f'") ||
      code.includes('raise ')) {
    return 'python';
  }

  return 'node';
}

/**
 * Create a Modal provider instance using the factory pattern
 */
export const modal = defineProvider<ModalSandbox, ModalConfig>({
  name: 'modal',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: ModalConfig, options?: CreateSandboxOptions) => {
        // Validate API credentials
        const tokenId = config.tokenId || (typeof process !== 'undefined' && process.env?.MODAL_TOKEN_ID) || '';
        const tokenSecret = config.tokenSecret || (typeof process !== 'undefined' && process.env?.MODAL_TOKEN_SECRET) || '';

        if (!tokenId || !tokenSecret) {
          throw new Error(
            `Missing Modal API credentials. Provide 'tokenId' and 'tokenSecret' in config or set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables. Get your credentials from https://modal.com/`
          );
        }

        try {
          // Initialize Modal client with credentials
          initializeClient({ tokenId, tokenSecret });

          let sandbox: ModalNativeSandbox;
          let sandboxId: string;

          // Create new Modal sandbox
          const app = await App.lookup('computesdk-modal', { createIfMissing: true });

            // Destructure known ComputeSDK fields, collect the rest for passthrough
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
              ...providerOptions
            } = options || {};

            const optPorts = (options as any)?.ports as number[] | undefined;
            
            const createSandbox = app.createSandbox.bind(app);
            type ModalImageArg = Parameters<typeof createSandbox>[0];
            let image: ModalImageArg;
            // Modal supports snapshotId and templateId (both map to image)
            const sourceId = snapshotId || templateId;
            if (sourceId) {
              // Create from snapshot/template
              try {
                const snapshotFactory = Sandbox as ModalSandboxStatics;
                if (typeof snapshotFactory.fromSnapshot !== 'function') {
                  throw new Error('Modal SDK does not expose fromSnapshot in this version');
                }
                const snapshot = await snapshotFactory.fromSnapshot(sourceId) as ModalImageArg;
                image = snapshot;
              } catch (e) {
                // Fallback: try to treat it as a registry image
                image = await app.imageFromRegistry(sourceId); 
              }
            } else {
              // Default to Node.js (more appropriate for a Node.js SDK)
              image = await app.imageFromRegistry('node:20');
            }
            
            // Configure sandbox options
            const sandboxOptions: Record<string, unknown> = {
              ...providerOptions,
            };
            
            // Configure ports if provided
            const ports = optPorts ?? config.ports;
            if (ports && ports.length > 0) {
              sandboxOptions.unencryptedPorts = ports;
            }
            
            // options.timeout takes precedence over config.timeout
            const timeout = optTimeout ?? config.timeout;
            if (timeout) {
              sandboxOptions.timeoutMs = timeout;
            }

            // Remap envs to env (Modal uses 'env')
            if (envs && Object.keys(envs).length > 0) {
              sandboxOptions.env = envs;
            }

            // Pass sandbox name
            if (name) {
              sandboxOptions.name = name;
            }
            
          sandbox = await app.createSandbox(image, sandboxOptions);
          sandboxId = sandbox.sandboxId;

          const modalSandbox: ModalSandbox = {
            sandbox,
            sandboxId
          };

          return {
            sandbox: modalSandbox,
            sandboxId
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('credentials')) {
              throw new Error(
                `Modal authentication failed. Please check your MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables. Get your credentials from https://modal.com/`
              );
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(
                `Modal quota exceeded. Please check your usage at https://modal.com/`
              );
            }
          }
          throw new Error(
            `Failed to create Modal sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: ModalConfig, sandboxId: string) => {
        const tokenId = config.tokenId || process.env.MODAL_TOKEN_ID!;
        const tokenSecret = config.tokenSecret || process.env.MODAL_TOKEN_SECRET!;

        try {
          initializeClient({ tokenId, tokenSecret });
          const sandbox = await Sandbox.fromId(sandboxId);

          const modalSandbox: ModalSandbox = {
            sandbox,
            sandboxId
          };

          return {
            sandbox: modalSandbox,
            sandboxId
          };
        } catch (error) {
          // Sandbox doesn't exist or can't be accessed
          return null;
        }
      },

      list: async (_config: ModalConfig) => {
        throw new Error(
          `Modal provider does not support listing sandboxes. Modal sandboxes are managed individually through the Modal console. Use getById to reconnect to specific sandboxes by ID.`
        );
      },

      destroy: async (_config: ModalConfig, sandboxId: string) => {
        try {
          const sandbox = await Sandbox.fromId(sandboxId);
          if (sandbox && typeof sandbox.terminate === 'function') {
            await sandbox.terminate();
          }
        } catch (error) {
          // Sandbox might already be terminated or doesn't exist
        }
      },

      // Instance operations (map to individual Sandbox methods)

      runCommand: async (modalSandbox: ModalSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();

        try {
          let fullCommand = command;
          
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env)
              .map(([k, v]) => `${k}="${escapeShellArg(String(v))}"`)
              .join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }
          
          if (options?.cwd) {
            fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          }
          
          if (options?.background) {
            fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          }
          
          const process = await modalSandbox.sandbox.exec(['sh', '-c', fullCommand], {
            stdout: 'pipe',
            stderr: 'pipe'
          });

          const [stdout, stderr] = await Promise.all([
            process.stdout.readText(),
            process.stderr.readText()
          ]);

          const exitCode = await process.wait();

          return {
            stdout: stdout || '',
            stderr: stderr || '',
            exitCode: exitCode || 0,
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

      getInfo: async (modalSandbox: ModalSandbox): Promise<SandboxInfo> => {
        let status: 'running' | 'stopped' | 'error' = 'running';
        try {
          const pollResult = await modalSandbox.sandbox.poll();
          if (pollResult !== null) {
            status = pollResult === 0 ? 'stopped' : 'error';
          }
        } catch (error) {
          status = 'running';
        }

        return {
          id: modalSandbox.sandboxId,
          provider: 'modal',
          status,
          createdAt: new Date(),
          timeout: 300000,
          metadata: {
            modalSandboxId: modalSandbox.sandboxId,
            realModalImplementation: true,
            runtime: 'node',
          }
        };
      },

      getUrl: async (modalSandbox: ModalSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          const tunnels = await modalSandbox.sandbox.tunnels();
          const tunnel = tunnels[options.port];
          
          if (!tunnel) {
            throw new Error(`No tunnel found for port ${options.port}. Available ports: ${Object.keys(tunnels).join(', ')}`);
          }
          
          let url = tunnel.url;
          
          if (options.protocol) {
            const urlObj = new URL(url);
            urlObj.protocol = options.protocol + ':';
            url = urlObj.toString();
          }
          
          return url;
        } catch (error) {
          throw new Error(
            `Failed to get Modal tunnel URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      // Optional filesystem methods - Modal supports filesystem operations
      filesystem: {
        readFile: async (modalSandbox: ModalSandbox, path: string): Promise<string> => {
          try {
            const file = await modalSandbox.sandbox.open(path);
            
            let content = '';
            if (file && typeof file.read === 'function') {
              const data = await file.read();
              content = typeof data === 'string' ? data : new TextDecoder().decode(data);
            }
            
            if (file && typeof file.close === 'function') {
              await file.close();
            }
            
            return content;
          } catch (error) {
            try {
              const process = await modalSandbox.sandbox.exec(['cat', path], {
                stdout: 'pipe',
                stderr: 'pipe'
              });

              const [content, stderr] = await Promise.all([
                process.stdout.readText(),
                process.stderr.readText()
              ]);

              const exitCode = await process.wait();

              if (exitCode !== 0) {
                throw new Error(`cat failed: ${stderr}`);
              }

              return content.trim();
            } catch (fallbackError) {
              throw new Error(`Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        },

        writeFile: async (modalSandbox: ModalSandbox, path: string, content: string): Promise<void> => {
          try {
            const file = await modalSandbox.sandbox.open(path);
            
            if (file && typeof file.write === 'function') {
              await file.write(new TextEncoder().encode(content));
            }
            
            if (file && typeof file.close === 'function') {
              await file.close();
            }
          } catch (error) {
            try {
              const process = await modalSandbox.sandbox.exec(['sh', '-c', `printf '%s' "${content.replace(/"/g, '\\"')}" > "${path}"`], {
                stdout: 'pipe',
                stderr: 'pipe'
              });

              const [, stderr] = await Promise.all([
                process.stdout.readText(),
                process.stderr.readText()
              ]);

              const exitCode = await process.wait();

              if (exitCode !== 0) {
                throw new Error(`write failed: ${stderr}`);
              }
            } catch (fallbackError) {
              throw new Error(`Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        },

        mkdir: async (modalSandbox: ModalSandbox, path: string): Promise<void> => {
          try {
            const process = await modalSandbox.sandbox.exec(['mkdir', '-p', path], {
              stdout: 'pipe',
              stderr: 'pipe'
            });

            const [, stderr] = await Promise.all([
              process.stdout.readText(),
              process.stderr.readText()
            ]);

            const exitCode = await process.wait();

            if (exitCode !== 0) {
              throw new Error(`mkdir failed: ${stderr}`);
            }
          } catch (error) {
            throw new Error(`Failed to create directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        readdir: async (modalSandbox: ModalSandbox, path: string): Promise<FileEntry[]> => {
          try {
            const process = await modalSandbox.sandbox.exec(['ls', '-la', path], {
              stdout: 'pipe',
              stderr: 'pipe'
            });

            const [output, stderr] = await Promise.all([
              process.stdout.readText(),
              process.stderr.readText()
            ]);

            const exitCode = await process.wait();

            if (exitCode !== 0) {
              throw new Error(`ls failed: ${stderr}`);
            }

            const lines = output.split('\n').slice(1);

            return lines
              .filter((line: string) => line.trim())
              .map((line: string) => {
                const parts = line.trim().split(/\s+/);
                const permissions = parts[0] || '';
                const size = parseInt(parts[4]) || 0;
                const dateStr = (parts[5] || '') + ' ' + (parts[6] || '');
                const date = dateStr.trim() ? new Date(dateStr) : new Date();
                const name = parts.slice(8).join(' ') || parts[parts.length - 1] || 'unknown';

                return {
                  name,
                  type: permissions.startsWith('d') ? 'directory' as const : 'file' as const,
                  size,
                  modified: isNaN(date.getTime()) ? new Date() : date
                };
              });
          } catch (error) {
            throw new Error(`Failed to read directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        exists: async (modalSandbox: ModalSandbox, path: string): Promise<boolean> => {
          try {
            const process = await modalSandbox.sandbox.exec(['test', '-e', path]);
            const exitCode = await process.wait();
            return exitCode === 0;
          } catch (error) {
            return false;
          }
        },

        remove: async (modalSandbox: ModalSandbox, path: string): Promise<void> => {
          try {
            const process = await modalSandbox.sandbox.exec(['rm', '-rf', path], {
              stdout: 'pipe',
              stderr: 'pipe'
            });

            const [, stderr] = await Promise.all([
              process.stdout.readText(),
              process.stderr.readText()
            ]);

            const exitCode = await process.wait();

            if (exitCode !== 0) {
              throw new Error(`rm failed: ${stderr}`);
            }
          } catch (error) {
            throw new Error(`Failed to remove ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      },

      // Provider-specific typed getInstance method
      getInstance: (sandbox: ModalSandbox): ModalSandbox => {
        return sandbox;
      },

    },

    snapshot: {
      create: async (config: ModalConfig, sandboxId: string, options?: { name?: string }) => {
        const tokenId = config.tokenId || process.env.MODAL_TOKEN_ID!;
        const tokenSecret = config.tokenSecret || process.env.MODAL_TOKEN_SECRET!;

        try {
          initializeClient({ tokenId, tokenSecret });
          const sandbox = await Sandbox.fromId(sandboxId);
          
          const snapshotSandbox = sandbox as unknown as ModalSnapshotCapableSandbox;
          const image = await snapshotSandbox.snapshotFilesystem();
          
          return {
            id: image.objectId || `img-${Date.now()}`,
            image: image,
            provider: 'modal',
            createdAt: new Date()
          };
        } catch (error) {
          throw new Error(`Failed to create Modal snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      list: async (_config: ModalConfig) => {
        return [];
      },

      delete: async (_config: ModalConfig, _snapshotId: string) => {
        // No-op for now
      }
    }
  }
});

export { detectRuntime };
