/**
 * Cloudflare Provider - Factory-based Implementation
 * 
 * Full-featured provider using Cloudflare Sandbox SDK with all required methods.
 * Leverages Cloudflare's edge network and Durable Objects for sandboxed execution.
 */

import { getSandbox, Sandbox } from '@cloudflare/sandbox';
import { createProvider } from 'computesdk';

// Re-export Sandbox as CFSandbox for easier worker integration
export { Sandbox as CFSandbox };
import type { 
  ExecutionResult, 
  SandboxInfo, 
  Runtime,
  CreateSandboxOptions,
  FileEntry
} from 'computesdk';

/**
 * Cloudflare-specific configuration options
 */
export interface CloudflareConfig {
  /** Cloudflare Sandbox binding from Workers environment - the Durable Object binding */
  sandboxBinding: DurableObjectNamespace<Sandbox>;
  /** Hostname for port exposure (e.g., your worker domain) */
  hostname?: string;
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
  hostname?: string; // Hostname for port exposure
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
export const cloudflare = createProvider<CloudflareSandbox, CloudflareConfig>({
  name: 'cloudflare',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: CloudflareConfig, options?: CreateSandboxOptions) => {
        // Validate Cloudflare Workers environment
        if (typeof globalThis.caches === 'undefined' || typeof globalThis.Request === 'undefined') {
          throw new Error(
            `Cloudflare provider can only be used within a Cloudflare Worker environment. ` +
            `Make sure you're running this code in a Worker, not in Node.js or browser.`
          );
        }

        // Validate Cloudflare Workers environment binding
        if (!config.sandboxBinding) {
          throw new Error(
            `Missing Cloudflare Sandbox binding. Provide 'sandboxBinding' in config with the Durable Object binding from your Cloudflare Workers environment (env.Sandbox). ` +
            `Make sure your wrangler.toml includes the Sandbox binding. See https://developers.cloudflare.com/durable-objects/get-started/ for setup instructions.`
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
            hostname: config.hostname,
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
                `Cloudflare Sandbox binding failed. Ensure your Durable Object binding "Sandbox" is properly configured in wrangler.toml with the correct class_name. ` +
                `Check that your binding matches: { name = "Sandbox", class_name = "Sandbox" }. ` +
                `See https://developers.cloudflare.com/durable-objects/get-started/ for setup instructions.`
              );
            }
            if (error.message.includes('quota') || error.message.includes('limit')) {
              throw new Error(
                `Cloudflare resource limits exceeded. You may have reached the container or Durable Object limits for your plan. ` +
                `Check your usage at https://dash.cloudflare.com/ and consider upgrading your plan if needed.`
              );
            }
            if (error.message.includes('container') || error.message.includes('image')) {
              throw new Error(
                `Cloudflare container configuration error. Ensure your Dockerfile and container binding are correctly set up. ` +
                `Verify your wrangler.toml includes the [[containers]] section with the correct image path.`
              );
            }
          }
          throw new Error(
            `Failed to create Cloudflare sandbox: ${error instanceof Error ? error.message : String(error)}. ` +
            `Common issues: missing wrangler.toml configuration, incorrect binding names, or network connectivity problems.`
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
            hostname: config.hostname,
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
      runCode: async (cloudflareSandbox: CloudflareSandbox, code: string, runtime?: Runtime): Promise<ExecutionResult> => {
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
              stdout,
              stderr,
              exitCode: 0, // Cloudflare code interpreter doesn't expose exit codes directly
              executionTime: Date.now() - startTime,
              sandboxId,
              provider: 'cloudflare'
            };
          } else {
            // For Node.js/JavaScript, use exec with node command
            const execResult = await sandbox.exec(`node -e "${code.replace(/"/g, '\\"')}"`);
            
            result = {
              stdout: execResult.stdout || '',
              stderr: execResult.stderr || '',
              exitCode: execResult.exitCode || 0,
              executionTime: Date.now() - startTime,
              sandboxId,
              provider: 'cloudflare'
            };
          }

          // Check for syntax errors
          if (result.stderr && (
            result.stderr.includes('SyntaxError') ||
            result.stderr.includes('invalid syntax') ||
            result.stderr.includes('Unexpected token')
          )) {
            throw new Error(`Syntax error: ${result.stderr.trim()}`);
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

      runCommand: async (cloudflareSandbox: CloudflareSandbox, command: string, args: string[] = []): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          const { sandbox, sandboxId } = cloudflareSandbox;
          
          // Construct full command with arguments
          const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

          // Execute command using Cloudflare's exec method
          const execResult = await sandbox.exec(fullCommand);

          return {
            stdout: execResult.stdout || '',
            stderr: execResult.stderr || '',
            exitCode: execResult.exitCode || 0,
            executionTime: Date.now() - startTime,
            sandboxId,
            provider: 'cloudflare'
          };
        } catch (error) {
          // For command failures, return error info instead of throwing
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127, // Command not found exit code
            executionTime: Date.now() - startTime,
            sandboxId: cloudflareSandbox.sandboxId,
            provider: 'cloudflare'
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
          const { sandbox, exposedPorts, hostname } = cloudflareSandbox;
          const { port, protocol = 'https' } = options;

          // Check if port is already exposed
          if (exposedPorts.has(port)) {
            return exposedPorts.get(port)!;
          }

          // Expose the port using Cloudflare's exposePort method with hostname if provided
          const exposeOptions = hostname ? { hostname } : {};
          const preview = await sandbox.exposePort(port, exposeOptions);
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
                path: `${path}/${name}`.replace('//', '/'),
                isDirectory: permissions.startsWith('d'),
                size,
                lastModified: isNaN(date.getTime()) ? new Date() : date
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