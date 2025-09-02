/**
 * Fly.io Provider - Factory-based Implementation
 * 
 */

import { createProvider } from 'computesdk';
import type {
  ExecutionResult,
  SandboxInfo,
  Runtime,
  CreateSandboxOptions
} from 'computesdk';

/**
 * Fly.io-specific configuration options
 */
export interface FlyConfig {
  /** Fly.io API token - if not provided, will fallback to FLY_API_TOKEN environment variable */
  apiToken?: string;
  /** Default runtime environment */
  runtime?: Runtime;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Fly.io organization slug */
  org?: string;
  /** Fly.io app region */
  region?: string;
}

/**
 * Internal Fly machine representation
 */
interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  instance_id: string;
  private_ip: string;
  created_at: string;
  updated_at: string;
  app_name: string;
  image_ref: {
    registry: string;
    repository: string;
    tag: string;
    digest: string;
  };
  config: {
    image: string;
    env: Record<string, string>;
    services: Array<{
      ports: Array<{
        port: number;
        start_port?: number;
        end_port?: number;
        handlers?: string[];
      }>;
      protocol: string;
      internal_port: number;
    }>;
  };
}

/**
 * Fly sandbox instance that wraps a Fly machine
 */
class FlySandbox {
  constructor(
    public readonly machineId: string,
    public readonly appName: string,
    private readonly apiToken: string,
    public readonly region: string = 'ord'
  ) {}

  get sandboxId(): string {
    return `${this.appName}-${this.machineId}`;
  }

  /**
   * Destroy the Fly machine
   */
  async destroy(): Promise<void> {
    try {
      const response = await fetch(
        `https://api.machines.dev/v1/apps/${this.appName}/machines/${this.machineId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`
          }
        }
      );

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to destroy machine: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      // Ignore errors when destroying - machine might already be gone
    }
  }
}




/**
 * Create a Fly.io provider instance using the factory pattern
 */
