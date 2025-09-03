/**
 * E2B Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 * Reduces ~400 lines of boilerplate to ~100 lines of core logic.
 */

import { Sandbox as E2BSandbox } from 'e2b';
import { createProvider, createBackgroundCommand } from 'computesdk';


import type {
  ExecutionResult,
  SandboxInfo,
  Runtime,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions
} from 'computesdk';

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
export const e2b = createProvider<E2BSandbox, E2BConfig>({
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
                domain: options.domain,
              });
            } else {
              sandbox = await E2BSandbox.create({
                apiKey: apiKey,
                timeoutMs: timeout,
                domain: options?.domain,
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
      runCode: async (sandbox: E2BSandbox, code: string, runtime?: Runtime): Promise<ExecutionResult> => {
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
              code.includes("f'")
              ? 'python'
              // Default to Node.js for all other cases (including ambiguous)
              : 'node'
          );

          // Use runCommand for consistent execution across all providers
          let result;

          // Use base64 encoding for both runtimes for reliability and consistency
          const encoded = Buffer.from(code).toString('base64');

          if (effectiveRuntime === 'python') {
            result = await sandbox.commands.run(`echo "${encoded}" | base64 -d | python3`);
          } else {
            result = await sandbox.commands.run(`echo "${encoded}" | base64 -d | node`);
          }

          // Check for syntax errors and throw them (similar to Vercel behavior)
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
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.sandboxId || 'e2b-unknown',
            provider: 'e2b'
          };
        } catch (error) {
          // Handle E2B's CommandExitError - check if it contains actual error details
          if (error instanceof Error && error.message === 'exit status 1') {
            const actualStderr = (error as any)?.result?.stderr || '';
            const isSyntaxError = actualStderr.includes('SyntaxError');

            if (isSyntaxError) {
              // For syntax errors, throw
              const syntaxErrorLine = actualStderr.split('\n').find((line: string) => line.includes('SyntaxError')) || 'SyntaxError: Invalid syntax in code';
              throw new Error(`Syntax error: ${syntaxErrorLine}`);
            } else {
              // For runtime errors, return a result instead of throwing
              return {
                stdout: '',
                stderr: actualStderr || 'Error: Runtime error occurred during execution',
                exitCode: 1,
                executionTime: Date.now() - startTime,
                sandboxId: sandbox.sandboxId || 'e2b-unknown',
                provider: 'e2b'
              };
            }
          }

          // Re-throw syntax errors
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          throw new Error(
            `E2B execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: E2BSandbox, command: string, args: string[] = [], options?: RunCommandOptions): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          // Handle background command execution
          const { command: finalCommand, args: finalArgs, isBackground } = createBackgroundCommand(command, args, options);
          
          // Construct full command with arguments
          const fullCommand = finalArgs.length > 0 ? `${finalCommand} ${finalArgs.join(' ')}` : finalCommand;

          // Execute command using E2B's bash execution via Python subprocess
          const execution = await sandbox.commands.run(fullCommand);

          return {
            stdout: execution.stdout,
            stderr: execution.stderr,
            exitCode: execution.exitCode,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.sandboxId || 'e2b-unknown',
            provider: 'e2b',
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
            sandboxId: sandbox.sandboxId || 'e2b-unknown',
            provider: 'e2b'
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
            path: entry.path,
            isDirectory: Boolean(entry.isDir || entry.isDirectory),
            size: entry.size || 0,
            lastModified: new Date(entry.lastModified || Date.now())
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

// Note: getInstance() typing is now handled by generic type parameters in the core SDK

/**
 * Create a properly typed compute instance for E2B
 * This version provides full type safety for getInstance() calls
 * 
 * @example
 * ```typescript
 * import { createE2BCompute } from '@computesdk/e2b'
 * 
 * const compute = createE2BCompute({ apiKey: 'your-key' });
 * const sandbox = await compute.sandbox.create();
 * const instance = sandbox.getInstance(); // ✅ Properly typed as E2B Sandbox!
 * ```
 */
export function createE2BCompute(config: E2BConfig): {
  sandbox: {
    create(): Promise<{
      sandboxId: string;
      provider: string;
      runCode(code: string, runtime?: import('computesdk').Runtime): Promise<import('computesdk').ExecutionResult>;
      runCommand(command: string, args?: string[]): Promise<import('computesdk').ExecutionResult>;
      getInfo(): Promise<import('computesdk').SandboxInfo>;
      getUrl(options: { port: number; protocol?: string }): Promise<string>;
      getProvider(): ReturnType<typeof e2b>;
      getInstance(): E2BSandbox; // ✅ Properly typed!
      kill(): Promise<void>;
      destroy(): Promise<void>;
      filesystem: import('computesdk').SandboxFileSystem;
    }>;
  };
} {
  const provider = e2b(config);
  
  return {
    sandbox: {
      create: async () => {
        const sandbox = await provider.sandbox.create();
        return {
          ...sandbox,
          getInstance: (): E2BSandbox => {
            return sandbox.getInstance() as E2BSandbox;
          }
        };
      }
    }
  };
}
