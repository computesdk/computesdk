/**
 * E2B Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem and terminal support using the factory pattern.
 * Reduces ~400 lines of boilerplate to ~100 lines of core logic.
 */

import { Sandbox as E2BSandbox } from '@e2b/code-interpreter';
import { createProvider } from 'computesdk';
import type { 
  Runtime, 
  ExecutionResult, 
  SandboxInfo, 
  CreateSandboxOptions,
  FileEntry,
  TerminalSession,
  TerminalCreateOptions
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

        const runtime = options?.runtime || config.runtime || 'python';
        const timeout = config.timeout || 300000;

        try {
          let sandbox: E2BSandbox;
          let sandboxId: string;

          if (options?.sandboxId) {
            // Reconnect to existing E2B session
            sandbox = await E2BSandbox.connect(options.sandboxId, {
              apiKey: apiKey,
            });
            sandboxId = options.sandboxId;
          } else {
            // Create new E2B session
            sandbox = await E2BSandbox.create({
              apiKey: apiKey,
              timeoutMs: timeout,
            });
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

      list: async (_config: E2BConfig) => {
        throw new Error(
          `E2B provider does not support listing sandboxes. E2B sandboxes are managed individually and don't have a native list API. Consider using a provider with persistent sandbox management or implement your own tracking system.`
        );
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
          // Execute code using E2B's runCode API
          const execution = await sandbox.runCode(code);

          return {
            stdout: execution.logs.stdout.join('\n'),
            stderr: execution.logs.stderr.join('\n'),
            exitCode: execution.error ? 1 : 0,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.sandboxId || 'e2b-unknown',
            provider: 'e2b'
          };
        } catch (error) {
          throw new Error(
            `E2B execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: E2BSandbox, command: string, args: string[] = []): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          // Construct full command with arguments
          const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

          // Execute command using E2B's bash execution via Python subprocess
          const execution = await sandbox.runCode(`
import subprocess
import sys

result = subprocess.run(${JSON.stringify(fullCommand)}, shell=True, capture_output=True, text=True)
print(result.stdout, end='')
if result.stderr:
    print(result.stderr, end='', file=sys.stderr)
sys.exit(result.returncode)
`);

          return {
            stdout: execution.logs.stdout.join('\n'),
            stderr: execution.logs.stderr.join('\n'),
            exitCode: execution.error ? 1 : 0,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.sandboxId || 'e2b-unknown',
            provider: 'e2b'
          };
        } catch (error) {
          throw new Error(
            `E2B command execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
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

      // Optional terminal methods - E2B has PTY terminal support
      terminal: {
        create: async (sandbox: E2BSandbox, options: TerminalCreateOptions = {}): Promise<TerminalSession> => {
          const command = options.command || 'bash';
          const cols = options.cols || 80;
          const rows = options.rows || 24;

          // Create PTY session using E2B's pty.create
          const ptyHandle = await sandbox.pty.create({ 
            cols: cols, 
            rows: rows,
            onData: (data: Uint8Array) => {
              // PTY output handler - applications can subscribe to this
              if (terminalSession.onData) {
                terminalSession.onData(data);
              }
            }
          });

          // Create terminal session with methods
          const terminalSession: TerminalSession = {
            pid: ptyHandle.pid,
            command,
            status: 'running',
            cols,
            rows,
            
            write: async (data: Uint8Array | string) => {
              // E2B PTY handles write via the onData callback mechanism
              // For now, we'll throw an error since direct write isn't supported
              throw new Error('Direct terminal write not supported by E2B PTY. Use command execution instead.');
            },
            
            resize: async (newCols: number, newRows: number) => {
              // E2B PTY doesn't support runtime resize
              throw new Error('Terminal resize not supported by E2B PTY.');
            },
            
            kill: async () => {
              await ptyHandle.kill();
            }
          };

          return terminalSession;
        },

        list: async (sandbox: E2BSandbox): Promise<TerminalSession[]> => {
          throw new Error(
            `E2B provider does not support listing active terminals. E2B terminals are managed individually through the PTY interface. Create terminals as needed using terminal.create().`
          );
        }
      }
    }
  }
});