export const flyio = createProvider<FlySandbox, FlyConfig>({
  name: 'flyio',
  methods: {
    sandbox: {
      // Collection operations
      create: async (config: FlyConfig, options?: CreateSandboxOptions) => {
        const apiToken = config.apiToken || process.env.FLY_API_TOKEN;
        
        if (!apiToken) {
          throw new Error(
            'Missing Fly.io API token. Provide "apiToken" in config or set FLY_API_TOKEN environment variable. Get your token from https://fly.io/user/personal_access_tokens'
          );
        }

        const region = config.region || 'ord';
        const runtime = config.runtime || options?.runtime || 'node';

        try {
          // If reconnecting to existing machine
          if (options?.sandboxId) {
            const [appName, machineId] = options.sandboxId.split('-');
            const sandbox = new FlySandbox(machineId, appName, apiToken, region);
            return { sandbox, sandboxId: options.sandboxId };
          }

          // Create new app and machine
          const appName = `sandbox-${Date.now()}`;
          
          // First create the app - org_slug is required
          const orgSlug = config.org || 'personal';
          const appResponse = await fetch('https://api.machines.dev/v1/apps', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              app_name: appName,
              org_slug: orgSlug
            })
          });

          if (!appResponse.ok) {
            throw new Error(`Failed to create app: ${appResponse.status} ${appResponse.statusText}`);
          }

          // we should JUST use the sidekick image: computesdk/sidekick
          // Choose appropriate image based on runtime
          const image = runtime === 'python' 
            ? 'computesdk/sidekick:latest' 
            : 'computesdk/sidekick:latest';

          // Create the machine
          const machineResponse = await fetch(`https://api.machines.dev/v1/apps/${appName}/machines`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              name: `sandbox-machine`,
              region,
              config: {
                image,
                auto_destroy: true,
                restart: {
                  policy: 'no'
                },
                guest: {
                  cpu_kind: 'shared',
                  cpus: 1,
                  memory_mb: 512
                },
                env: {
                  NODE_ENV: 'sandbox',
                  PYTHON_UNBUFFERED: '1'
                },
                init: {
                  cmd: ['/bin/sh'],
                  tty: true
                }
              }
            })
          });

          if (!machineResponse.ok) {
            throw new Error(`Failed to create machine: ${machineResponse.status} ${machineResponse.statusText}`);
          }

          const machine: FlyMachine = await machineResponse.json();
          
          // Wait for machine to start
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          const sandbox = new FlySandbox(machine.id, appName, apiToken, region);
          return {
            sandbox,
            sandboxId: sandbox.sandboxId
          };

        } catch (error) {
          if (error instanceof Error) {
            if (error.message.includes('unauthorized') || error.message.includes('token')) {
              throw new Error(
                'Fly.io authentication failed. Please check your FLY_API_TOKEN environment variable. Get your token from https://fly.io/user/personal_access_tokens'
              );
            }
          }
          throw new Error(
            `Failed to create Fly.io sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: FlyConfig, sandboxId: string) => {
        const apiToken = config.apiToken || process.env.FLY_API_TOKEN!;
        
        try {
          const [appName, machineId] = sandboxId.split('-');
          
          // Check if machine exists
          const response = await fetch(
            `https://api.machines.dev/v1/apps/${appName}/machines/${machineId}`,
            {
              headers: { 'Authorization': `Bearer ${apiToken}` }
            }
          );

          if (!response.ok) {
            return null;
          }

          const sandbox = new FlySandbox(machineId, appName, apiToken);
          return { sandbox, sandboxId };
        } catch (error) {
          return null;
        }
      },

      list: async (config: FlyConfig) => {
        const apiToken = config.apiToken || process.env.FLY_API_TOKEN!;
        
        try {
          // Get all apps for the organization
          const orgSlug = config.org || 'personal';
          const appsResponse = await fetch(`https://api.machines.dev/v1/apps?org_slug=${orgSlug}`, {
            headers: { 'Authorization': `Bearer ${apiToken}` }
          });

          if (!appsResponse.ok) {
            return [];
          }

          const apps = await appsResponse.json();
          const sandboxes = [];

          // Filter for sandbox apps and get their machines
          for (const app of apps.apps || []) {
            if (app.name.startsWith('sandbox-')) {
              try {
                const machinesResponse = await fetch(`https://api.machines.dev/v1/apps/${app.name}/machines`, {
                  headers: { 'Authorization': `Bearer ${apiToken}` }
                });

                if (machinesResponse.ok) {
                  const machines = await machinesResponse.json();
                  for (const machine of machines) {
                    const sandbox = new FlySandbox(machine.id, app.name, apiToken);
                    sandboxes.push({
                      sandbox,
                      sandboxId: sandbox.sandboxId
                    });
                  }
                }
              } catch (error) {
                // Continue with other apps if one fails
                continue;
              }
            }
          }

          return sandboxes;
        } catch (error) {
          return [];
        }
      },

      destroy: async (config: FlyConfig, sandboxId: string) => {
        const apiToken = config.apiToken || process.env.FLY_API_TOKEN!;
        const [appName, machineId] = sandboxId.split('-');
        
        const sandbox = new FlySandbox(machineId, appName, apiToken);
        await sandbox.destroy();
        
        // Also try to destroy the app
        try {
          await fetch(`https://api.machines.dev/v1/apps/${appName}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${apiToken}` }
          });
        } catch (error) {
          // Ignore errors when destroying app
        }
      },

      // Instance operations - stubs to satisfy TypeScript
      runCode: async (sandbox: FlySandbox, code: string, runtime?: Runtime, config?: FlyConfig): Promise<ExecutionResult> => {
        // Stub implementation
        return {
          stdout: 'Stub: Code execution not implemented',
          stderr: '',
          exitCode: 0,
          executionTime: 100,
          sandboxId: sandbox.sandboxId,
          provider: 'flyio'
        };
      },

      runCommand: async (sandbox: FlySandbox, command: string, args?: string[]): Promise<ExecutionResult> => {
        // Stub implementation
        return {
          stdout: `Stub: Command '${command}' not implemented`,
          stderr: '',
          exitCode: 0,
          executionTime: 50,
          sandboxId: sandbox.sandboxId,
          provider: 'flyio'
        };
      },

      getInfo: async (sandbox: FlySandbox): Promise<SandboxInfo> => {
        // Stub implementation
        return {
          id: sandbox.sandboxId,
          provider: 'flyio',
          runtime: 'node',
          status: 'running',
          createdAt: new Date(),
          timeout: 300000,
          metadata: {
            flyAppName: sandbox.appName,
            flyMachineId: sandbox.machineId,
            region: sandbox.region
          }
        };
      },

      getUrl: async (sandbox: FlySandbox, options: { port: number; protocol?: string }): Promise<string> => {
        // Stub implementation
        const protocol = options.protocol || 'https';
        return `${protocol}://${sandbox.appName}.fly.dev:${options.port}`;
      },
    }
  }
});