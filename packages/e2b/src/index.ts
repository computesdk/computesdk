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
          let execution;
          
          // Auto-detect runtime if not specified
          const effectiveRuntime = runtime || (
            // Strong JavaScript indicators
            code.includes('console.log') || 
            code.includes('require(') || 
            code.includes('throw new Error') ||
            code.includes('const ') ||
            code.includes('let ') ||
            code.includes('var ') ||
            code.includes('=>') ||
            (code.includes('function ') && !code.includes('def '))
              ? 'node' 
              // Strong Python indicators  
              : (code.includes('print(') || 
                 code.includes('import ') ||
                 code.includes('def ') ||
                 code.includes('sys.') ||
                 code.includes('json.') ||
                 code.includes('__') ||
                 code.includes('f"') ||
                 code.includes("f'"))
                ? 'python'
                // Default to node for ambiguous cases (most tests are JS)
                : 'node'
          );
          
          if (effectiveRuntime === 'node') {
            // For Node.js code, execute using Node.js via shell command with base64 encoding
            const encoded = Buffer.from(code).toString('base64');
            const result = await sandbox.commands.run(`echo "${encoded}" | base64 -d | node`);
            
            // Convert shell command result to execution format
            execution = {
              logs: {
                stdout: result.stdout ? [result.stdout] : [],
                stderr: result.stderr ? [result.stderr] : []
              },
              error: result.exitCode !== 0 ? { 
                name: 'ExecutionError', 
                value: result.stderr || 'Command failed',
                traceback: result.stderr || ''
              } : null
            };
          } else {
            // For Python code, use E2B's runCode API
            execution = await sandbox.runCode(code);
          }

          const hasError = execution.error !== null;
          const exitCode = hasError ? 1 : 0;
          
          return {
            stdout: hasError ? '' : execution.logs.stdout.join('\n'),
            stderr: hasError ? (execution.error?.traceback || execution.error?.value || 'Execution failed') : execution.logs.stderr.join('\n'),
            exitCode,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.sandboxId || 'e2b-unknown',
            provider: 'e2b'
          };
        } catch (error) {
          // Only throw for syntax errors or severe failures
          if (error instanceof Error && error.message.includes('SyntaxError')) {
            throw new Error(`E2B syntax error: ${error.message}`);
          }
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
          const execution = await sandbox.commands.run(fullCommand);

          return {
            stdout: execution.stdout,
            stderr: execution.stderr,
            exitCode: execution.exitCode,
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
        create: async (sandbox: E2BSandbox, options: TerminalCreateOptions = {}) => {
          const command = options.command || 'bash';
          const cols = options.cols || 80;
          const rows = options.rows || 24;

          // Create PTY session using E2B's pty.create
          const ptyHandle = await sandbox.pty.create({ 
            cols: cols, 
            rows: rows,
            onData: options.onData || (() => {
              // Default no-op if no onData provided
            })
          });

          return {
            terminal: ptyHandle,
            terminalId: ptyHandle.pid.toString()
          };
        },

        getById: async (sandbox: E2BSandbox, terminalId: string) => {
          try {
            const pid = parseInt(terminalId);
            if (isNaN(pid)) return null;

            // List all running processes (includes PTY sessions)
            const processes = await sandbox.commands.list();
            
            // Find PTY process by PID
            const ptyProcess = processes.find(p => p.pid === pid);
            if (!ptyProcess) return null;

            return {
              terminal: { pid: ptyProcess.pid, cmd: ptyProcess.cmd },
              terminalId: terminalId
            };
          } catch (error) {
            return null;
          }
        },

        list: async (sandbox: E2BSandbox) => {
          try {
            // List all running processes
            const processes = await sandbox.commands.list();
            
            // Filter for PTY sessions and return raw terminal data
            return processes
              .filter(p => ['bash', 'sh', 'zsh', 'fish', 'pty'].some(term => p.cmd.includes(term)))
              .map(p => ({
                terminal: { pid: p.pid, cmd: p.cmd },
                terminalId: p.pid.toString()
              }));
          } catch (error) {
            // If listing fails, return empty array
            return [];
          }
        },

        destroy: async (sandbox: E2BSandbox, terminalId: string): Promise<void> => {
          const pid = parseInt(terminalId);
          if (isNaN(pid)) {
            throw new Error(`Invalid terminal ID: ${terminalId}. Expected numeric PID.`);
          }

          try {
            await sandbox.pty.kill(pid);
          } catch (error) {
            // Terminal might already be destroyed or doesn't exist
            // This is acceptable for destroy operations
          }
        },

        // Terminal instance methods
        write: async (sandbox: E2BSandbox, terminal: any, data: Uint8Array | string): Promise<void> => {
          const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
          if (terminal.pid) {
            // For existing terminals, use PID
            await sandbox.pty.sendInput(terminal.pid, bytes);
          } else {
            // For new terminals, use the ptyHandle directly
            await sandbox.pty.sendInput(terminal.pid || terminal.id, bytes);
          }
        },

        resize: async (sandbox: E2BSandbox, terminal: any, cols: number, rows: number): Promise<void> => {
          const pid = terminal.pid || terminal.id;
          await sandbox.pty.resize(pid, { cols, rows });
        },

        kill: async (sandbox: E2BSandbox, terminal: any): Promise<void> => {
          const pid = terminal.pid || terminal.id;
          if (terminal.kill) {
            // For ptyHandle objects
            await terminal.kill();
          } else {
            // For process objects
            await sandbox.pty.kill(pid);
          }
        }
      }
    }
  }
});
