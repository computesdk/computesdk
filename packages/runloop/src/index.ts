/**
 * Runloop Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 * Reduces ~400 lines of boilerplate to ~100 lines of core logic.
 */

import { Runloop } from '@runloop/api-client';
import { createProvider } from 'computesdk';
import type {
  ExecutionResult,
  SandboxInfo,
  CreateSandboxOptions,
  FileEntry
} from 'computesdk';

/**
 * Runloop-specific configuration options
 */
export interface RunloopConfig {
  /** Runloop API key - if not provided, will fallback to RUNLOOP_API_KEY environment variable */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Blueprint ID for environment setup */
  blueprint?: string;
}

/**
 * Create a Runloop provider instance using the factory pattern
 */
export const runloop = createProvider<any, RunloopConfig>({
  name: 'runloop',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: RunloopConfig, options?: CreateSandboxOptions) => {
        // Validate API key
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.RUNLOOP_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing Runloop API key. Provide 'apiKey' in config or set RUNLOOP_API_KEY environment variable. Get your API key from https://runloop.ai/`
          );
        }

        const timeout = config.timeout || 300000;
        
        try {
          const client = new Runloop({
            bearerToken: apiKey,
          });

          let devboxParams: any = {
            timeoutMs: timeout,
          };

          // Use blueprint if specified
          if (config.blueprint || options?.templateId) {
            devboxParams.blueprintId = config.blueprint || options?.templateId;
          }

          // Add environment variables if specified
          if (options?.envs) {
            devboxParams.envs = options.envs;
          }

          let devbox: any;
          let sandboxId: string;

          if (options?.sandboxId) {
            // Reconnect to existing devbox
            devbox = await client.devboxes.retrieve(options.sandboxId);
            sandboxId = options.sandboxId;
          } else {
            // Create new devbox
            devbox = await client.devboxes.create(devboxParams);
            sandboxId = devbox.id || `runloop-${Date.now()}`;
          }

          // Store the client reference for later use
          return {
            sandbox: { devbox, client },
            sandboxId
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key')) {
              throw new Error(
                `Runloop authentication failed. Please check your RUNLOOP_API_KEY environment variable. Get your API key from https://runloop.ai/`
              );
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(
                `Runloop quota exceeded. Please check your usage at https://runloop.ai/`
              );
            }
          }
          throw new Error(
            `Failed to create Runloop devbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: RunloopConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

        try {
          const client = new Runloop({
            bearerToken: apiKey,
          });

          const devbox = await client.devboxes.retrieve(sandboxId);

          return {
            sandbox: { devbox, client },
            sandboxId
          };
        } catch (error) {
          // Devbox doesn't exist or can't be accessed
          return null;
        }
      },

      list: async (config: RunloopConfig) => {
        const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

        try {
          const client = new Runloop({
            bearerToken: apiKey,
          });

          const response = await client.devboxes.list();
          const devboxes = response.devboxes || [];
          
          return devboxes.map((devbox: any) => ({
            sandbox: { devbox, client },
            sandboxId: devbox.id
          }));
        } catch (error) {
          // Return empty array if listing fails
          return [];
        }
      },

      destroy: async (config: RunloopConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.RUNLOOP_API_KEY!;

        try {
          const client = new Runloop({
            bearerToken: apiKey,
          });
          
          await client.devboxes.shutdown(sandboxId);
        } catch (error) {
          // Devbox might already be destroyed or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (map to individual Sandbox methods)
      runCode: async (sandbox: any, code: string): Promise<ExecutionResult> => {
        const startTime = Date.now();
        const { devbox, client } = sandbox;

        try {
          // Execute code using Runloop's executeSync
          // Runloop supports all runtimes, so we'll use a generic approach
          const encoded = Buffer.from(code).toString('base64');
          const command = `echo "${encoded}" | base64 -d | sh`;

          const result = await client.devboxes.executeSync(devbox.id, {
            command: command,
          });

          // Check for syntax errors and throw them
          if (result.exitCode !== 0 && result.stderr) {
            // Check for common syntax error patterns
            if (result.stderr.includes('SyntaxError') ||
              result.stderr.includes('invalid syntax') ||
              result.stderr.includes('Unexpected token') ||
              result.stderr.includes('Unexpected identifier')) {
              throw new Error(`Syntax error: ${result.stderr.trim()}`);
            }
          }

          return {
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            exitCode: result.exitCode || 0,
            executionTime: Date.now() - startTime,
            sandboxId: devbox.id || 'runloop-unknown',
            provider: 'runloop'
          };
        } catch (error) {
          // Re-throw syntax errors
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          throw new Error(
            `Runloop execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: any, command: string, args: string[] = []): Promise<ExecutionResult> => {
        const startTime = Date.now();
        const { devbox, client } = sandbox;

        try {
          // Construct full command with arguments
          const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

          const result = await client.devboxes.executeSync(devbox.id, {
            command: fullCommand,
          });

          return {
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            exitCode: result.exitCode || 0,
            executionTime: Date.now() - startTime,
            sandboxId: devbox.id || 'runloop-unknown',
            provider: 'runloop'
          };
        } catch (error) {
          // For command failures, return error info instead of throwing
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127, // Command not found exit code
            executionTime: Date.now() - startTime,
            sandboxId: devbox.id || 'runloop-unknown',
            provider: 'runloop'
          };
        }
      },

      getInfo: async (sandbox: any): Promise<SandboxInfo> => {
        const { devbox } = sandbox;
        
        return {
          id: devbox.id || 'runloop-unknown',
          provider: 'runloop',
          status: 'running',
          createdAt: new Date(devbox.createdAt || Date.now()),
          timeout: 300000,
          metadata: {
            runloopDevboxId: devbox.id,
            blueprintId: devbox.blueprintId
          }
        };
      },

      getUrl: async (sandbox: any, options: { port: number; protocol?: string }): Promise<string> => {
        const { devbox } = sandbox;
        
        try {
          // Runloop provides direct URL access - construct based on devbox info
          const protocol = options.protocol || 'https';
          const host = devbox.host || `${devbox.id}.runloop.ai`;
          return `${protocol}://${host}:${options.port}`;
        } catch (error) {
          throw new Error(
            `Failed to get Runloop URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      // Optional filesystem methods - using Runloop's file operations
      filesystem: {
        readFile: async (sandbox: any, path: string): Promise<string> => {
          const { devbox, client } = sandbox;
          
          try {
            const result = await client.devboxes.readFileContents(devbox.id, {
              path: path
            });
            return result.content || '';
          } catch (error) {
            throw new Error(`Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        writeFile: async (sandbox: any, path: string, content: string): Promise<void> => {
          const { devbox, client } = sandbox;
          
          try {
            await client.devboxes.writeFileContents(devbox.id, {
              path: path,
              content: content
            });
          } catch (error) {
            throw new Error(`Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        mkdir: async (sandbox: any, path: string, runCommand: any): Promise<void> => {
          const result = await runCommand(sandbox, 'mkdir', ['-p', path]);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to create directory ${path}: ${result.stderr}`);
          }
        },

        readdir: async (sandbox: any, path: string, runCommand: any): Promise<FileEntry[]> => {
          const result = await runCommand(sandbox, 'ls', ['-la', path]);
          
          if (result.exitCode !== 0) {
            throw new Error(`Failed to list directory ${path}: ${result.stderr}`);
          }

          const lines = (result.stdout || '').split('\n').filter((line: string) => line.trim() && !line.startsWith('total'));

          return lines.map((line: string) => {
            const parts = line.trim().split(/\s+/);
            const name = parts[parts.length - 1];
            const isDirectory = line.startsWith('d');
            
            return {
              name,
              path: `${path}/${name}`,
              isDirectory,
              size: parseInt(parts[4]) || 0,
              lastModified: new Date()
            };
          });
        },

        exists: async (sandbox: any, path: string, runCommand: any): Promise<boolean> => {
          const result = await runCommand(sandbox, 'test', ['-e', path]);
          return result.exitCode === 0;
        },

        remove: async (sandbox: any, path: string, runCommand: any): Promise<void> => {
          const result = await runCommand(sandbox, 'rm', ['-rf', path]);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to remove ${path}: ${result.stderr}`);
          }
        }
      },

      // Provider-specific typed getInstance method
      getInstance: (sandbox: any): any => {
        return sandbox;
      },
    }
  }
});