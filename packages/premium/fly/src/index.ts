/**
 * Fly.io Provider - Factory-based Implementation
 * 
 * Full-featured provider with filesystem support using the factory pattern.
 * Creates and manages Fly machines to simulate sandbox behavior.
 */

import { createProvider } from 'computesdk';
import type {
  ExecutionResult,
  SandboxInfo,
  Runtime,
  CreateSandboxOptions,
  FileEntry
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
   * Execute code in the Fly machine via SSH
   */
  async executeCode(code: string, runtime: Runtime = 'node'): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      // Use base64 encoding for reliable code transmission
      const encoded = Buffer.from(code).toString('base64');
      
      let command: string;
      if (runtime === 'python') {
        command = `echo "${encoded}" | base64 -d | python3`;
      } else {
        command = `echo "${encoded}" | base64 -d | node`;
      }

      const result = await this.executeCommand(command);
      
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
        ...result,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: 'flyio'
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('Syntax error')) {
        throw error;
      }
      throw new Error(
        `Fly.io execution failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Execute a command in the Fly machine
   */
  async executeCommand(command: string, args: string[] = []): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    try {
      const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
      
      const response = await fetch(
        `https://api.machines.dev/v1/apps/${this.appName}/machines/${this.machineId}/exec`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            cmd: ['/bin/sh', '-c', fullCommand],
            timeout: 30000
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Fly API error: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      
      return {
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        exitCode: result.exit_code || 0,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: 'flyio'
      };
    } catch (error) {
      return {
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 127,
        executionTime: Date.now() - startTime,
        sandboxId: this.sandboxId,
        provider: 'flyio'
      };
    }
  }

  /**
   * Get the public URL for a port
   */
  getUrl(port: number, protocol: string = 'https'): string {
    return `${protocol}://${this.appName}.fly.dev:${port}`;
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

  /**
   * File operations using Fly machine exec
   */
  async readFile(path: string): Promise<string> {
    const result = await this.executeCommand(`cat "${path}"`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file: ${result.stderr}`);
    }
    return result.stdout;
  }

  async writeFile(path: string, content: string): Promise<void> {
    // Use base64 encoding to handle special characters
    const encoded = Buffer.from(content).toString('base64');
    const result = await this.executeCommand(`echo "${encoded}" | base64 -d > "${path}"`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to write file: ${result.stderr}`);
    }
  }

  async mkdir(path: string): Promise<void> {
    const result = await this.executeCommand(`mkdir -p "${path}"`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create directory: ${result.stderr}`);
    }
  }

  async readdir(path: string): Promise<FileEntry[]> {
    const result = await this.executeCommand(`ls -la "${path}" --time-style=iso`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to read directory: ${result.stderr}`);
    }

    const lines = result.stdout.split('\n').filter(line => line.trim());
    const entries: FileEntry[] = [];

    for (const line of lines.slice(1)) { // Skip first line (total)
      const parts = line.split(/\s+/);
      if (parts.length >= 9) {
        const permissions = parts[0];
        const size = parseInt(parts[4]) || 0;
        const date = parts[5];
        const time = parts[6];
        const name = parts.slice(8).join(' ');

        if (name !== '.' && name !== '..') {
          entries.push({
            name,
            path: `${path}/${name}`.replace(/\/+/g, '/'),
            isDirectory: permissions.startsWith('d'),
            size,
            lastModified: new Date(`${date}T${time}`)
          });
        }
      }
    }

    return entries;
  }

  async exists(path: string): Promise<boolean> {
    const result = await this.executeCommand(`test -e "${path}"`);
    return result.exitCode === 0;
  }

  async remove(path: string): Promise<void> {
    const result = await this.executeCommand(`rm -rf "${path}"`);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to remove: ${result.stderr}`);
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

        const timeout = config.timeout || 300000;
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
          
          // First create the app
          const appResponse = await fetch('https://api.machines.dev/v1/apps', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              app_name: appName,
              org_slug: config.org
            })
          });

          if (!appResponse.ok) {
            throw new Error(`Failed to create app: ${appResponse.status} ${appResponse.statusText}`);
          }

          // Choose appropriate image based on runtime
          const image = runtime === 'python' 
            ? 'python:3.11-slim' 
            : 'node:18-alpine';

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
          const appsResponse = await fetch('https://api.machines.dev/v1/apps', {
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

      // Instance operations
      runCode: async (sandbox: FlySandbox, code: string, runtime?: Runtime): Promise<ExecutionResult> => {
        // Auto-detect runtime if not specified
        const effectiveRuntime = runtime || (
          code.includes('print(') ||
          code.includes('import ') ||
          code.includes('def ') ||
          code.includes('sys.') ||
          code.includes('json.') ||
          code.includes('__') ||
          code.includes('f"') ||
          code.includes("f'")
            ? 'python'
            : 'node'
        );

        return await sandbox.executeCode(code, effectiveRuntime);
      },

      runCommand: async (sandbox: FlySandbox, command: string, args: string[] = []): Promise<ExecutionResult> => {
        return await sandbox.executeCommand(command, args);
      },

      getInfo: async (sandbox: FlySandbox): Promise<SandboxInfo> => {
        return {
          id: sandbox.sandboxId,
          provider: 'flyio',
          runtime: 'node', // Default, could be enhanced to detect actual runtime
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
        return sandbox.getUrl(options.port, options.protocol);
      },

      // Filesystem methods
      filesystem: {
        readFile: async (sandbox: FlySandbox, path: string): Promise<string> => {
          return await sandbox.readFile(path);
        },

        writeFile: async (sandbox: FlySandbox, path: string, content: string): Promise<void> => {
          await sandbox.writeFile(path, content);
        },

        mkdir: async (sandbox: FlySandbox, path: string): Promise<void> => {
          await sandbox.mkdir(path);
        },

        readdir: async (sandbox: FlySandbox, path: string): Promise<FileEntry[]> => {
          return await sandbox.readdir(path);
        },

        exists: async (sandbox: FlySandbox, path: string): Promise<boolean> => {
          return await sandbox.exists(path);
        },

        remove: async (sandbox: FlySandbox, path: string): Promise<void> => {
          await sandbox.remove(path);
        }
      },

      // Provider-specific getInstance method
      getInstance: (sandbox: FlySandbox): FlySandbox => {
        return sandbox;
      }
    }
  }
});