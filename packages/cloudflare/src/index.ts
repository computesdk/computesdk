/**
 * Cloudflare Provider - Factory-based Implementation
 * 
 * Full-featured provider using Cloudflare Sandbox SDK with all required methods.
 * Leverages Cloudflare's edge network and Durable Objects for sandboxed execution.
 */

import { getSandbox } from '@cloudflare/sandbox';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

import type { Runtime, CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

/**
 * Cloudflare-specific configuration options
 */
export interface CloudflareConfig {
  /** Cloudflare Sandbox binding from Workers environment - the Durable Object binding */
  sandboxBinding?: any;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Environment variables to pass to sandbox */
  envVars?: Record<string, string>;
  /** Base URL for preview URLs (defaults to worker domain) */
  baseUrl?: string;
}

/**
 * Cloudflare sandbox wrapper - wraps the Cloudflare Sandbox instance
 */
interface CloudflareSandbox {
  sandbox: any; // The actual Cloudflare Sandbox instance from getSandbox()
  sandboxId: string;
  exposedPorts: Map<number, string>; // Track exposed ports and their URLs
}

/**
 * Detect runtime from code content
 */
function detectRuntime(code: string): Runtime {
  // Strong Python indicators
  if (code.includes('print(') || 
      code.includes('import ') ||
      code.includes('def ') ||
      code.includes('sys.') ||
      code.includes('json.') ||
      code.includes('__') ||
      code.includes('f"') ||
      code.includes("f'") ||
      code.includes('raise ')) {
    return 'python';
  }

  // Strong Node.js indicators
  if (code.includes('console.log') || 
      code.includes('process.') ||
      code.includes('require(') ||
      code.includes('module.exports') ||
      code.includes('__dirname') ||
      code.includes('__filename')) {
    return 'node';
  }

  // Default to Python for Cloudflare (matches their examples)
  return 'python';
}

/**
 * Create a Cloudflare provider instance using the factory pattern
 */
export const cloudflare = defineProvider<CloudflareSandbox, CloudflareConfig>({
  name: 'cloudflare',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: CloudflareConfig, options?: CreateSandboxOptions) => {
        // Validate Cloudflare Workers environment binding
        if (!config.sandboxBinding) {
          throw new Error(
            `Missing Cloudflare Sandbox binding. Provide 'sandboxBinding' in config with the Durable Object binding from your Cloudflare Workers environment (env.Sandbox). ` +
            `See https://developers.cloudflare.com/durable-objects/get-started/ for setup instructions.`
          );
        }

        const sandboxId = options?.sandboxId || `cf-sandbox-${Date.now()}`;

        try {
          // Create or connect to Cloudflare sandbox using getSandbox
          const sandbox = getSandbox(config.sandboxBinding, sandboxId);

          // Set environment variables if provided
          if (config.envVars) {
            await sandbox.setEnvVars(config.envVars);
          }

          const cloudflareSandbox: CloudflareSandbox = {
            sandbox,
            sandboxId,
            exposedPorts: new Map()
          };

          return {
            sandbox: cloudflareSandbox,
            sandboxId
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('binding')) {
              throw new Error(
                `Cloudflare Sandbox binding failed. Ensure your Durable Object binding is properly configured in wrangler.toml. ` +
                `See https://developers.cloudflare.com/durable-objects/get-started/ for setup instructions.`
              );
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(
                `Cloudflare resource limits exceeded. Check your usage at https://dash.cloudflare.com/`
              );
            }
          }
          throw new Error(
            `Failed to create Cloudflare sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: CloudflareConfig, sandboxId: string) => {
        if (!config.sandboxBinding) {
          return null;
        }

        try {
          // Reconnect to existing Cloudflare sandbox
          const sandbox = getSandbox(config.sandboxBinding, sandboxId);

          // Test connection - Note: ping may not be available on all sandbox versions
          try {
            await (sandbox as any).ping();
          } catch {
            // ping not supported, continue
          }

          const cloudflareSandbox: CloudflareSandbox = {
            sandbox,
            sandboxId,
            exposedPorts: new Map()
          };

          return {
            sandbox: cloudflareSandbox,
            sandboxId
          };
        } catch (error) {
          // Sandbox doesn't exist or can't be accessed
          return null;
        }
      },

      list: async (_config: CloudflareConfig) => {
        throw new Error(
          `Cloudflare provider does not support listing sandboxes. Cloudflare sandboxes are managed through Durable Objects and don't have a native list API. ` +
          `Use getById to reconnect to specific sandboxes by ID, or implement your own tracking system.`
        );
      },

      destroy: async (config: CloudflareConfig, sandboxId: string) => {
        try {
          if (config.sandboxBinding) {
            const sandbox = getSandbox(config.sandboxBinding, sandboxId);
            
            // Stop all processes and clean up
            await sandbox.killAllProcesses();
            
            // Note: Cloudflare Durable Objects manage their own lifecycle
            // The actual destruction happens automatically when the object is no longer referenced
          }
        } catch (error) {
          // Sandbox might already be destroyed or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (map to individual Sandbox methods)
      runCode: async (cloudflareSandbox: CloudflareSandbox, code: string, runtime?: Runtime): Promise<CodeResult> => {
        const startTime = Date.now();

        try {
          const { sandbox, sandboxId } = cloudflareSandbox;
          
          // Auto-detect runtime from code if not specified
          const detectedRuntime = runtime || detectRuntime(code);
          
          let result;

          if (detectedRuntime === 'python') {
            // Use Cloudflare's code interpreter for Python
            const execution = await sandbox.runCode(code, { language: 'python' });
            
            // Process the execution result
            let stdout = '';
            let stderr = '';
            
            // Handle streaming results if available
            if (execution.results && Array.isArray(execution.results)) {
              for (const res of execution.results) {
                if (res.text) {
                  stdout += res.text;
                }
              }
            }
            
            result = {
              output: stdout,
              exitCode: 0, // Cloudflare code interpreter doesn't expose exit codes directly
              language: 'python'
            };
          } else {
            // For Node.js/JavaScript, use exec with node command
            const execResult = await sandbox.exec(`node -e "${code.replace(/"/g, '\\"')}"`);
            
            result = {
              output: (execResult.stdout || '') + (execResult.stderr || ''),
              exitCode: execResult.exitCode || 0,
              language: 'node'
            };
          }

          // Check for syntax errors
          if (result.output && (
            result.output.includes('SyntaxError') ||
            result.output.includes('invalid syntax') ||
            result.output.includes('Unexpected token')
          )) {
            throw new Error(`Syntax error: ${result.output.trim()}`);
          }

          return result;
        } catch (error) {
          // Re-throw syntax errors
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          
          throw new Error(
            `Cloudflare execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (cloudflareSandbox: CloudflareSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
        const startTime = Date.now();

        try {
          const { sandbox, sandboxId } = cloudflareSandbox;

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

          // Execute command using Cloudflare's exec method
          const execResult = await sandbox.exec(fullCommand);

          return {
            stdout: execResult.stdout || '',
            stderr: execResult.stderr || '',
            exitCode: execResult.exitCode || 0,
            durationMs: Date.now() - startTime
          };
        } catch (error) {
          // For command failures, return error info instead of throwing
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127, // Command not found exit code
            durationMs: Date.now() - startTime
          };
        }
      },

      getInfo: async (cloudflareSandbox: CloudflareSandbox): Promise<SandboxInfo> => {
        try {
          const { sandbox, sandboxId } = cloudflareSandbox;
          
          // Test if sandbox is still alive - ping may not be available
          try {
            await (sandbox as any).ping();
          } catch {
            // ping not supported, continue
          }

          return {
            id: sandboxId,
            provider: 'cloudflare',
            runtime: 'python', // Cloudflare default
            status: 'running',
            createdAt: new Date(),
            timeout: 300000,
            metadata: {
              cloudflareSandboxId: sandboxId,
              durableObjectSandbox: true
            }
          };
        } catch (error) {
          return {
            id: cloudflareSandbox.sandboxId,
            provider: 'cloudflare',
            runtime: 'python',
            status: 'error',
            createdAt: new Date(),
            timeout: 300000,
            metadata: {
              cloudflareSandboxId: cloudflareSandbox.sandboxId,
              durableObjectSandbox: true,
              error: error instanceof Error ? error.message : String(error)
            }
          };
        }
      },

      getUrl: async (cloudflareSandbox: CloudflareSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          const { sandbox, exposedPorts } = cloudflareSandbox;
          const { port, protocol = 'https' } = options;

          // Check if port is already exposed
          if (exposedPorts.has(port)) {
            return exposedPorts.get(port)!;
          }

          // Expose the port using Cloudflare's exposePort method
          const preview = await sandbox.exposePort(port);
          const url = `${protocol}://${preview.url}`;
          
          // Cache the exposed URL
          exposedPorts.set(port, url);
          
          return url;
        } catch (error) {
          throw new Error(
            `Failed to expose port ${options.port}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      // Filesystem methods - Cloudflare has full filesystem support
      filesystem: {
        readFile: async (cloudflareSandbox: CloudflareSandbox, path: string): Promise<string> => {
          try {
            const { sandbox } = cloudflareSandbox;
            const file = await sandbox.readFile(path);
            return file.content || '';
          } catch (error) {
            throw new Error(`Failed to read file ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        writeFile: async (cloudflareSandbox: CloudflareSandbox, path: string, content: string): Promise<void> => {
          try {
            const { sandbox } = cloudflareSandbox;
            await sandbox.writeFile(path, content);
          } catch (error) {
            throw new Error(`Failed to write file ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        mkdir: async (cloudflareSandbox: CloudflareSandbox, path: string): Promise<void> => {
          try {
            const { sandbox } = cloudflareSandbox;
            await sandbox.mkdir(path);
          } catch (error) {
            throw new Error(`Failed to create directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        readdir: async (cloudflareSandbox: CloudflareSandbox, path: string): Promise<FileEntry[]> => {
          try {
            const { sandbox } = cloudflareSandbox;
            
            // Use ls command to get directory listing
            const result = await sandbox.exec(`ls -la "${path}"`);
            
            if (result.exitCode !== 0) {
              throw new Error(`Directory listing failed: ${result.stderr}`);
            }

            const lines = result.stdout.split('\n').filter((line: string) => line.trim() && !line.startsWith('total'));

            return lines.map((line: string) => {
              const parts = line.trim().split(/\s+/);
              const permissions = parts[0] || '';
              const size = parseInt(parts[4]) || 0;
              const dateStr = (parts[5] || '') + ' ' + (parts[6] || '');
              const date = dateStr.trim() ? new Date(dateStr) : new Date();
              const name = parts.slice(8).join(' ') || parts[parts.length - 1] || 'unknown';

              return {
                name,
                type: permissions.startsWith('d') ? 'directory' as const : 'file' as const,
                size,
                modified: isNaN(date.getTime()) ? new Date() : date
              };
            });
          } catch (error) {
            throw new Error(`Failed to read directory ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        },

        exists: async (cloudflareSandbox: CloudflareSandbox, path: string): Promise<boolean> => {
          try {
            const { sandbox } = cloudflareSandbox;
            const result = await sandbox.exec(`test -e "${path}"`);
            return result.exitCode === 0;
          } catch (error) {
            return false;
          }
        },

        remove: async (cloudflareSandbox: CloudflareSandbox, path: string): Promise<void> => {
          try {
            const { sandbox } = cloudflareSandbox;
            const result = await sandbox.exec(`rm -rf "${path}"`);
            
            if (result.exitCode !== 0) {
              throw new Error(`Remove failed: ${result.stderr}`);
            }
          } catch (error) {
            throw new Error(`Failed to remove ${path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }
  }
});
