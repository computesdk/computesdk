/**
 * Daytona Provider - Factory-based Implementation
 * 
 * Code execution only provider using the factory pattern.
 * Reduces ~300 lines of boilerplate to ~80 lines of core logic.
 */

import { Daytona, Sandbox as DaytonaSandbox } from '@daytonaio/sdk';
import { createProvider } from 'computesdk';
import type { Runtime, ExecutionResult, SandboxInfo, CreateSandboxOptions, FileEntry } from 'computesdk';

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
export const daytona = createProvider<DaytonaSandbox, DaytonaConfig>({
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

        const runtime = options?.runtime || config.runtime || 'python';

        try {
          // Initialize Daytona client
          const daytona = new Daytona({ apiKey: apiKey });

          let session: DaytonaSandbox;
          let sandboxId: string;

          if (options?.sandboxId) {
            // Reconnect to existing Daytona sandbox
            session = await daytona.get(options.sandboxId);
            sandboxId = options.sandboxId;
          } else {
            // Create new Daytona sandbox
            session = await daytona.create({
              language: runtime === 'python' ? 'python' : 'typescript',
            });
            sandboxId = session.id;
          }

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
          // Sandbox doesn't exist or can't be accessed
          return null;
        }
      },

      list: async (config: DaytonaConfig) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;

        try {
          const daytona = new Daytona({ apiKey: apiKey });
          const sandboxes = await daytona.list();

          return sandboxes.map((session: any) => ({
            sandbox: session,
            sandboxId: session.id
          }));
        } catch (error) {
          // Return empty array if listing fails
          return [];
        }
      },

      destroy: async (config: DaytonaConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.DAYTONA_API_KEY!;

        try {
          const daytona = new Daytona({ apiKey: apiKey });
          // Note: Daytona SDK expects a Sandbox object, but we only have the ID
          // This is a limitation of the current Daytona SDK design
          // For now, we'll skip the delete operation
          const sandbox = await daytona.get(sandboxId);
          await sandbox.delete();
        } catch (error) {
          // Sandbox might already be destroyed or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (sandbox.*)
      runCode: async (sandbox: DaytonaSandbox, code: string, _runtime?: Runtime): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          // Execute code using Daytona's process.codeRun method
          const response = await sandbox.process.codeRun(code);

          return {
            stdout: response.result || '',
            stderr: '', // Daytona doesn't separate stderr in the response
            exitCode: response.exitCode || 0,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.id,
            provider: 'daytona'
          };
        } catch (error) {
          throw new Error(
            `Daytona execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: DaytonaSandbox, command: string, args: string[] = []): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          // Construct full command with arguments
          const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

          // Execute command using Daytona's process.executeCommand method
          const response = await sandbox.process.executeCommand(fullCommand);

          return {
            stdout: response.result || '',
            stderr: '', // Daytona doesn't separate stderr in the response
            exitCode: response.exitCode || 0,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.id,
            provider: 'daytona'
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
                  path: `${path}/${name}`.replace(/\/+/g, '/'), // Clean up double slashes
                  isDirectory,
                  size,
                  lastModified: new Date() // ls -la date parsing is complex, use current time
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
      }

      // Terminal operations not implemented - Daytona session API needs verification
    }
  }
});
