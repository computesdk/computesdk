/**
 * Modal Provider - Rewritten Based on Debug Learnings
 * 
 * Uses patterns proven to work with Modal SDK in our debug tests.
 */

import { createProvider } from 'computesdk';
import type { 
  ExecutionResult, 
  SandboxInfo, 
  Runtime,
  CreateSandboxOptions,
  FileEntry
} from 'computesdk';

// Use the working Modal SDK pattern
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { App, initializeClient, Sandbox } = require('modal');

export interface ModalConfig {
  tokenId?: string;
  tokenSecret?: string;
  runtime?: Runtime;
  timeout?: number;
}

interface ModalSandbox {
  sandbox: any;
  sandboxId: string;
  runtime: Runtime;
}

// Runtime detection function (moved to top)
function detectRuntime(code: string): Runtime {
  if (code.includes('console.log') || 
      code.includes('process.') ||
      code.includes('require(') ||
      code.includes('module.exports') ||
      code.includes('__dirname')) {
    return 'node';
  }

  if (code.includes('print(') || 
      code.includes('import ') ||
      code.includes('def ')) {
    return 'python';
  }

  return 'python';
}

export const modal = createProvider<ModalSandbox, ModalConfig>({
  name: 'modal',
  methods: {
    sandbox: {
      create: async (config: ModalConfig, options?: CreateSandboxOptions) => {
        const tokenId = config.tokenId || process.env.MODAL_TOKEN_ID;
        const tokenSecret = config.tokenSecret || process.env.MODAL_TOKEN_SECRET;

        if (!tokenId || !tokenSecret) {
          throw new Error(
            'Missing Modal credentials. Set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET environment variables.'
          );
        }

        try {
          // Initialize client only if needed
          if (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET) {
            await initializeClient(tokenId, tokenSecret);
          }

          let sandbox: any;
          let sandboxId: string;
          let runtime: Runtime;

          if (options?.sandboxId) {
            // Reconnect to existing sandbox
            sandbox = await Sandbox.fromId(options.sandboxId);
            sandboxId = options.sandboxId;
            runtime = config.runtime || 'python';
          } else {
            // Create new sandbox - use the exact working pattern from debug
            const app = await App.lookup('computesdk-modal', { createIfMissing: true });
            
            // Choose runtime and image (use working images from debug)
            runtime = config.runtime || 'python';
            const imageTag = runtime === 'node' ? 'node:20-alpine' : 'python:3.13-slim';
            const image = await app.imageFromRegistry(imageTag);
            
            // Create sandbox with exact working pattern
            sandbox = await app.createSandbox(image);
            sandboxId = sandbox.sandboxId;
          }

          return {
            sandbox: { sandbox, sandboxId, runtime },
            sandboxId
          };
        } catch (error) {
          throw new Error(`Failed to create Modal sandbox: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      getById: async (config: ModalConfig, sandboxId: string) => {
        const tokenId = config.tokenId || process.env.MODAL_TOKEN_ID!;
        const tokenSecret = config.tokenSecret || process.env.MODAL_TOKEN_SECRET!;

        try {
          if (!process.env.MODAL_TOKEN_ID || !process.env.MODAL_TOKEN_SECRET) {
            await initializeClient(tokenId, tokenSecret);
          }
          const sandbox = await Sandbox.fromId(sandboxId);

          return {
            sandbox: { sandbox, sandboxId, runtime: config.runtime || 'python' },
            sandboxId
          };
        } catch (error) {
          return null;
        }
      },

      list: async () => {
        throw new Error('Modal provider does not support listing sandboxes.');
      },

      destroy: async (_config: ModalConfig, sandboxId: string) => {
        try {
          const sandbox = await Sandbox.fromId(sandboxId);
          await sandbox.terminate();
        } catch (error) {
          // Ignore - might already be terminated
        }
      },

      // REWRITTEN: Dynamic sandbox creation based on runtime detection
      runCode: async (modalSandbox: ModalSandbox, code: string, runtime?: Runtime): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          // Detect runtime from code if not provided
          const detectedRuntime = runtime || detectRuntime(code);
          
          // Check if we need to create a new sandbox with different runtime
          if (detectedRuntime !== modalSandbox.runtime) {
            // Create new sandbox with correct runtime for this execution
            const app = await App.lookup('computesdk-modal', { createIfMissing: true });
            const imageTag = detectedRuntime === 'node' ? 'node:20-alpine' : 'python:3.13-slim';
            const image = await app.imageFromRegistry(imageTag);
            const newSandbox = await app.createSandbox(image);
            
            // Execute in the correctly configured sandbox
            const command = detectedRuntime === 'node' 
              ? ['node', '-e', code]
              : ['python3', '-c', code];

            const process = await newSandbox.exec(command, {
              stdout: 'pipe',
              stderr: 'pipe'
            });

            const [stdout, stderr] = await Promise.all([
              process.stdout.readText(),
              process.stderr.readText()
            ]);

            const exitCode = await process.wait();
            
            // Clean up temporary sandbox
            await newSandbox.terminate();

            // Don't throw syntax errors, return them in the result
            // Let the caller decide how to handle errors

            return {
              stdout: stdout || '',
              stderr: stderr || '',
              exitCode: exitCode || 0,
              executionTime: Date.now() - startTime,
              sandboxId: modalSandbox.sandboxId, // Return original sandbox ID
              provider: 'modal'
            };
          } else {
            // Use existing sandbox with matching runtime
            const command = detectedRuntime === 'node' 
              ? ['node', '-e', code]
              : ['python3', '-c', code];

            const process = await modalSandbox.sandbox.exec(command, {
              stdout: 'pipe',
              stderr: 'pipe'
            });

            const [stdout, stderr] = await Promise.all([
              process.stdout.readText(),
              process.stderr.readText()
            ]);

            const exitCode = await process.wait();

            // Don't throw syntax errors, return them in the result
            // Let the caller decide how to handle errors

            return {
              stdout: stdout || '',
              stderr: stderr || '',
              exitCode: exitCode || 0,
              executionTime: Date.now() - startTime,
              sandboxId: modalSandbox.sandboxId,
              provider: 'modal'
            };
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          throw new Error(`Modal execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      runCommand: async (modalSandbox: ModalSandbox, command: string, args: string[] = []): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          const process = await modalSandbox.sandbox.exec([command, ...args], {
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
            executionTime: Date.now() - startTime,
            sandboxId: modalSandbox.sandboxId,
            provider: 'modal'
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            executionTime: Date.now() - startTime,
            sandboxId: modalSandbox.sandboxId,
            provider: 'modal'
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
          runtime: modalSandbox.runtime,
          status,
          createdAt: new Date(),
          timeout: 300000,
          metadata: {
            modalSandboxId: modalSandbox.sandboxId
          }
        };
      },

      // Working filesystem operations from debug learnings
      filesystem: {
        readFile: async (modalSandbox: ModalSandbox, path: string): Promise<string> => {
          try {
            // Try Modal's native file API first
            const fileHandle = await modalSandbox.sandbox.open(path, 'r');
            const content = await fileHandle.read();
            await fileHandle.close();
            
            const decoder = new TextDecoder();
            return decoder.decode(content).trim();
          } catch (error) {
            // Fallback to shell command
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
            // Try Modal's native file API first
            const fileHandle = await modalSandbox.sandbox.open(path, 'w');
            const encoder = new TextEncoder();
            await fileHandle.write(encoder.encode(content));
            await fileHandle.close();
          } catch (error) {
            // Fallback to shell command
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
            const process = await modalSandbox.sandbox.exec(['ls', '-la', '--time-style=iso', path], {
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

            const lines = output.split('\n').slice(1); // Skip header

            return lines
              .filter((line: string) => line.trim())
              .map((line: string) => {
                const parts = line.trim().split(/\s+/);
                const permissions = parts[0] || '';
                const size = parseInt(parts[4]) || 0;
                const dateStr = (parts[5] || '') + ' ' + (parts[6] || '');
                const date = dateStr.trim() ? new Date(dateStr) : new Date();
                // Fix filename parsing - everything after column 8
                const name = parts.slice(8).join(' ') || parts[parts.length - 1] || 'unknown';

                return {
                  name,
                  path: `${path}/${name}`.replace('//', '/'),
                  isDirectory: permissions.startsWith('d'),
                  size,
                  lastModified: isNaN(date.getTime()) ? new Date() : date
                };
              })
              .filter((entry: FileEntry) => entry.name !== '.' && entry.name !== '..' && entry.name !== 'unknown');
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
      }
    }
  }
});