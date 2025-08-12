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
 * Create a Vercel provider instance using the factory pattern
 */
export const vercel = createProvider<VercelSandbox, VercelConfig>({
  name: 'vercel',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: VercelConfig, options?: CreateSandboxOptions) => {
        // Check for OIDC token first (recommended method)
        const oidcToken = typeof process !== 'undefined' && process.env?.VERCEL_OIDC_TOKEN;
        
        // Fall back to traditional method (token + teamId + projectId)
        const token = config.token || (typeof process !== 'undefined' && process.env?.VERCEL_TOKEN) || '';
        const teamId = config.teamId || (typeof process !== 'undefined' && process.env?.VERCEL_TEAM_ID) || '';
        const projectId = config.projectId || (typeof process !== 'undefined' && process.env?.VERCEL_PROJECT_ID) || '';
        
        // Validate authentication - either OIDC token OR traditional method
        if (!oidcToken && (!token || !teamId || !projectId)) {
          if (!oidcToken && !token) {
            throw new Error(
              `Missing Vercel authentication. Either:\n` +
              `1. Use OIDC token: Run 'vercel env pull' to get VERCEL_OIDC_TOKEN, or\n` +
              `2. Use traditional method: Provide 'token' in config or set VERCEL_TOKEN environment variable. Get your token from https://vercel.com/account/tokens`
            );
          }
          if (!oidcToken && !teamId) {
            throw new Error(
              `Missing Vercel team ID. Provide 'teamId' in config or set VERCEL_TEAM_ID environment variable.`
            );
          }
          if (!oidcToken && !projectId) {
            throw new Error(
              `Missing Vercel project ID. Provide 'projectId' in config or set VERCEL_PROJECT_ID environment variable.`
            );
          }
        }

        const runtime = options?.runtime || config.runtime || 'node';
        const timeout = config.timeout || 300000;

        try {
          let sandbox: VercelSandbox;

          if (options?.sandboxId) {
            // Vercel doesn't support reconnecting to existing sandboxes
            // Each sandbox is ephemeral and must be created fresh
            throw new Error(
              `Vercel provider does not support reconnecting to existing sandboxes. Vercel sandboxes are ephemeral and must be created fresh each time.`
            );
          } else {
            // Create new Vercel sandbox using the appropriate authentication method
            if (oidcToken) {
              // Use OIDC token method (simpler, recommended)
              sandbox = await VercelSandbox.create();
            } else {
              // Use traditional method (token + teamId + projectId)
              sandbox = await VercelSandbox.create({
                token,
                teamId,
                projectId,
              });
            }
          }

          return {
            sandbox,
            sandboxId: sandbox.sandboxId
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
        // Check for OIDC token first (recommended method)
        const oidcToken = typeof process !== 'undefined' && process.env?.VERCEL_OIDC_TOKEN;
        
        try {
          let sandbox: VercelSandbox;
          
          if (oidcToken) {
            // Use OIDC token method
            sandbox = await VercelSandbox.get({ sandboxId });
          } else {
            // Use traditional method
            const token = config.token || process.env.VERCEL_TOKEN!;
            const teamId = config.teamId || process.env.VERCEL_TEAM_ID!;
            const projectId = config.projectId || process.env.VERCEL_PROJECT_ID!;
            
            sandbox = await VercelSandbox.get({
              sandboxId,
              token,
              teamId,
              projectId,
            });
          }
          
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
        throw new Error(
          `Vercel provider does not support listing sandboxes. Vercel sandboxes are ephemeral and designed for single-use execution. Consider using a provider with persistent sandbox management like E2B.`
        );
      },

      destroy: async (config: VercelConfig, sandboxId: string) => {
        // Check for OIDC token first (recommended method)
        const oidcToken = typeof process !== 'undefined' && process.env?.VERCEL_OIDC_TOKEN;
        
        try {
          let sandbox: VercelSandbox;
          
          if (oidcToken) {
            // Use OIDC token method
            sandbox = await VercelSandbox.get({ sandboxId });
          } else {
            // Use traditional method
            const token = config.token || process.env.VERCEL_TOKEN!;
            const teamId = config.teamId || process.env.VERCEL_TEAM_ID!;
            const projectId = config.projectId || process.env.VERCEL_PROJECT_ID!;
            
            sandbox = await VercelSandbox.get({
              sandboxId,
              token,
              teamId,
              projectId,
            });
          }
          
          await sandbox.stop();
        } catch (error) {
          // Sandbox might already be destroyed or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (map to individual Sandbox methods)
      runCode: async (sandbox: VercelSandbox, code: string, runtime?: Runtime, config?: VercelConfig): Promise<ExecutionResult> => {
        const startTime = Date.now();
        
        try {
          // Auto-detect runtime if not specified
          const effectiveRuntime = runtime || config?.runtime || (
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
          
          let command;
          
          if (effectiveRuntime === 'python') {
            // Execute Python code
            command = await sandbox.runCommand('python3', ['-c', code]);
          } else {
            // Execute Node.js code  
            command = await sandbox.runCommand('node', ['-e', code]);
          }

          // Wait for command to complete and get exit code
          const finishedCommand = await command.wait();

          // Use single logs() iteration to avoid "multiple consumers" warning
          let stdout = '';
          let stderr = '';
          
          // Single iteration through logs to collect both stdout and stderr
          for await (const log of finishedCommand.logs()) {
            if (log.stream === 'stdout') {
              stdout += log.data;
            } else if (log.stream === 'stderr') {
              stderr += log.data;
            }
          }

          // Check for syntax errors and throw them (similar to E2B behavior)
          if (finishedCommand.exitCode !== 0 && stderr) {
            // Check for common syntax error patterns
            if (stderr.includes('SyntaxError') || 
                stderr.includes('invalid syntax') ||
                stderr.includes('Unexpected token') ||
                stderr.includes('Unexpected identifier')) {
              throw new Error(`Syntax error: ${stderr.trim()}`);
            }
          }

          return {
            stdout,
            stderr,
            exitCode: finishedCommand.exitCode,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.sandboxId,
            provider: 'vercel'
          };
        } catch (error) {
          // Re-throw syntax errors
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          throw new Error(
            `Vercel execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: VercelSandbox, command: string, args: string[] = []): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          const cmd = await sandbox.runCommand(command, args);
          
          // Wait for command to complete and get exit code
          const finishedCommand = await cmd.wait();

          // Use logs() iterator to avoid "multiple consumers" warning
          let stdout = '';
          let stderr = '';
          
          for await (const log of finishedCommand.logs()) {
            if (log.stream === 'stdout') {
              stdout += log.data;
            } else if (log.stream === 'stderr') {
              stderr += log.data;
            }
          }

          return {
            stdout,
            stderr,
            exitCode: finishedCommand.exitCode,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.sandboxId,
            provider: 'vercel'
          };
        } catch (error) {
          // For command execution, return error result instead of throwing
          // This handles cases like "command not found" where Vercel API returns 400
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127, // Standard "command not found" exit code
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.sandboxId,
            provider: 'vercel'
          };
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
          const cmd = await sandbox.runCommand('cat', [path]);
          const finishedCommand = await cmd.wait();
          
          if (finishedCommand.exitCode !== 0) {
            let stderr = '';
            for await (const log of finishedCommand.logs()) {
              if (log.stream === 'stderr') {
                stderr += log.data;
              }
            }
            throw new Error(`Failed to read file ${path}: ${stderr}`);
          }
          
          let content = '';
          for await (const log of finishedCommand.logs()) {
            if (log.stream === 'stdout') {
              content += log.data;
            }
          }
          // Trim trailing newline that cat command adds
          return content.replace(/\n$/, '');
        },

        writeFile: async (sandbox: VercelSandbox, path: string, content: string): Promise<void> => {
          const cmd = await sandbox.runCommand('sh', ['-c', `echo ${JSON.stringify(content)} > ${JSON.stringify(path)}`]);
          const finishedCommand = await cmd.wait();
          
          if (finishedCommand.exitCode !== 0) {
            let stderr = '';
            for await (const log of finishedCommand.logs()) {
              if (log.stream === 'stderr') {
                stderr += log.data;
              }
            }
            throw new Error(`Failed to write file ${path}: ${stderr}`);
          }
        },

        mkdir: async (sandbox: VercelSandbox, path: string): Promise<void> => {
          const cmd = await sandbox.runCommand('mkdir', ['-p', path]);
          const finishedCommand = await cmd.wait();
          
          if (finishedCommand.exitCode !== 0) {
            let stderr = '';
            for await (const log of finishedCommand.logs()) {
              if (log.stream === 'stderr') {
                stderr += log.data;
              }
            }
            throw new Error(`Failed to create directory ${path}: ${stderr}`);
          }
        },

        readdir: async (sandbox: VercelSandbox, path: string): Promise<FileEntry[]> => {
          const cmd = await sandbox.runCommand('ls', ['-la', path]);
          const finishedCommand = await cmd.wait();
          
          let stdout = '';
          let stderr = '';
          
          // Single iteration through logs to collect both stdout and stderr
          for await (const log of finishedCommand.logs()) {
            if (log.stream === 'stdout') {
              stdout += log.data;
            } else if (log.stream === 'stderr') {
              stderr += log.data;
            }
          }
          
          if (finishedCommand.exitCode !== 0) {
            throw new Error(`Failed to list directory ${path}: ${stderr}`);
          }
          
          const lines = (stdout || '').split('\n').filter((line: string) => line.trim() && !line.startsWith('total'));
          
          return lines.map((line: string) => {
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
          const cmd = await sandbox.runCommand('test', ['-e', path]);
          const finishedCommand = await cmd.wait();
          return finishedCommand.exitCode === 0; // Exit code 0 means file exists
        },

        remove: async (sandbox: VercelSandbox, path: string): Promise<void> => {
          const cmd = await sandbox.runCommand('rm', ['-rf', path]);
          const finishedCommand = await cmd.wait();
          
          if (finishedCommand.exitCode !== 0) {
            let stderr = '';
            for await (const log of finishedCommand.logs()) {
              if (log.stream === 'stderr') {
                stderr += log.data;
              }
            }
            throw new Error(`Failed to remove ${path}: ${stderr}`);
          }
        }
      }
    }
  }
});