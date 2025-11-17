/**
 * Railway Provider - Factory-based Implementation
 * 
 * Railway deployment provider with filesystem support using the factory pattern.
 */

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
 * Railway-specific configuration options
 */
export interface RailwayConfig {
  /** Railway API key - if not provided, will fallback to RAILWAY_API_KEY environment variable */
  apiKey?: string;
  /** Railway project ID */
  projectId?: string;
  /** Railway environment ID */
  environmentId?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

interface RailwaySandbox {
  id: string;
  status: string;
  url: string;
}

/**
 * Wait for Railway deployment to be ready
 */
async function waitForReady(url: string, maxAttempts = 30): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // Continue waiting
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Railway deployment failed to become ready');
}

/**
 * Auto-detect runtime from code content
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
  // Default to Node.js for all other cases
  return 'node';
}

/**
 * Create a Railway provider instance using the factory pattern
 */
export const railway = createProvider<RailwaySandbox, RailwayConfig>({
  name: 'railway',
  methods: {
    sandbox: {
      // Collection operations (map to compute.sandbox.*)
      create: async (config: RailwayConfig, options?: CreateSandboxOptions) => {
        // Validate API key
        const apiKey = config.apiKey || process.env.RAILWAY_API_KEY;
        const projectId = config.projectId || process.env.RAILWAY_PROJECT_ID;
        const environmentId = config.environmentId || process.env.RAILWAY_ENVIRONMENT_ID;

        if (!apiKey) {
          throw new Error(
            'Missing Railway API key. Provide \'apiKey\' in config or set RAILWAY_API_KEY environment variable.'
          );
        }

        if (!projectId) {
          throw new Error(
            'Missing Railway project ID. Provide \'projectId\' in config or set RAILWAY_PROJECT_ID environment variable.'
          );
        }

        try {
          // Create Railway deployment
          const response = await fetch('https://backboard.railway.app/graphql/v2', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              query: `
                mutation DeploymentCreate($input: DeploymentCreateInput!) {
                  deploymentCreate(input: $input) {
                    id
                    staticUrl
                  }
                }
              `,
              variables: {
                input: {
                  projectId,
                  environmentId,
                  variables: {
                    ...options?.envs,
                    RUNTIME: options?.runtime || config.runtime || 'node'
                  }
                }
              }
            })
          });

          if (!response.ok) {
            throw new Error(`Railway API error: ${response.statusText}`);
          }

          const result = await response.json();
          
          if (result.errors) {
            throw new Error(`Railway GraphQL error: ${result.errors[0]?.message}`);
          }

          const deploymentId = result.data.deploymentCreate.id;
          const staticUrl = result.data.deploymentCreate.staticUrl;

          // Wait for deployment to be ready
          await waitForReady(staticUrl);

          const sandbox: RailwaySandbox = {
            id: deploymentId,
            status: 'running',
            url: staticUrl
          };

          return {
            sandbox,
            sandboxId: deploymentId
          };
        } catch (error) {
          throw new Error(
            `Failed to create Railway deployment: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: RailwayConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.RAILWAY_API_KEY!;

        try {
          const response = await fetch('https://backboard.railway.app/graphql/v2', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              query: `
                query GetDeployment($id: String!) {
                  deployment(id: $id) {
                    id
                    staticUrl
                    status
                  }
                }
              `,
              variables: { id: sandboxId }
            })
          });

          const result = await response.json();
          
          if (result.errors || !result.data?.deployment) {
            return null;
          }

          const deployment = result.data.deployment;
          const sandbox: RailwaySandbox = {
            id: deployment.id,
            status: deployment.status.toLowerCase(),
            url: deployment.staticUrl
          };

          return {
            sandbox,
            sandboxId: deployment.id
          };
        } catch (error) {
          return null;
        }
      },

      list: async (config: RailwayConfig) => {
        const apiKey = config.apiKey || process.env.RAILWAY_API_KEY!;
        const projectId = config.projectId || process.env.RAILWAY_PROJECT_ID;

        if (!projectId) {
          return [];
        }

        try {
          const response = await fetch('https://backboard.railway.app/graphql/v2', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              query: `
                query ListDeployments($projectId: String!) {
                  project(id: $projectId) {
                    deployments {
                      edges {
                        node {
                          id
                          staticUrl
                        }
                      }
                    }
                  }
                }
              `,
              variables: { projectId }
            })
          });

          const result = await response.json();
          
          if (result.errors || !result.data?.project?.deployments) {
            return [];
          }

          return result.data.project.deployments.edges.map((edge: any) => {
            const sandbox: RailwaySandbox = {
              id: edge.node.id,
              status: 'running',
              url: edge.node.staticUrl
            };
            return {
              sandbox,
              sandboxId: edge.node.id
            };
          });
        } catch (error) {
          return [];
        }
      },

      destroy: async (config: RailwayConfig, sandboxId: string) => {
        const apiKey = config.apiKey || process.env.RAILWAY_API_KEY!;

        try {
          await fetch('https://backboard.railway.app/graphql/v2', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              query: `
                mutation DeleteDeployment($id: String!) {
                  deploymentDelete(id: $id)
                }
              `,
              variables: { id: sandboxId }
            })
          });
        } catch (error) {
          // Deployment might already be destroyed or doesn't exist
          // This is acceptable for destroy operations
        }
      },

      // Instance operations (map to individual Sandbox methods)
      runCode: async (sandbox: RailwaySandbox, code: string, runtime?: Runtime): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          // Auto-detect runtime if not specified
          const effectiveRuntime = runtime || detectRuntime(code);

          // Use base64 encoding for reliability and consistency
          const encoded = Buffer.from(code).toString('base64');

          let commandResult;
          if (effectiveRuntime === 'python') {
            commandResult = await fetch(`${sandbox.url}/api/execute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                command: 'python3',
                args: ['-c', `import base64; exec(base64.b64decode("${encoded}").decode())`]
              })
            });
          } else {
            commandResult = await fetch(`${sandbox.url}/api/execute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                command: 'node',
                args: ['-e', `eval(Buffer.from("${encoded}", "base64").toString())`]
              })
            });
          }

          const result = await commandResult.json();

          // Check for syntax errors and throw them
          if (result.exitCode !== 0 && result.stderr) {
            if (result.stderr.includes('SyntaxError') ||
                result.stderr.includes('invalid syntax') ||
                result.stderr.includes('Unexpected token') ||
                result.stderr.includes('Unexpected identifier')) {
              throw new Error(`Syntax error: ${result.stderr.trim()}`);
            }
          }

          return {
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            exitCode: result.exitCode || 0,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.id,
            provider: 'railway'
          };
        } catch (error) {
          // Re-throw syntax errors
          if (error instanceof Error && error.message.includes('Syntax error')) {
            throw error;
          }
          throw new Error(
            `Railway execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      runCommand: async (sandbox: RailwaySandbox, command: string, args: string[] = [], options?: RunCommandOptions): Promise<ExecutionResult> => {
        const startTime = Date.now();

        try {
          // Handle background command execution
          const { command: finalCommand, args: finalArgs, isBackground } = createBackgroundCommand(command, args, options);

          const response = await fetch(`${sandbox.url}/api/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: finalCommand,
              args: finalArgs,
              background: isBackground
            })
          });

          const result = await response.json();

          return {
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            exitCode: result.exitCode || 0,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.id,
            provider: 'railway',
            isBackground,
            ...(isBackground && { pid: result.pid || -1 })
          };
        } catch (error) {
          return {
            stdout: '',
            stderr: error instanceof Error ? error.message : String(error),
            exitCode: 127,
            executionTime: Date.now() - startTime,
            sandboxId: sandbox.id,
            provider: 'railway'
          };
        }
      },

      getInfo: async (sandbox: RailwaySandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.id,
          provider: 'railway',
          runtime: 'node',
          status: sandbox.status as any,
          createdAt: new Date(),
          timeout: 3600000,
          metadata: {
            railwayUrl: sandbox.url
          }
        };
      },

      getUrl: async (sandbox: RailwaySandbox, options: { port: number; protocol?: string }): Promise<string> => {
        // Railway deployments typically expose services through their static URL
        const protocol = options.protocol || 'https';
        return `${protocol}://${sandbox.url.replace(/^https?:\/\//, '')}`;
      },

      // Optional filesystem methods
      filesystem: {
        readFile: async (sandbox: RailwaySandbox, path: string): Promise<string> => {
          const response = await fetch(`${sandbox.url}/api/files${path}`);
          if (!response.ok) {
            throw new Error(`Failed to read file: ${response.statusText}`);
          }
          return response.text();
        },

        writeFile: async (sandbox: RailwaySandbox, path: string, content: string): Promise<void> => {
          const response = await fetch(`${sandbox.url}/api/files${path}`, {
            method: 'PUT',
            body: content
          });
          if (!response.ok) {
            throw new Error(`Failed to write file: ${response.statusText}`);
          }
        },

        mkdir: async (sandbox: RailwaySandbox, path: string): Promise<void> => {
          const response = await fetch(`${sandbox.url}/api/files${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'directory' })
          });
          if (!response.ok) {
            throw new Error(`Failed to create directory: ${response.statusText}`);
          }
        },

        readdir: async (sandbox: RailwaySandbox, path: string): Promise<FileEntry[]> => {
          const response = await fetch(`${sandbox.url}/api/files${path}?list=true`);
          if (!response.ok) {
            throw new Error(`Failed to read directory: ${response.statusText}`);
          }
          const data = await response.json();
          return (data.files || []).map((file: any) => ({
            name: file.name,
            path: file.path,
            isDirectory: Boolean(file.isDirectory),
            size: file.size || 0,
            lastModified: new Date(file.lastModified || Date.now())
          }));
        },

        exists: async (sandbox: RailwaySandbox, path: string): Promise<boolean> => {
          try {
            const response = await fetch(`${sandbox.url}/api/files${path}`, { method: 'HEAD' });
            return response.ok;
          } catch {
            return false;
          }
        },

        remove: async (sandbox: RailwaySandbox, path: string): Promise<void> => {
          const response = await fetch(`${sandbox.url}/api/files${path}`, {
            method: 'DELETE'
          });
          if (!response.ok) {
            throw new Error(`Failed to remove file: ${response.statusText}`);
          }
        }
      },

      // Provider-specific typed getInstance method
      getInstance: (sandbox: RailwaySandbox): RailwaySandbox => {
        return sandbox;
      }
    }
  }
});