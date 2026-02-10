/**
 * Vercel Provider - Factory-based Implementation
 * 
 * Demonstrates the new defineProvider() factory pattern with ~50 lines
 * instead of the original ~350 lines of boilerplate.
 */

import { Sandbox as VercelSandbox, Snapshot as VercelSnapshot } from '@vercel/sandbox';
import { defineProvider, escapeShellArg } from '@computesdk/provider';

export type { VercelSandbox, VercelSnapshot };


import type { Runtime, CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

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
  /** Ports to expose */
  ports?: number[];
}

/**
 * Resolved Vercel credentials with the authentication method to use
 */
interface ResolvedCredentials {
  /** Whether to use OIDC authentication (no explicit credentials needed) */
  useOidc: boolean;
  /** Token for traditional auth (only used if useOidc is false) */
  token: string;
  /** Team ID for traditional auth (only used if useOidc is false) */
  teamId: string;
  /** Project ID for traditional auth (only used if useOidc is false) */
  projectId: string;
}

/**
 * Resolve Vercel credentials with proper precedence:
 * 1. Config values (from setConfig) always win
 * 2. Environment variables are used as fallback
 * 3. OIDC is only used when no config credentials are provided
 */
function resolveCredentials(config: VercelConfig): ResolvedCredentials {
  // Get values from config first, then fall back to environment
  const token = config.token || (typeof process !== 'undefined' && process.env?.VERCEL_TOKEN) || '';
  const teamId = config.teamId || (typeof process !== 'undefined' && process.env?.VERCEL_TEAM_ID) || '';
  const projectId = config.projectId || (typeof process !== 'undefined' && process.env?.VERCEL_PROJECT_ID) || '';
  
  // Check if config explicitly provided credentials (config takes precedence)
  const hasConfigCredentials = !!(config.token || config.teamId || config.projectId);
  
  // Only use OIDC if:
  // 1. No config credentials were provided, AND
  // 2. OIDC token is available in environment
  const oidcToken = typeof process !== 'undefined' && process.env?.VERCEL_OIDC_TOKEN;
  const useOidc = !hasConfigCredentials && !!oidcToken;
  
  return { useOidc, token, teamId, projectId };
}

/**
 * Validate that we have sufficient credentials to authenticate
 */
function validateCredentials(creds: ResolvedCredentials): void {
  if (creds.useOidc) {
    // OIDC auth - no additional validation needed
    return;
  }
  
  // Traditional auth - need all three
  if (!creds.token) {
    throw new Error(
      `Missing Vercel authentication. Either:\n` +
      `1. Use OIDC token: Run 'vercel env pull' to get VERCEL_OIDC_TOKEN, or\n` +
      `2. Use traditional method: Provide 'token' in config or set VERCEL_TOKEN environment variable. Get your token from https://vercel.com/account/tokens`
    );
  }
  if (!creds.teamId) {
    throw new Error(
      `Missing Vercel team ID. Provide 'teamId' in config or set VERCEL_TEAM_ID environment variable.`
    );
  }
  if (!creds.projectId) {
    throw new Error(
      `Missing Vercel project ID. Provide 'projectId' in config or set VERCEL_PROJECT_ID environment variable.`
    );
  }
}




/**
 * Create a Vercel provider instance using the factory pattern
 */
