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
              language: runtime === 'python' ? 'python' : 'javascript',
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
          const result = await daytona.list();

          return result.items.map((session: any) => ({
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
      runCode: async (sandbox: DaytonaSandbox, code: string, runtime?: Runtime): Promise<CodeResult> => {
        const startTime = Date.now();

        try {
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
          
          // Use direct command execution like Vercel for consistency
          let response;
          
          // Use base64 encoding for both runtimes for reliability and consistency
          const encoded = Buffer.from(code).toString('base64');
          
          if (effectiveRuntime === 'python') {
            response = await sandbox.process.executeCommand(`echo "${encoded}" | base64 -d | python3`);
          } else {
            response = await sandbox.process.executeCommand(`echo "${encoded}" | base64 -d | node`);
          }

          // Daytona always returns exitCode: 0, so we need to detect errors from output
          const output = response.result || '';
          const hasError = output.includes('Error:') || 
                          output.includes('error TS') || 
                          output.includes('SyntaxError:') ||
                          output.includes('TypeError:') ||
                          output.includes('ReferenceError:') ||
                          output.includes('Traceback (most recent call last)');

          // Check for syntax errors and throw them (similar to Vercel behavior)
          if (hasError && (output.includes('SyntaxError:') || 
                          output.includes('invalid syntax') ||
                          output.includes('Unexpected token') ||
                          output.includes('Unexpected identifier') ||
                          output.includes('error TS1434'))) {
            throw new Error(`Syntax error: ${output.trim()}`);
          }

          const actualExitCode = hasError ? 1 : (response.exitCode || 0);

          return {
            output: output,
            exitCode: actualExitCode,
            language: effectiveRuntime
          };
        } catch (error) {
          // Re-throw syntax errors
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          throw new Error(
            `Daytona execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

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

      // Terminal operations not implemented - Daytona session API needs verification

    }
  }
});
