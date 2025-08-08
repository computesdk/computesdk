/**
 * Vercel Provider - Factory-based Implementation
 * 
 * Demonstrates the new createProvider() factory pattern with ~50 lines
 * instead of the original ~350 lines of boilerplate.
 */

import { Sandbox as VercelSandbox } from '@vercel/sandbox';
import { createProvider } from 'computesdk';
import type { Runtime, ExecutionResult, SandboxInfo, CreateSandboxOptions, FileEntry } from 'computesdk';

/**
 * Vercel-specific configuration options
 */
export interface VercelConfig {
  /** Vercel API token - if not provided, will fallback to VERCEL_TOKEN environment variable */
  token?: string;
  /** Vercel team ID - if not provided, will fallback to VERCEL_TEAM_ID environment variable */
  teamId?: string;
  /** Vercel project ID - if not provided, will fallback to VERCEL_PROJECT_ID environment variable */
  projectId?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Helper to get command output from Vercel SDK streams
 */
async function getCommandOutput(stream: any): Promise<string> {
  if (!stream) return '';
  
  // Handle different stream types from Vercel SDK
  if (typeof stream === 'function') {
    try {
      return await stream() || '';
    } catch (error) {
      return '';
    }
  }
  
  if (typeof stream === 'string') {
    return stream;
  }
  
  return '';
}

/**
 * Create a Vercel provider instance using the factory pattern
 */
export const vercel = createProvider<VercelSandbox, VercelConfig>({
  name: 'vercel',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: VercelConfig, options?: CreateSandboxOptions) => {
        // Validate required environment variables
        const token = config.token || (typeof process !== 'undefined' && process.env?.VERCEL_TOKEN) || '';
        const teamId = config.teamId || (typeof process !== 'undefined' && process.env?.VERCEL_TEAM_ID) || '';
        const projectId = config.projectId || (typeof process !== 'undefined' && process.env?.VERCEL_PROJECT_ID) || '';
        
        if (!token) {
          throw new Error(
            `Missing Vercel token. Provide 'token' in config or set VERCEL_TOKEN environment variable. Get your token from https://vercel.com/account/tokens`
          );
        }
        
        if (!teamId) {
          throw new Error(
            `Missing Vercel team ID. Provide 'teamId' in config or set VERCEL_TEAM_ID environment variable.`
          );
        }
        
        if (!projectId) {
          throw new Error(
            `Missing Vercel project ID. Provide 'projectId' in config or set VERCEL_PROJECT_ID environment variable.`
          );
        }

        const runtime = options?.runtime || config.runtime || 'node';
        const timeout = config.timeout || 300000;

        try {
          let sandbox: VercelSandbox;

          if (options?.sandboxId) {
            // Reconnect to existing Vercel sandbox
            sandbox = await VercelSandbox.get({
              sandboxId: options.sandboxId,
              token,
              teamId,
              projectId,
            });
          } else {
            // Create new Vercel sandbox
            sandbox = await VercelSandbox.create({
              runtime: runtime === 'python' ? 'python3.13' : 'node22',
              timeout,
              token,
              teamId,
              projectId,
            });
          }

          return {
            sandbox,
            sandboxId: `vercel-${Date.now()}`
          };
        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('token')) {
              throw new Error(
                `Vercel authentication failed. Please check your VERCEL_TOKEN environment variable. Get your token from https://vercel.com/account/tokens`
              );
            }
            if (error.message.includes('team') || error.message.includes('project')) {
              throw new Error(
                `Vercel team/project configuration failed. Please check your VERCEL_TEAM_ID and VERCEL_PROJECT_ID environment variables.`
              );
            }
          }
          throw new Error(
            `Failed to create Vercel sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: VercelConfig, sandboxId: string) => {
        const token = config.token || process.env.VERCEL_TOKEN!;
        const teamId = config.teamId || process.env.VERCEL_TEAM_ID!;
        const projectId = config.projectId || process.env.VERCEL_PROJECT_ID!;

        try {
          const sandbox = await VercelSandbox.get({
            sandboxId,
            token,
            teamId,
            projectId,
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

      list: async (_config: VercelConfig) => {
        // Vercel doesn't have a native list API, so we return empty array
        // In a real implementation, you might want to store sandbox IDs in a database
        return [];
      },

      destroy: async (config: VercelConfig, sandboxId: string) => {
        const token = config.token || process.env.VERCEL_TOKEN!;
        const teamId = config.teamId || process.env.VERCEL_TEAM_ID!;
        const projectId = config.projectId || process.env.VERCEL_PROJECT_ID!;

        try {
          const sandbox = await VercelSandbox.get({
            sandboxId,
            token,
            teamId,
            projectId,
          });
          await sandbox.stop();
        } catch (error) {
          // Sandbox might already be destroyed or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (map to individual Sandbox methods)
      runCode: async (sandbox: VercelSandbox, code: string, runtime?: Runtime): Promise<ExecutionResult> => {
        const startTime = Date.now();
        
        try {
          let result;
          
          if (runtime === 'python') {
            // Execute Python code
            result = await sandbox.runCommand('python3', ['-c', code]);
          } else {
            // Execute Node.js code
            result = await sandbox.runCommand('node', ['-e', code]);
          }

          const stdout = await getCommandOutput(result.stdout);
          const stderr = await getCommandOutput(result.stderr);

          return {
            stdout,
            stderr,
            exitCode: result.exitCode || 0,
            executionTime: Date.now() - startTime,
            sandboxId: 'vercel-unknown',
            provider: 'vercel'
          };
        } catch (error) {
          throw new Error(
            `Vercel execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: VercelSandbox, command: string, args: string[] = []): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          const result = await sandbox.runCommand(command, args);
          const stdout = await getCommandOutput(result.stdout);
          const stderr = await getCommandOutput(result.stderr);

          return {
            stdout,
            stderr,
            exitCode: result.exitCode || 0,
            executionTime: Date.now() - startTime,
            sandboxId: 'vercel-unknown',
            provider: 'vercel'
          };
        } catch (error) {
          throw new Error(
            `Vercel command execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getInfo: async (sandbox: VercelSandbox): Promise<SandboxInfo> => {
        return {
          id: 'vercel-unknown',
          provider: 'vercel',
          runtime: 'node', // Vercel default
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: {
            vercelSandboxId: 'vercel-unknown'
          }
        };
      },

      // Optional filesystem methods - Vercel has shell-based filesystem support
      filesystem: {
        readFile: async (sandbox: VercelSandbox, path: string): Promise<string> => {
          const result = await sandbox.runCommand('cat', [path]);
          const content = await getCommandOutput(result.stdout);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to read file ${path}: ${await getCommandOutput(result.stderr)}`);
          }
          return content;
        },

        writeFile: async (sandbox: VercelSandbox, path: string, content: string): Promise<void> => {
          const result = await sandbox.runCommand('sh', ['-c', `echo ${JSON.stringify(content)} > ${JSON.stringify(path)}`]);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to write file ${path}: ${await getCommandOutput(result.stderr)}`);
          }
        },

        mkdir: async (sandbox: VercelSandbox, path: string): Promise<void> => {
          const result = await sandbox.runCommand('mkdir', ['-p', path]);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to create directory ${path}: ${await getCommandOutput(result.stderr)}`);
          }
        },

        readdir: async (sandbox: VercelSandbox, path: string): Promise<FileEntry[]> => {
          const result = await sandbox.runCommand('ls', ['-la', path]);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to list directory ${path}: ${await getCommandOutput(result.stderr)}`);
          }

          const output = await getCommandOutput(result.stdout);
          const lines = output.split('\n').filter(line => line.trim() && !line.startsWith('total'));
          
          return lines.map(line => {
            const parts = line.trim().split(/\s+/);
            const name = parts[parts.length - 1];
            const isDirectory = line.startsWith('d');
            
            return {
              name,
              path: `${path}/${name}`,
              isDirectory,
              size: parseInt(parts[4]) || 0,
              lastModified: new Date()
            };
          });
        },

        exists: async (sandbox: VercelSandbox, path: string): Promise<boolean> => {
          const result = await sandbox.runCommand('test', ['-e', path]);
          return result.exitCode === 0;
        },

        remove: async (sandbox: VercelSandbox, path: string): Promise<void> => {
          const result = await sandbox.runCommand('rm', ['-rf', path]);
          if (result.exitCode !== 0) {
            throw new Error(`Failed to remove ${path}: ${await getCommandOutput(result.stderr)}`);
          }
        }
      }
    }
  }
});