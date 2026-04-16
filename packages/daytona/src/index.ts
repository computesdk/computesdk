/**
 * Daytona Provider - Factory-based Implementation
 * 
 * Code execution only provider using the factory pattern.
 * Reduces ~300 lines of boilerplate to ~80 lines of core logic.
 */

import { Daytona, Sandbox as DaytonaSandbox } from '@daytonaio/sdk';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { Runtime, CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

/**
 * Daytona-specific configuration options
 */
export interface DaytonaConfig {
  /** Daytona API key - if not provided, will fallback to DAYTONA_API_KEY environment variable */
  apiKey?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Create a Daytona provider instance using the factory pattern
 */
export const daytona = defineProvider<DaytonaSandbox, DaytonaConfig>({
  name: 'daytona',
  methods: {
    sandbox: {
      // Collection operations (compute.sandbox.*)
      create: async (config: DaytonaConfig, options?: CreateSandboxOptions) => {
        // Validate API key
        const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.DAYTONA_API_KEY) || '';

        if (!apiKey) {
          throw new Error(
            `Missing Daytona API key. Provide 'apiKey' in config or set DAYTONA_API_KEY environment variable. Get your API key from https://daytona.io/`
          );
        }

        const runtime = options?.runtime || config.runtime || 'node';
        const timeout = options?.timeout ?? config.timeout;

        try {
          // Initialize Daytona client
          const daytona = new Daytona({ apiKey: apiKey });

          let session: DaytonaSandbox;
          let sandboxId: string;

          // Destructure known ComputeSDK fields, collect the rest for passthrough
          const {
            runtime: _runtime,
            timeout: _timeout,
            envs,
            name,
            metadata,
            templateId,
            snapshotId,
            sandboxId: _sandboxId,
            namespace: _namespace,
            directory: _directory,
            overlays: _overlays,
            servers: _servers,
            ...providerOptions
          } = options || {};

            // Build create params from options
            // Daytona SDK uses envVars (not envs), labels (not metadata)
            const createParams: Record<string, any> = {
              language: runtime === 'python' ? 'python' : 'javascript',
              ...providerOptions, // Spread provider-specific options (e.g., resources, public, autoStopInterval)
            };

            // Remap ComputeSDK fields to Daytona SDK fields
            if (envs && Object.keys(envs).length > 0) {
              createParams.envVars = envs;
            }

            if (name) {
              createParams.name = name;
            }

            // Pass metadata as labels (Daytona uses labels: Record<string, string>)
            if (metadata && typeof metadata === 'object') {
              const labels: Record<string, string> = {};
              for (const [k, v] of Object.entries(metadata)) {
                labels[k] = typeof v === 'string' ? v : JSON.stringify(v);
              }
              createParams.labels = labels;
            }

            // If templateId or snapshotId is provided, use it as the source
            const sourceId = templateId || snapshotId;
            if (sourceId) {
              createParams.snapshot = sourceId;
            }

            // Daytona SDK accepts timeout in seconds as a second argument
            const createOptions = timeout
              ? { timeout: Math.ceil(timeout / 1000) }
              : undefined;

          session = await daytona.create(createParams as any, createOptions);
          sandboxId = session.id;

          return {
            sandbox: session,
            sandboxId
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('API key')) {
              throw new Error(
                `Daytona authentication failed. Please check your DAYTONA_API_KEY environment variable. Get your API key from https://daytona.io/`
              );
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(
                `Daytona quota exceeded. Please check your usage at https://daytona.io/`
              );
            }
          }
          throw new Error(
            `Failed to create Daytona sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: DaytonaConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;

        try {
          const daytona = new Daytona({ apiKey: apiKey });
          const session = await daytona.get(sandboxId);

          return {
            sandbox: session,
            sandboxId
          };
        } catch (error) {
          // Sandbox not found is expected -- return null per the interface contract
          if (error instanceof Error && (error.message.includes('not found') || error.message.includes('404'))) {
            return null;
          }
          // Propagate unexpected errors (auth failures, network issues, etc.)
          throw new Error(
            `Failed to get Daytona sandbox ${sandboxId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      list: async (config: DaytonaConfig) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;

        try {
          const daytona = new Daytona({ apiKey: apiKey });
          const result = await daytona.list();

          return result.items.map((session: any) => ({
            sandbox: session,
            sandboxId: session.id
          }));
        } catch (error) {
          throw new Error(
            `Failed to list Daytona sandboxes: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: DaytonaConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;

        try {
          const daytona = new Daytona({ apiKey: apiKey });
          const sandbox = await daytona.get(sandboxId);
          await sandbox.delete();
        } catch (error) {
          // If the sandbox is already gone (404), that's fine for destroy semantics
          if (error instanceof Error && (error.message.includes('not found') || error.message.includes('404'))) {
            return;
          }
          // Propagate all other errors (auth failures, network issues, etc.)
          throw new Error(
            `Failed to destroy Daytona sandbox ${sandboxId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      // Instance operations (sandbox.*)

      runCommand: async (sandbox: DaytonaSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();

        try {
          // Build command with options
          let fullCommand = command;
          
          // Handle environment variables
          if (options?.env && Object.keys(options.env).length > 0) {
            const envPrefix = Object.entries(options.env)
              .map(([k, v]) => `${k}="${escapeShellArg(v)}"`)
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

          // Execute command using Daytona's process.executeCommand method
          const response = await sandbox.process.executeCommand(fullCommand);

          return {
            stdout: response.result || '',
            stderr: '',
            exitCode: response.exitCode || 0,
            durationMs: Date.now() - startTime
          };
        } catch (error) {
          throw new Error(
            `Daytona command execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getInfo: async (sandbox: DaytonaSandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.id,
          provider: 'daytona',
          runtime: 'python', // Daytona default
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: {
            daytonaSandboxId: sandbox.id
          }
        };
      },

      getUrl: async (sandbox: DaytonaSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          // Use Daytona's built-in getPreviewLink method
          const previewInfo = await sandbox.getPreviewLink(options.port);
          let url = previewInfo.url;
          
          // If a specific protocol is requested, replace the URL's protocol
          if (options.protocol) {
            const urlObj = new URL(url);
            urlObj.protocol = options.protocol + ':';
            url = urlObj.toString();
          }
          
          return url;
        } catch (error) {
          throw new Error(
            `Failed to get Daytona preview URL for port ${options.port}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      // Filesystem operations via terminal commands
      filesystem: {
        readFile: async (sandbox: DaytonaSandbox, path: string): Promise<string> => {
          try {
            const response = await sandbox.process.executeCommand(`cat "${path}"`);
            if (response.exitCode !== 0) {
              throw new Error(`File not found or cannot be read: ${path}`);
            }
            return response.result || '';
          } catch (error) {
            throw new Error(`Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        writeFile: async (sandbox: DaytonaSandbox, path: string, content: string): Promise<void> => {
          try {
            // Use base64 encoding to safely handle special characters, newlines, and binary content
            const encoded = Buffer.from(content).toString('base64');
            const response = await sandbox.process.executeCommand(`echo "${encoded}" | base64 -d > "${path}"`);
            if (response.exitCode !== 0) {
              throw new Error(`Failed to write to file: ${path}`);
            }
          } catch (error) {
            throw new Error(`Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        mkdir: async (sandbox: DaytonaSandbox, path: string): Promise<void> => {
          try {
            const response = await sandbox.process.executeCommand(`mkdir -p "${path}"`);
            if (response.exitCode !== 0) {
              throw new Error(`Failed to create directory: ${path}`);
            }
          } catch (error) {
            throw new Error(`Failed to create directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        readdir: async (sandbox: DaytonaSandbox, path: string): Promise<FileEntry[]> => {
          try {
            const response = await sandbox.process.executeCommand(`ls -la "${path}"`);
            if (response.exitCode !== 0) {
              throw new Error(`Directory not found or cannot be read: ${path}`);
            }

            // Parse ls -la output into FileEntry objects
            const lines = response.result.split('\n').filter(line => line.trim());
            const entries: FileEntry[] = [];

            for (const line of lines) {
              // Skip total line and current/parent directory entries
              if (line.startsWith('total ') || line.endsWith(' .') || line.endsWith(' ..')) {
                continue;
              }

              // Parse ls -la format: permissions links owner group size date time name
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 9) {
                const permissions = parts[0];
                const name = parts.slice(8).join(' '); // Handle filenames with spaces
                const isDirectory = permissions.startsWith('d');
                const size = parseInt(parts[4]) || 0;

                entries.push({
                  name,
                  type: isDirectory ? 'directory' as const : 'file' as const,
                  size,
                  modified: new Date() // ls -la date parsing is complex, use current time
                });
              }
            }

            return entries;
          } catch (error) {
            throw new Error(`Failed to read directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        exists: async (sandbox: DaytonaSandbox, path: string): Promise<boolean> => {
          try {
            const response = await sandbox.process.executeCommand(`test -e "${path}"`);
            return response.exitCode === 0;
          } catch (error) {
            // If command execution fails, assume file doesn't exist
            return false;
          }
        },

        remove: async (sandbox: DaytonaSandbox, path: string): Promise<void> => {
          try {
            const response = await sandbox.process.executeCommand(`rm -rf "${path}"`);
            if (response.exitCode !== 0) {
              throw new Error(`Failed to remove: ${path}`);
            }
          } catch (error) {
            throw new Error(`Failed to remove ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      },

      // Provider-specific typed getInstance method
      getInstance: (sandbox: DaytonaSandbox): DaytonaSandbox => {
        return sandbox;
      },

    },

    snapshot: {
      create: async (config: DaytonaConfig, sandboxId: string, options?: { name?: string }) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        const daytona = new Daytona({ apiKey: apiKey });

        try {
          // Note: Using 'any' cast as we are using internal service property
          const snapshot = await (daytona as any).snapshots.create({
            workspaceId: sandboxId,
            name: options?.name || `snapshot-${Date.now()}`
          });
          return snapshot;
        } catch (error) {
          throw new Error(`Failed to create Daytona snapshot: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      list: async (config: DaytonaConfig) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        const daytona = new Daytona({ apiKey: apiKey });

        try {
          const result = await (daytona as any).snapshots.list();
          return result;
        } catch (error) {
          return [];
        }
      },

      delete: async (config: DaytonaConfig, snapshotId: string) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        const daytona = new Daytona({ apiKey: apiKey });

        try {
          // Note: Daytona SDK might not expose delete directly or it might be 'remove'
          // We'll try the common pattern
          await (daytona as any).snapshots.delete(snapshotId);
        } catch (error) {
          // Ignore if not found
        }
      }
    },

    // Templates in Daytona are effectively Snapshots
    template: {
      create: async (config: DaytonaConfig, options: { name: string }) => {
         throw new Error('To create a template in Daytona, create a snapshot from a running sandbox using snapshot.create()');
      },

      list: async (config: DaytonaConfig) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        const daytona = new Daytona({ apiKey: apiKey });

        try {
          const result = await (daytona as any).snapshots.list();
          return result;
        } catch (error) {
          return [];
        }
      },

      delete: async (config: DaytonaConfig, templateId: string) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;
        const daytona = new Daytona({ apiKey: apiKey });

        try {
          await (daytona as any).snapshots.delete(templateId);
        } catch (error) {
          // Ignore if not found
        }
      }
    }
  }
});
