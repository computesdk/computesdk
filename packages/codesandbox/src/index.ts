/**
 * Codesandbox Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 */

import { CodeSandbox } from '@codesandbox/sdk';
import type { Sandbox as CodesandboxSandbox } from '@codesandbox/sdk';
import { defineProvider, buildShellCommand } from '@computesdk/provider';

import type { Runtime, CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

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
export const codesandbox = defineProvider<CodesandboxSandbox, CodesandboxConfig, any, any>({
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
          } else if (options?.snapshotId) {
            // Resume from snapshot - in CodeSandbox, snapshots are hibernated sandboxes
            sandbox = await sdk.sandboxes.resume(options.snapshotId);
            sandboxId = options.snapshotId;
          } else {
            // Destructure known ComputeSDK fields, collect the rest for passthrough
            const {
              runtime: _runtime,
              timeout: _timeout,
              envs,
              name: _name,
              metadata: _metadata,
              templateId: optTemplateId,
              snapshotId: _snapshotId,
              sandboxId: _sandboxId,
              namespace: _namespace,
              directory: _directory,
              overlays: _overlays,
              servers: _servers,
              ...providerOptions
            } = options || {};

            // Create new CodeSandbox using sdk.sandboxes.create()
            const createOptions: any = {
              ...providerOptions, // Spread provider-specific options
            };

            // options.templateId takes precedence over config.templateId
            const templateId = optTemplateId || config.templateId;
            if (templateId) {
              createOptions.id = templateId;
            }

            // Remap envs to envVars
            if (envs && Object.keys(envs).length > 0) {
              createOptions.envVars = envs;
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
          await sdk.sandboxes.shutdown(sandboxId);
        } catch {
          // Ignore — may already be stopped
        }

        try {
          await sdk.sandboxes.delete(sandboxId);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('not found') && !message.includes('404')) {
            throw new Error(`Failed to delete CodeSandbox sandbox "${sandboxId}": ${message}`);
          }
        }
      },

      // Instance operations (sandbox.*)
      runCode: async (sandbox: CodesandboxSandbox, code: string, runtime?: Runtime): Promise<CodeResult> => {
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
              code.includes("f'") ||
              code.includes('raise ')
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
            output: output,
            exitCode: 0,
            language: effectiveRuntime
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

      runCommand: async (sandbox: CodesandboxSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();

        try {
          // Connect to the sandbox client using sandbox.connect()
          const client = await sandbox.connect();

          // Build command with options
          let fullCommand = buildShellCommand(command, { cwd: options?.cwd, env: options?.env });

          // Handle background execution
          if (options?.background) {
            fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          }

          // Execute command using CodeSandbox client.commands.run()
          const output = await client.commands.run(fullCommand);

          return {
            stdout: output,
            stderr: '',
            exitCode: 0,
            durationMs: Date.now() - startTime
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime
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
            type: entry.isDirectory ? 'directory' as const : 'file' as const,
            size: entry.size || 0,
            modified: entry.lastModified ? new Date(entry.lastModified) : new Date()
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

    },

    snapshot: {
      create: async (config: CodesandboxConfig, sandboxId: string, options?: { name?: string }) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing CodeSandbox API key. Provide 'apiKey' in config or set CSB_API_KEY environment variable.`
          );
        }

        const sdk = new CodeSandbox(apiKey);

        try {
          // Resume the sandbox first, then hibernate to create a snapshot
          const sandbox = await sdk.sandboxes.resume(sandboxId);

          // Hibernate creates a checkpoint/snapshot of the sandbox
          // Cast to any to avoid type issues with SDK version
          await (sandbox as any).hibernate();

          // The hibernated sandbox becomes a snapshot we can fork
          return {
            id: sandbox.id,
            provider: 'codesandbox',
            createdAt: new Date(),
            metadata: {
              name: options?.name,
              bootupType: sandbox.bootupType
            }
          };
        } catch (error) {
          throw new Error(
            `Failed to create CodeSandbox snapshot: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      list: async (_config: CodesandboxConfig) => {
        throw new Error(
          `CodeSandbox provider does not support listing snapshots. Use the dashboard to manage snapshots.`
        );
      },

      delete: async (config: CodesandboxConfig, snapshotId: string) => {
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.CSB_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing CodeSandbox API key. Provide 'apiKey' in config or set CSB_API_KEY environment variable.`
          );
        }

        const sdk = new CodeSandbox(apiKey);

        try {
          // Shutdown the snapshot (hibernated sandbox)
          await sdk.sandboxes.shutdown(snapshotId);
        } catch (error) {
          // Ignore if not found
        }
      }
    },

    // Templates in CodeSandbox are handled via templateId on create
    template: {
      create: async (_config: CodesandboxConfig, _options: { name: string }) => {
        throw new Error(
          `CodeSandbox templates must be created via the CodeSandbox dashboard or CLI. Use templateId in sandbox.create() to specify a template.`
        );
      },

      list: async (_config: CodesandboxConfig) => {
        throw new Error(
          `CodeSandbox provider does not support listing templates via API. Use the dashboard to manage templates.`
        );
      },

      delete: async (_config: CodesandboxConfig, _templateId: string) => {
        throw new Error(
          `CodeSandbox templates must be deleted via the CodeSandbox dashboard or CLI.`
        );
      }
    }
  }
});
