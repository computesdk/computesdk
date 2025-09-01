/**
 * Codesandbox Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 */

import { CodeSandbox } from '@codesandbox/sdk';
import type { Sandbox as CodesandboxSandbox } from '@codesandbox/sdk';
import { createProvider, createBackgroundCommand } from 'computesdk';
import type { Runtime, ExecutionResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from 'computesdk';

/**
 * Codesandbox-specific configuration options
 */
export interface CodesandboxConfig {
  /** CodeSandbox API key - if not provided, will fallback to CSB_API_KEY environment variable */
  apiKey?: string;
  /** Template to use for new sandboxes */
  templateId?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Create a Codesandbox provider instance using the factory pattern
 */
export const codesandbox = createProvider<CodesandboxSandbox, CodesandboxConfig>({
  name: 'codesandbox',
  methods: {
    sandbox: {
      // Collection operations (compute.sandbox.*)
      create: async (config: CodesandboxConfig, options?: CreateSandboxOptions) => {
        // Validate API key
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing CodeSandbox API key. Provide 'apiKey' in config or set CSB_API_KEY environment variable. Get your API key from https://codesandbox.io/t/api`
          );
        }

        const sdk = new CodeSandbox(apiKey);

        try {
          let sandbox: CodesandboxSandbox;
          let sandboxId: string;

          if (options?.sandboxId) {
            // Resume existing CodeSandbox using sdk.sandboxes.resume()
            sandbox = await sdk.sandboxes.resume(options.sandboxId);
            sandboxId = options.sandboxId;
          } else {
            // Create new CodeSandbox using sdk.sandboxes.create()
            const createOptions: any = {};
            
            if (config.templateId) {
              createOptions.id = config.templateId;
            }

            sandbox = await sdk.sandboxes.create(createOptions);
            sandboxId = sandbox.id;
          }

          return {
            sandbox,
            sandboxId
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key')) {
              throw new Error(
                `CodeSandbox authentication failed. Please check your CSB_API_KEY environment variable. Get your API key from https://codesandbox.io/t/api`
              );
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(
                `CodeSandbox quota exceeded. Please check your usage at https://codesandbox.io/dashboard`
              );
            }
          }
          throw new Error(
            `Failed to create CodeSandbox sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: CodesandboxConfig, sandboxId: string) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing CodeSandbox API key. Provide 'apiKey' in config or set CSB_API_KEY environment variable.`
          );
        }

        const sdk = new CodeSandbox(apiKey);

        try {
          // Resume existing sandbox using sdk.sandboxes.resume()
          const sandbox = await sdk.sandboxes.resume(sandboxId);

          return {
            sandbox,
            sandboxId
          };
        } catch (error) {
          // Sandbox doesn't exist or can't be accessed
          return null;
        }
      },

      list: async (_config: CodesandboxConfig) => {
        throw new Error(
          `CodeSandbox provider does not support listing sandboxes. CodeSandbox SDK does not provide a native list API. Consider using the CodeSandbox dashboard or implement your own tracking system.`
        );
      },

      destroy: async (config: CodesandboxConfig, sandboxId: string) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing CodeSandbox API key. Provide 'apiKey' in config or set CSB_API_KEY environment variable.`
          );
        }

        const sdk = new CodeSandbox(apiKey);

        try {
          // Shutdown the sandbox using sdk.sandboxes.shutdown() to clean it up
          await sdk.sandboxes.shutdown(sandboxId);
        } catch (error) {
          // Sandbox might already be shutdown or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (sandbox.*)
      runCode: async (sandbox: CodesandboxSandbox, code: string, runtime?: Runtime): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          // Connect to the sandbox client using sandbox.connect()
          const client = await sandbox.connect();

          // Auto-detect runtime if not specified
          const effectiveRuntime = runtime || (
            // Strong Python indicators
            code.includes('print(') || 
            code.includes('import ') ||
            code.includes('def ') ||
            code.includes('sys.') ||
            code.includes('json.') ||
            code.includes('__') ||
            code.includes('f"') ||
            code.includes("f'")
              ? 'python'
              // Default to Node.js for all other cases (including ambiguous)
              : 'node'
          );

          // Use base64 encoding for reliability and consistency
          const encoded = Buffer.from(code).toString('base64');
          let command: string;

          if (effectiveRuntime === 'python') {
            // Execute Python code using client.commands.run()
            command = `echo "${encoded}" | base64 -d | python3`;
          } else {
            // Execute Node.js code using client.commands.run()
            command = `echo "${encoded}" | base64 -d | node`;
          }

          // Execute the command using CodeSandbox client.commands.run()
          // This returns the full output as a string
          const output = await client.commands.run(command);

          // Check for syntax errors in the output and throw them (similar to other providers)
          if (output.includes('SyntaxError') || 
              output.includes('invalid syntax') ||
              output.includes('Unexpected token') ||
              output.includes('Unexpected identifier')) {
            throw new Error(`Syntax error: ${output.trim()}`);
          }

          return {
            stdout: output,
            stderr: '',
            exitCode: 0,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.id,
            provider: 'codesandbox'
          };
        } catch (error) {
          // Re-throw syntax errors
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          throw new Error(
            `CodeSandbox execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: CodesandboxSandbox, command: string, args: string[] = [], options?: RunCommandOptions): Promise<ExecutionResult> => {
        const startTime = Date.now();

        // Handle background command execution outside try block so it's accessible everywhere
        const { command: finalCommand, args: finalArgs, isBackground } = createBackgroundCommand(command, args, options);

        try {
          // Connect to the sandbox client using sandbox.connect()
          const client = await sandbox.connect();
          
          // Construct full command with arguments
          const fullCommand = finalArgs.length > 0 ? `${finalCommand} ${finalArgs.join(' ')}` : finalCommand;

          // Execute command using CodeSandbox client.commands.run()
          // This returns the full output as a string
          const output = await client.commands.run(fullCommand);

          return {
            stdout: output,
            stderr: '',
            exitCode: 0,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.id,
            provider: 'codesandbox',
            isBackground,
            // For background commands, we can't get a real PID, but we can indicate it's running
            ...(isBackground && { pid: -1 })
          };
        } catch (error) {
          // For command failures, return error info instead of throwing
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127, // Command not found exit code
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.id,
            provider: 'codesandbox',
            isBackground  // Use the same value even for errors
          };
        }
      },

      getInfo: async (sandbox: CodesandboxSandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.id,
          provider: 'codesandbox',
          runtime: 'node', // CodeSandbox default
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: {
            cluster: sandbox.cluster,
            bootupType: sandbox.bootupType,
            isUpToDate: sandbox.isUpToDate
          }
        };
      },

      getUrl: async (sandbox: CodesandboxSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        const protocol = options.protocol || 'https';
        // CodeSandbox provides URLs in the format: https://{sandbox-id}.{cluster}.csb.app:{port}
        // Use the actual CodeSandbox URL format
        return `${protocol}://${sandbox.id}.${sandbox.cluster}.csb.app:${options.port}`;
      },

      // Filesystem operations using CodeSandbox client.fs API
      filesystem: {
        readFile: async (sandbox: CodesandboxSandbox, path: string): Promise<string> => {
          // Connect to the sandbox client and use client.fs.readTextFile()
          const client = await sandbox.connect();
          return await client.fs.readTextFile(path);
        },

        writeFile: async (sandbox: CodesandboxSandbox, path: string, content: string): Promise<void> => {
          // Connect to the sandbox client and use client.fs.writeTextFile()
          const client = await sandbox.connect();
          await client.fs.writeTextFile(path, content);
        },

        mkdir: async (sandbox: CodesandboxSandbox, path: string): Promise<void> => {
          // CodeSandbox doesn't have a direct mkdir API, use commands to create directory
          const client = await sandbox.connect();
          await client.commands.run(`mkdir -p "${path}"`);
        },

        readdir: async (sandbox: CodesandboxSandbox, path: string): Promise<FileEntry[]> => {
          // Connect to the sandbox client and use client.fs.readdir()
          const client = await sandbox.connect();
          const entries = await client.fs.readdir(path);

          return entries.map((entry: any) => ({
            name: entry.name,
            path: `${path}/${entry.name}`.replace(/\/+/g, '/'),
            isDirectory: entry.isDirectory || false,
            size: entry.size || 0,
            lastModified: entry.lastModified ? new Date(entry.lastModified) : new Date()
          }));
        },

        exists: async (sandbox: CodesandboxSandbox, path: string): Promise<boolean> => {
          // CodeSandbox doesn't have a direct exists API, use ls command to check
          const client = await sandbox.connect();
          try {
            await client.commands.run(`ls "${path}"`);
            return true;
          } catch {
            return false;
          }
        },

        remove: async (sandbox: CodesandboxSandbox, path: string): Promise<void> => {
          // Connect to the sandbox client and use client.fs.remove()
          const client = await sandbox.connect();
          await client.fs.remove(path);
        }
      },

      // Provider-specific typed getInstance method
      getInstance: (sandbox: CodesandboxSandbox): CodesandboxSandbox => {
        return sandbox;
      },

    }
  }
});
