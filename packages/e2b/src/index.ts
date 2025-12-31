/**
 * E2B Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 * Reduces ~400 lines of boilerplate to ~100 lines of core logic.
 */

import { Sandbox as E2BSandbox } from 'e2b';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { Runtime, CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

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


        const timeout = config.timeout || 300000;

        try {
          let sandbox: E2BSandbox;
          let sandboxId: string;

          if (options?.sandboxId) {
            // Reconnect to existing E2B session
            sandbox = await E2BSandbox.connect(options.sandboxId, {
              apiKey: apiKey,
              domain: options.domain,
            });
            sandboxId = options.sandboxId;
          } else {
            // Create new E2B session
            if (options?.templateId) {
              sandbox = await E2BSandbox.create(options.templateId, {
                apiKey: apiKey,
                timeoutMs: timeout,
                domain: options?.domain,
                envs: options?.envs,
              });
            } else {
              sandbox = await E2BSandbox.create({
                apiKey: apiKey,
                timeoutMs: timeout,
                domain: options?.domain,
                envs: options?.envs,
              });
            }
            sandboxId = sandbox.sandboxId || `e2b-${Date.now()}`;
          }

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
          return items.map((sandbox: any) => ({
            sandbox,
            sandboxId: sandbox.id
          }));
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
      runCode: async (sandbox: E2BSandbox, code: string, runtime?: Runtime): Promise<CodeResult> => {
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

          // Use base64 encoding for both runtimes for reliability and consistency
          const encoded = Buffer.from(code).toString('base64');
          const result = effectiveRuntime === 'python'
            ? await sandbox.commands.run(`echo "${encoded}" | base64 -d | python3`)
            : await sandbox.commands.run(`echo "${encoded}" | base64 -d | node`);

          // Check for syntax errors and throw them
          if (result.exitCode !== 0 && result.stderr) {
            if (result.stderr.includes('SyntaxError') ||
              result.stderr.includes('invalid syntax') ||
              result.stderr.includes('Unexpected token') ||
              result.stderr.includes('Unexpected identifier')) {
              throw new Error(`Syntax error: ${result.stderr.trim()}`);
            }
          }

          // Combine stdout and stderr for output
          const output = result.stderr
            ? `${result.stdout}${result.stdout && result.stderr ? '\n' : ''}${result.stderr}`
            : result.stdout;

          return {
            output,
            exitCode: result.exitCode,
            language: effectiveRuntime
          };
        } catch (error) {
          // Handle E2B's CommandExitError
          if (error instanceof Error && error.message === 'exit status 1') {
            const actualStderr = (error as any)?.result?.stderr || '';
            if (actualStderr.includes('SyntaxError')) {
              const syntaxErrorLine = actualStderr.split('\n').find((line: string) => line.includes('SyntaxError')) || 'SyntaxError: Invalid syntax in code';
              throw new Error(`Syntax error: ${syntaxErrorLine}`);
            }
            // For runtime errors, return a result instead of throwing
            return {
              output: actualStderr || 'Error: Runtime error occurred during execution',
              exitCode: 1,
              language: runtime || 'node'
            };
          }

          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          throw new Error(
            `E2B execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: E2BSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();

        try {
          // Build command with options (E2B doesn't support these natively, so we wrap with shell)
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
          const result = (error as any)?.result;
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

          return entries.map((entry: any) => ({
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

    }
  }
});

// Export E2B sandbox type for explicit typing
export type { Sandbox as E2BSandbox } from 'e2b';
