/**
 * Modal Provider - Factory-based Implementation
 * 
 * Full-featured provider with serverless sandbox execution using the factory pattern.
 * Leverages Modal's JavaScript SDK for real sandbox management.
 * 
 * Note: Modal's JavaScript SDK is in alpha. This implementation provides a working
 * foundation but may need updates as the Modal API evolves.
 */

import { createProvider } from 'computesdk';
import type {
  CodeResult,
  CommandResult,
  SandboxInfo,
  Runtime,
  CreateSandboxOptions,
  FileEntry
} from 'computesdk';

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
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Modal environment (sandbox or main) */
  environment?: string;
  /** Ports to expose */
  ports?: number[];
}

/**
 * Modal sandbox interface - wraps Modal's Sandbox class
 */
interface ModalSandbox {
  sandbox: any; // Modal Sandbox instance (using any due to alpha SDK)
  sandboxId: string;
}

/**
 * Detect runtime from code content
 */
function detectRuntime(code: string): Runtime {
  // Strong Node.js indicators
  if (code.includes('console.log') || 
      code.includes('process.') ||
      code.includes('require(') ||
      code.includes('module.exports') ||
      code.includes('__dirname') ||
      code.includes('__filename') ||
      code.includes('throw new Error') ||  // JavaScript error throwing
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

  // Default to Node.js for Modal (now using Node.js base image)
  return 'node';
}

/**
 * Create a Modal provider instance using the factory pattern
 */
export const modal = createProvider<ModalSandbox, ModalConfig>({
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

          let sandbox: any;
          let sandboxId: string;

          if (options?.sandboxId) {
            // Reconnect to existing Modal sandbox
            sandbox = await Sandbox.fromId(options.sandboxId);
            sandboxId = options.sandboxId;
          } else {
            // Create new Modal sandbox with Node.js (more appropriate for a Node.js SDK)
            const app = await App.lookup('computesdk-modal', { createIfMissing: true });
            const image = await app.imageFromRegistry('node:20-alpine');
            
            // Configure sandbox options
            const sandboxOptions: any = {}; // Using 'any' since Modal SDK is alpha
            
            // Configure ports if provided (using unencrypted ports by default)
            if (config.ports && config.ports.length > 0) {
              sandboxOptions.unencryptedPorts = config.ports;
            }
            
            // Add timeout if specified
            if (config.timeout) {
              sandboxOptions.timeout = config.timeout;
            }
            
            sandbox = await app.createSandbox(image, sandboxOptions);
            sandboxId = sandbox.sandboxId;
          }

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
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (map to individual Sandbox methods)
      runCode: async (modalSandbox: ModalSandbox, code: string, runtime?: Runtime): Promise<CodeResult> => {
        const startTime = Date.now();

        try {
          // Auto-detect runtime from code if not specified
          const detectedRuntime = runtime || detectRuntime(code);

          // Create appropriate sandbox and command for the runtime
          let executionSandbox = modalSandbox.sandbox;
          let command: string[];
          let shouldCleanupSandbox = false;

          if (detectedRuntime === 'node') {
            // Use existing Node.js sandbox (now the default)
            command = ['node', '-e', code];
          } else {
            // For Python execution, create a Python sandbox dynamically
            const app = await App.lookup('computesdk-modal', { createIfMissing: true });
            const pythonImage = await app.imageFromRegistry('python:3.13-slim');
            executionSandbox = await app.createSandbox(pythonImage);
            command = ['python3', '-c', code];
            shouldCleanupSandbox = true; // Clean up temporary Python sandbox
          }

          const process = await executionSandbox.exec(command, {
            stdout: 'pipe',
            stderr: 'pipe'
          });

          // Use working stream reading pattern from debug
          const [stdout, stderr] = await Promise.all([
            process.stdout.readText(),
            process.stderr.readText()
          ]);

          const exitCode = await process.wait();

          // Clean up temporary Python sandbox if created
          if (shouldCleanupSandbox && executionSandbox !== modalSandbox.sandbox) {
            try {
              await executionSandbox.terminate();
            } catch (e) {
              // Ignore cleanup errors
            }
          }

          // Check for syntax errors in stderr
          if (exitCode !== 0 && stderr && (
            stderr.includes('SyntaxError') ||
            stderr.includes('invalid syntax')
          )) {
            throw new Error(`Syntax error: ${stderr.trim()}`);
          }

          return {
            output: (stdout || '') + (stderr || ''),
            exitCode: exitCode || 0,
            language: detectedRuntime,
          };
        } catch (error) {
          // Handle syntax errors and runtime errors
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error; // Re-throw syntax errors
          }

          throw new Error(
            `Modal execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (modalSandbox: ModalSandbox, command: string, args: string[] = []): Promise<CommandResult> => {
        const startTime = Date.now();

        try {
          // Execute command using Modal's exec method with working pattern
          const process = await modalSandbox.sandbox.exec([command, ...args], {
            stdout: 'pipe',
            stderr: 'pipe'
          });

          // Use working stream reading pattern from debug
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
        // Get actual sandbox status using Modal's poll method
        let status: 'running' | 'stopped' | 'error' = 'running';
        try {
          const pollResult = await modalSandbox.sandbox.poll();
          if (pollResult !== null) {
            // Sandbox has finished
            status = pollResult === 0 ? 'stopped' : 'error';
          }
        } catch (error) {
          // If polling fails, assume running
          status = 'running';
        }

        return {
          id: modalSandbox.sandboxId,
          provider: 'modal',
          runtime: 'node', // Modal default (now using Node.js)
          status,
          createdAt: new Date(),
          timeout: 300000,
          metadata: {
            modalSandboxId: modalSandbox.sandboxId,
            realModalImplementation: true
          }
        };
      },

      getUrl: async (modalSandbox: ModalSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          // Use Modal's built-in tunnels method to get tunnel information
          const tunnels = await modalSandbox.sandbox.tunnels();
          const tunnel = tunnels[options.port];
          
          if (!tunnel) {
            throw new Error(`No tunnel found for port ${options.port}. Available ports: ${Object.keys(tunnels).join(', ')}`);
          }
          
          let url = tunnel.url;
          
          // If a specific protocol is requested, replace the URL's protocol
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
            // Use Modal's file open API to read files
            const file = await modalSandbox.sandbox.open(path);
            
            // Read the entire file content
            let content = '';
            if (file && typeof file.read === 'function') {
              const data = await file.read();
              content = typeof data === 'string' ? data : new TextDecoder().decode(data);
            }
            
            // Close the file if it has a close method
            if (file && typeof file.close === 'function') {
              await file.close();
            }
            
            return content;
          } catch (error) {
            // Fallback to using cat command with working stream pattern
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

              return content.trim(); // Remove extra newlines
            } catch (fallbackError) {
              throw new Error(`Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        },

        writeFile: async (modalSandbox: ModalSandbox, path: string, content: string): Promise<void> => {
          try {
            // Use Modal's file open API to write files
            const file = await modalSandbox.sandbox.open(path);
            
            // Write content to the file
            if (file && typeof file.write === 'function') {
              await file.write(content);
            }
            
            // Close the file if it has a close method
            if (file && typeof file.close === 'function') {
              await file.close();
            }
          } catch (error) {
            // Fallback to using shell command with proper escaping
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
            // Use simple -l flag for BusyBox compatibility (Alpine/node:20-alpine uses BusyBox ls)
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

            const lines = output.split('\n').slice(1); // Skip header

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
                  path: `${path}/${name}`.replace('//', '/'),
                  isDirectory: permissions.startsWith('d'),
                  size,
                  lastModified: isNaN(date.getTime()) ? new Date() : date
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

    }
  }
});