export const vercel = defineProvider<VercelSandbox, VercelConfig, any, VercelSnapshot>({
  name: 'vercel',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: VercelConfig, options?: CreateSandboxOptions) => {
        // Resolve credentials with proper precedence (config wins over env)
        const creds = resolveCredentials(config);
        validateCredentials(creds);

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
            // Construct base params
            // options.ports takes precedence over config.ports
            const params: any = {
              ports: options?.ports ?? config.ports,
              timeout,
            };

            // Support both ComputeSDK format (snapshotId at top level) and 
            // Vercel SDK format (source.snapshotId nested)
            const snapshotId = options?.snapshotId || 
              (options?.source?.type === 'snapshot' && options?.source?.snapshotId);
            
            if (snapshotId) {
              params.source = {
                type: 'snapshot',
                snapshotId
              };
            }

            // Add auth params if not using OIDC
            if (!creds.useOidc) {
              params.token = creds.token;
              params.teamId = creds.teamId;
              params.projectId = creds.projectId;
            }

            sandbox = await VercelSandbox.create(params);
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
        // Resolve credentials with proper precedence (config wins over env)
        const creds = resolveCredentials(config);

        try {
          let sandbox: VercelSandbox;

          if (creds.useOidc) {
            // Use OIDC token method
            sandbox = await VercelSandbox.get({ sandboxId });
          } else {
            // Use traditional method
            sandbox = await VercelSandbox.get({
              sandboxId,
              token: creds.token,
              teamId: creds.teamId,
              projectId: creds.projectId,
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
        // Resolve credentials with proper precedence (config wins over env)
        const creds = resolveCredentials(config);

        try {
          let sandbox: VercelSandbox;

          if (creds.useOidc) {
            // Use OIDC token method
            sandbox = await VercelSandbox.get({ sandboxId });
          } else {
            // Use traditional method
            sandbox = await VercelSandbox.get({
              sandboxId,
              token: creds.token,
              teamId: creds.teamId,
              projectId: creds.projectId,
            });
          }

          await sandbox.stop();
        } catch (error) {
          // Sandbox might already be destroyed or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (map to individual Sandbox methods)
      runCode: async (sandbox: VercelSandbox, code: string, runtime?: Runtime, config?: VercelConfig): Promise<CodeResult> => {
        const startTime = Date.now();

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
            code.includes("f'") ||
            code.includes('raise ')
            ? 'python'
            // Default to Node.js for all other cases (including ambiguous)
            : 'node'
        );

        // Use base64 encoding for both runtimes for reliability and consistency
        const encoded = Buffer.from(code).toString('base64');
        const commandString = effectiveRuntime === 'python'
          ? `echo "${encoded}" | base64 -d | python3`
          : `echo "${encoded}" | base64 -d | node`;

        const result = await sandbox.runCommand('sh', ['-c', commandString]);
        // Call stdout/stderr sequentially to avoid "Multiple consumers for logs" warning
        const stdout = await result.stdout();
        const stderr = await result.stderr();

        // Check for syntax errors and throw them
        if (result.exitCode !== 0 && stderr) {
          if (stderr.includes('SyntaxError') ||
            stderr.includes('invalid syntax') ||
            stderr.includes('Unexpected token') ||
            stderr.includes('Unexpected identifier')) {
            throw new Error(`Syntax error: ${stderr.trim()}`);
          }
        }

        return {
          output: stdout + stderr,
          exitCode: result.exitCode,
          language: effectiveRuntime,
        };
      },

      runCommand: async (sandbox: VercelSandbox, command: string, options?: RunCommandOptions): Promise<CommandResult> => {
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

          const result = await sandbox.runCommand('sh', ['-c', fullCommand]);
          // Call stdout/stderr sequentially to avoid "Multiple consumers for logs" warning
          const stdout = await result.stdout();
          const stderr = await result.stderr();

          return {
            stdout,
            stderr,
            exitCode: result.exitCode,
            durationMs: Date.now() - startTime,
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            durationMs: Date.now() - startTime,
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

      filesystem: {
        readFile: async (sandbox: VercelSandbox, path: string): Promise<string> => {
          const stream = await sandbox.readFile({ path });
          if (!stream) {
            throw new Error(`File not found: ${path}`);
          }
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          return Buffer.concat(chunks).toString('utf-8');
        },

        writeFile: async (sandbox: VercelSandbox, path: string, content: string): Promise<void> => {
          await sandbox.writeFiles([{ path, content: Buffer.from(content) }]);
        },

        mkdir: async (sandbox: VercelSandbox, path: string): Promise<void> => {
          await sandbox.mkDir(path);
        },

        readdir: async (_sandbox: VercelSandbox, _path: string): Promise<FileEntry[]> => {
          throw new Error('Vercel sandbox does not support readdir. Use runCommand to list directory contents.');
        },

        exists: async (_sandbox: VercelSandbox, _path: string): Promise<boolean> => {
          throw new Error('Vercel sandbox does not support exists. Use runCommand to check file existence.');
        },

        remove: async (_sandbox: VercelSandbox, _path: string): Promise<void> => {
          throw new Error('Vercel sandbox does not support remove. Use runCommand to delete files.');
        }
      },

      // Provider-specific typed getInstance method
      getInstance: (sandbox: VercelSandbox): VercelSandbox => {
        return sandbox;
      },

    },

    snapshot: {
      create: async (config: VercelConfig, sandboxId: string) => {
        // Resolve credentials with proper precedence (config wins over env)
        const creds = resolveCredentials(config);

        let sandbox: VercelSandbox;

        if (creds.useOidc) {
          // Use OIDC token method
          sandbox = await VercelSandbox.get({ sandboxId });
        } else {
          // Use traditional method
          sandbox = await VercelSandbox.get({
            sandboxId,
            token: creds.token,
            teamId: creds.teamId,
            projectId: creds.projectId,
          });
        }

        return await sandbox.snapshot();
      },

      list: async (_config: VercelConfig) => {
        throw new Error(
          `Vercel provider does not support listing snapshots.`
        );
      },

      delete: async (config: VercelConfig, snapshotId: string) => {
        // Resolve credentials with proper precedence (config wins over env)
        const creds = resolveCredentials(config);

        let snapshot: VercelSnapshot;

        if (creds.useOidc) {
          // Use OIDC token method
          snapshot = await VercelSnapshot.get({ snapshotId });
        } else {
          // Use traditional method
          snapshot = await VercelSnapshot.get({
            snapshotId,
            token: creds.token,
            teamId: creds.teamId,
            projectId: creds.projectId,
          });
        }

        await snapshot.delete();
      }
    }
  }
});
