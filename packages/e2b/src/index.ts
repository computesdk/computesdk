/**
 * E2B Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 * Reduces ~400 lines of boilerplate to ~100 lines of core logic.
 */

import { Sandbox as E2BSandbox } from 'e2b';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { Runtime, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

type E2BExecutionResult = { stdout?: string; stderr?: string; exitCode?: number };
type E2BFileEntry = {
  name: string;
  isDir?: boolean;
  isDirectory?: boolean;
  size?: number;
  lastModified?: string | number | Date;
};
type E2BSnapshotResult = string | { id?: string; templateId?: string };
type SnapshotCapableE2BSandbox = E2BSandbox & {
  createSnapshot: (options?: { name?: string }) => Promise<E2BSnapshotResult>;
};
type E2BSandboxStatics = typeof E2BSandbox & {
  listTemplates?: (options: { apiKey?: string }) => Promise<unknown[]>;
  deleteTemplate?: (snapshotId: string, options: { apiKey?: string }) => Promise<unknown>;
};

/**
 * E2B-specific configuration options
 */
export interface E2BConfig {
  /** E2B API key - if not provided, will fallback to E2B_API_KEY environment variable */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}



/**
 * Create an E2B provider instance using the factory pattern
 */
export const e2b = defineProvider<E2BSandbox, E2BConfig>({
  name: 'e2b',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: E2BConfig, options?: CreateSandboxOptions) => {
        // Validate API key
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.E2B_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing E2B API key. Provide 'apiKey' in config or set E2B_API_KEY environment variable. Get your API key from https://e2b.dev/`
          );
        }

        // Validate API key format
        if (!apiKey.startsWith('e2b_')) {
          throw new Error(
            `Invalid E2B API key format. E2B API keys should start with 'e2b_'. Check your E2B_API_KEY environment variable.`
          );
        }


        // options.timeout takes precedence over config.timeout
        const timeout = options?.timeout ?? config.timeout ?? 300000;

        try {
          let sandbox: E2BSandbox;
          let sandboxId: string;

          // Destructure known ComputeSDK fields, collect the rest for passthrough
          const {
            runtime: _runtime,
            timeout: _timeout,
            envs,
            name: _name,
            metadata,
            templateId,
            snapshotId,
            sandboxId: _sandboxId,
            namespace: _namespace,
            directory: _directory,
            ...providerOptions
          } = options || {};

            // Build create options, spreading provider-specific options (e.g., domain)
            const createOpts: Record<string, any> = {
              apiKey: apiKey,
              timeoutMs: timeout,
              envs,
              metadata,
              ...providerOptions, // Spread provider-specific options (e.g., domain)
            };

          // Create new E2B session
          // E2B supports both templateId and snapshotId (snapshotId maps to template)
          const templateOrSnapshot = templateId || snapshotId;
          if (templateOrSnapshot) {
            sandbox = await E2BSandbox.create(templateOrSnapshot, createOpts);
          } else {
            sandbox = await E2BSandbox.create(createOpts);
          }
          if (!sandbox.sandboxId) {
            throw new Error('E2B create() returned sandbox without an ID');
          }
          sandboxId = sandbox.sandboxId;

          return {
            sandbox,
            sandboxId
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key')) {
              throw new Error(
                `E2B authentication failed. Please check your E2B_API_KEY environment variable. Get your API key from https://e2b.dev/`
              );
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(
                `E2B quota exceeded. Please check your usage at https://e2b.dev/`
              );
            }
          }
          throw new Error(
            `Failed to create E2B sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: E2BConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;

        try {
          const sandbox = await E2BSandbox.connect(sandboxId, {
            apiKey: apiKey,
          });

          return {
            sandbox,
            sandboxId
          };
        } catch (error) {
          // Sandbox doesn't exist or can't be accessed
          return null;
        }
      },

      list: async (config: E2BConfig) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;

        try {
          const paginator = E2BSandbox.list({
            apiKey: apiKey,
          });
          // Get first page of results using nextItems
          const items = await paginator.nextItems();
          return items.map((sandbox) => {
            const listedSandbox = sandbox as unknown as E2BSandbox & { id?: string; sandboxId?: string };
            const sandboxId = listedSandbox.id || listedSandbox.sandboxId || 'e2b-unknown';
            return {
              sandbox: listedSandbox,
              sandboxId,
            };
          });
        } catch (error) {
          // Return empty array if listing fails
          return [];
        }
      },

      destroy: async (config: E2BConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;

        try {
          const sandbox = await E2BSandbox.connect(sandboxId, {
            apiKey: apiKey,
          });
          await sandbox.kill();
        } catch (error) {
          // Sandbox might already be destroyed or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (map to individual Sandbox methods)

      runCommand: async (sandbox: E2BSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();

        try {
          // Build command with options (E2B doesn't support these natively, so we wrap with shell)
          let fullCommand = command;
          
          // Handle environment variables
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env)
              .map(([k, v]) => `${k}="${escapeShellArg(String(v))}"`)
              .join(' ');
            fullCommand = `${envPrefix} ${fullCommand}`;
          }
          
          // Handle working directory
          if (options?.cwd) {
            fullCommand = `cd "${escapeShellArg(options.cwd)}" && ${fullCommand}`;
          }
          
          // Handle background execution
          if (options?.background) {
            fullCommand = `nohup ${fullCommand} > /dev/null 2>&1 &`;
          }

          const execution = await sandbox.commands.run(fullCommand);

          return {
            stdout: execution.stdout,
            stderr: execution.stderr,
            exitCode: execution.exitCode,
            durationMs: Date.now() - startTime
          };
        } catch (error) {
          // E2B throws errors for non-zero exit codes
          // Extract the actual result from the error if available
          const result = (error as { result?: E2BExecutionResult })?.result;
          if (result) {
            return {
              stdout: result.stdout || '',
              stderr: result.stderr || '',
              exitCode: result.exitCode || 1,
              durationMs: Date.now() - startTime
            };
          }
          
          // Fallback for other errors (command not found, etc.)
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime
          };
        }
      },

      getInfo: async (sandbox: E2BSandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.sandboxId || 'e2b-unknown',
          provider: 'e2b',
          runtime: 'python', // E2B default
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: {
            e2bSessionId: sandbox.sandboxId
          }
        };
      },

      getUrl: async (sandbox: E2BSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          // Use E2B's built-in getHost method for accurate host information
          const host = sandbox.getHost(options.port);
          const protocol = options.protocol || 'https';
          return `${protocol}://${host}`;
        } catch (error) {
          throw new Error(
            `Failed to get E2B host for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      // Optional filesystem methods - E2B has full filesystem support
      filesystem: {
        readFile: async (sandbox: E2BSandbox, path: string): Promise<string> => {
          return await sandbox.files.read(path);
        },

        writeFile: async (sandbox: E2BSandbox, path: string, content: string): Promise<void> => {
          await sandbox.files.write(path, content);
        },

        mkdir: async (sandbox: E2BSandbox, path: string): Promise<void> => {
          await sandbox.files.makeDir(path);
        },

        readdir: async (sandbox: E2BSandbox, path: string): Promise<FileEntry[]> => {
          const entries = await sandbox.files.list(path);

          return entries.map((entry: E2BFileEntry) => ({
            name: entry.name,
            type: (entry.isDir || entry.isDirectory) ? 'directory' as const : 'file' as const,
            size: entry.size || 0,
            modified: new Date(entry.lastModified || Date.now())
          }));
        },

        exists: async (sandbox: E2BSandbox, path: string): Promise<boolean> => {
          return await sandbox.files.exists(path);
        },

        remove: async (sandbox: E2BSandbox, path: string): Promise<void> => {
          await sandbox.files.remove(path);
        }
      },

      // Provider-specific typed getInstance method
      getInstance: (sandbox: E2BSandbox): E2BSandbox => {
        return sandbox;
      },

    },

    snapshot: {
      create: async (config: E2BConfig, sandboxId: string, options?: { name?: string }) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        
        try {
          // Reconnect to the sandbox to snapshot it
          const sandbox = await E2BSandbox.connect(sandboxId, { apiKey });
          
          // Note: createSnapshot is a feature referenced in E2B docs for saving running state
          // It typically returns a template ID that can be used to spawn new sandboxes
          // We cast to any to avoid type issues if the installed SDK version is slightly older
          // but the feature is available on the API
          const snapshotSandbox = sandbox as SnapshotCapableE2BSandbox;
          const snapshotResult = await snapshotSandbox.createSnapshot({
            name: options?.name
          });

          // Handle different potential return shapes (ID string or object with ID)
          const snapshotId = typeof snapshotResult === 'string' ? snapshotResult : snapshotResult.id || snapshotResult.templateId;

          return {
            id: snapshotId,
            provider: 'e2b',
            createdAt: new Date(),
            metadata: {
              name: options?.name
            }
          };
        } catch (error) {
          throw new Error(`Failed to create E2B snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      list: async (config: E2BConfig) => {
        // Listing snapshots in E2B is effectively listing templates
        // since snapshots create templates
        try {
          // Attempt to list templates/snapshots via SDK static method if available
          // or return empty if not supported in this SDK version
          const e2bStatic = E2BSandbox as E2BSandboxStatics;
          if (typeof e2bStatic.listTemplates === 'function') {
            return await e2bStatic.listTemplates({ apiKey: config.apiKey || process.env.E2B_API_KEY });
          }
          return [];
        } catch (error) {
          return [];
        }
      },

      delete: async (config: E2BConfig, snapshotId: string) => {
        try {
          // Attempt to delete template/snapshot
          const e2bStatic = E2BSandbox as E2BSandboxStatics;
          if (typeof e2bStatic.deleteTemplate === 'function') {
            await e2bStatic.deleteTemplate(snapshotId, { apiKey: config.apiKey || process.env.E2B_API_KEY });
          }
        } catch (error) {
          // Ignore
        }
      }
    },

    // In E2B, Snapshots create Templates. They are interchangeable concepts for spawning.
    template: {
      create: async (config: E2BConfig, options: { name: string }) => {
         throw new Error('To create a template in E2B, create a snapshot from a running sandbox using snapshot.create(), or use the E2B CLI to build from a Dockerfile.');
      },

      list: async (config: E2BConfig) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        try {
          const e2bStatic = E2BSandbox as E2BSandboxStatics;
          if (typeof e2bStatic.listTemplates === 'function') {
            return await e2bStatic.listTemplates({ apiKey });
          }
          return [];
        } catch (error) {
          return [];
        }
      },

      delete: async (config: E2BConfig, templateId: string) => {
        const apiKey = config.apiKey || process.env.E2B_API_KEY!;
        try {
          const e2bStatic = E2BSandbox as E2BSandboxStatics;
          if (typeof e2bStatic.deleteTemplate === 'function') {
            await e2bStatic.deleteTemplate(templateId, { apiKey });
          }
        } catch (error) {
          // Ignore
        }
      }
    }
  }
});

// Export E2B sandbox type for explicit typing
export type { Sandbox as E2BSandbox } from 'e2b';
