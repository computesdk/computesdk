/**
 * Vercel Provider - Factory-based Implementation
 * 
 * Demonstrates the new createProvider() factory pattern with ~50 lines
 * instead of the original ~350 lines of boilerplate.
 */

import { Sandbox as VercelSandbox } from '@vercel/sandbox';
import { createProvider, createBackgroundCommand } from 'computesdk';
import type { Runtime, ExecutionResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from 'computesdk';

/**
 * Vercel sandbox provider configuration
 */
export interface VercelConfig {
  /** Vercel API token */
  token?: string;
  /** Vercel team ID */
  teamId?: string;
  /** Vercel project ID */
  projectId?: string;
  /** Runtime environment for code execution */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}



/**
 * Shared command execution logic for Vercel provider
 * This eliminates duplication between runCode and runCommand
 */
async function executeVercelCommand(sandbox: VercelSandbox, command: string, args: string[] = []): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    // Execute command directly (non-detached returns CommandFinished)
    const finishedCommand = await sandbox.runCommand(command, args);

    // Use single logs() iteration to avoid "multiple consumers" warning
    let stdout = '';
    let stderr = '';

    // Single iteration over logs - this is the most reliable approach
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
          `Vercel provider does not support listing sandboxes. Vercel sandboxes are ephemeral and designed for single-use execution.`
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

          // Use base64 encoding for both runtimes for reliability and consistency
          const encoded = Buffer.from(code).toString('base64');
          let commandString;

          if (effectiveRuntime === 'python') {
            // Execute Python code with base64 encoding
            commandString = `echo "${encoded}" | base64 -d | python3`;
          } else {
            // Execute Node.js code with base64 encoding
            commandString = `echo "${encoded}" | base64 -d | node`;
          }

          // Use shared command execution logic
          const result = await executeVercelCommand(sandbox, 'sh', ['-c', commandString]);

          // Check for syntax errors and throw them
          if (result.exitCode !== 0 && result.stderr) {
            // Check for common syntax error patterns
            if (result.stderr.includes('SyntaxError') ||
              result.stderr.includes('invalid syntax') ||
              result.stderr.includes('Unexpected token') ||
              result.stderr.includes('Unexpected identifier')) {
              throw new Error(`Syntax error: ${result.stderr.trim()}`);
            }
          }

          return result;
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

      runCommand: async (sandbox: VercelSandbox, command: string, args: string[] = [], options?: RunCommandOptions): Promise<ExecutionResult> => {
        // Handle background command execution
        const { command: finalCommand, args: finalArgs, isBackground } = createBackgroundCommand(command, args, options);
        
        const result = await executeVercelCommand(sandbox, finalCommand, finalArgs);
        
        return {
          ...result,
          isBackground,
          // For background commands, we can't get a real PID, but we can indicate it's running
          ...(isBackground && { pid: -1 })
        };
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

      getUrl: async (sandbox: VercelSandbox, options: { port: number; protocol?: string }): Promise<string> => {
        try {
          // Use Vercel's built-in domain method to get the real domain
          let url = sandbox.domain(options.port);
          
          // If a specific protocol is requested, replace the URL's protocol
          if (options.protocol) {
            const urlObj = new URL(url);
            urlObj.protocol = options.protocol + ':';
            url = urlObj.toString();
          }
          
          return url;
        } catch (error) {
          throw new Error(
            `Failed to get Vercel domain for port ${options.port}: ${error instanceof Error ? error.message : String(error)}. Ensure the port has an associated route.`
          );
        }
      },

      // Provider-specific typed getInstance method
      getInstance: (sandbox: VercelSandbox): VercelSandbox => {
        return sandbox;
      },

    }
  }
});
