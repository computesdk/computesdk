/**
 * Fly.io Provider - Factory-based Implementation
 * FLY_API_TOKEN=
 * FLY_API_HOSTNAME="https://api.machines.dev"
APP_NAME="computesdk"
ORG="computesdk"
 */

import { createProvider } from 'computesdk';
import type { Runtime, CreateSandboxOptions, RunCommandOptions } from 'computesdk';

/**
 * Fly.io sandbox interface
 */
interface FlyMachine {
  machineId: string;
  appName: string;
  region: string;
  privateIp?: string;
}

export interface FlyConfig {
  /** Fly.io API token - if not provided, will fallback to FLY_API_TOKEN environment variable */
  apiToken?: string;
  /** Fly.io organization slug - defaults to 'personal' */
  org?: string;
  /** Fly.io region - defaults to 'iad' */
  region?: string;
  /** Base API hostname - defaults to public endpoint */
  apiHostname?: string;
  /** App name - if not provided, defaults to 'computesdk' */
  appName?: string;
}

export const getAndValidateCredentials = (config: FlyConfig) => {
  const apiToken = config.apiToken || (typeof process !== 'undefined' && process.env?.FLY_API_TOKEN) || '';
  const org = config.org || (typeof process !== 'undefined' && process.env?.FLY_ORG) || 'personal';
  const region = config.region || (typeof process !== 'undefined' && process.env?.FLY_REGION) || 'iad';
  const apiHostname = config.apiHostname || 'https://api.machines.dev';
  const appName = config.appName || 'computesdk';

  if (!apiToken) {
    throw new Error(
      'Missing Fly.io API token. Provide apiToken in config or set FLY_API_TOKEN environment variable.'
    );
  }

  return { apiToken, org, region, apiHostname, appName };
};

const RUNTIME_IMAGES: Record<string, string> = {
  node: 'node:alpine',
  python: 'python:alpine',
  default: 'docker.io/traefik/whoami'
};

/**
 * Fetch from Fly.io Machines REST API
 */
export const fetchMachinesApi = async (
  apiToken: string,
  apiHostname: string,
  endpoint: string,
  options: RequestInit = {}
) => {
  const response = await fetch(`${apiHostname}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiToken}`,
      ...options.headers
    }
  });

  // Handle DELETE which may return empty body
  if (response.status === 200 && options.method === 'DELETE') {
    return { ok: true };
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Fly.io API error: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : {};
};

/**
 * Ensure the app exists, create it if it doesn't
 */
const ensureAppExists = async (
  apiToken: string,
  apiHostname: string,
  appName: string,
  org: string
): Promise<void> => {
  try {
    // Check if app exists
    await fetchMachinesApi(apiToken, apiHostname, `/v1/apps/${appName}`, {
      method: 'GET'
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      // App doesn't exist, create it
      await fetchMachinesApi(apiToken, apiHostname, '/v1/apps', {
        method: 'POST',
        body: JSON.stringify({
          app_name: appName,
          org_slug: org
        })
      });
    } else {
      throw error; // Re-throw other errors
    }
  }
};

/**
 * Wait for a machine to reach a specific state
 */
const waitForMachineState = async (
  apiToken: string,
  apiHostname: string,
  appName: string,
  machineId: string,
  targetState: string,
  maxWaitMs: number = 30000
): Promise<void> => {
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const machine = await fetchMachinesApi(apiToken, apiHostname, `/v1/apps/${appName}/machines/${machineId}`);
      if (machine.state === targetState) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    } catch {
      // If machine not found, consider it stopped/deleted
      return;
    }
  }
  throw new Error(`Machine ${machineId} did not reach state ${targetState} within ${maxWaitMs}ms`);
};

/**
 * Create a Fly.io provider instance using the factory pattern
 */
export const fly = createProvider<FlyMachine, FlyConfig>({
  name: 'fly',
  methods: {
    sandbox: {
      create: async (config: FlyConfig, options?: CreateSandboxOptions) => {
        const { apiToken, org, region, apiHostname, appName } = getAndValidateCredentials(config);

        try {
          // 1. Ensure the app exists (create if needed)
          await ensureAppExists(apiToken, apiHostname, appName, org);

          // 2. Determine the image based on runtime
          const image = options?.runtime 
            ? (RUNTIME_IMAGES[options.runtime] || RUNTIME_IMAGES.default)
            : RUNTIME_IMAGES.default;

          // 3. Create the machine (no app creation here)
          const machineConfig: any = {
            name: `machine-${Date.now()}`, // Unique machine name
            region,
            config: {
              image,
              guest: {
                cpu_kind: 'shared',
                cpus: 1,
                memory_mb: 256
              }
            }
          };

          // Add init command for node/python to keep container running
          if (options?.runtime === 'node') {
            machineConfig.config.init = {
              cmd: ['node', '-e', 'require("http").createServer((req,res)=>{res.end("ok")}).listen(80)']
            };
          } else if (options?.runtime === 'python') {
            machineConfig.config.init = {
              cmd: ['python', '-c', 'import http.server;http.server.HTTPServer(("",80),http.server.SimpleHTTPRequestHandler).serve_forever()']
            };
          }

          const machine = await fetchMachinesApi(apiToken, apiHostname, `/v1/apps/${appName}/machines`, {
            method: 'POST',
            body: JSON.stringify(machineConfig)
          });

          const flyMachine: FlyMachine = {
            machineId: machine.id,
            appName,
            region: machine.region,
            privateIp: machine.private_ip
          };

          return {
            sandbox: flyMachine,
            sandboxId: `${appName}:${machine.id}`
          };
        } catch (error) {
          throw new Error(
            `Failed to create Fly.io machine: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: FlyConfig, sandboxId: string) => {
        const { apiToken, apiHostname } = getAndValidateCredentials(config);
        const [appName, machineId] = sandboxId.split(':');

        if (!appName || !machineId) {
          throw new Error('Invalid sandboxId format. Expected "appName:machineId"');
        }

        try {
          const machine = await fetchMachinesApi(apiToken, apiHostname, `/v1/apps/${appName}/machines/${machineId}`, {
            method: 'GET'
          });

          const flyMachine: FlyMachine = {
            machineId: machine.id,
            appName,
            region: machine.region,
            privateIp: machine.private_ip
          };

          return {
            sandbox: flyMachine,
            sandboxId
          };
        } catch (error) {
          if (error instanceof Error && error.message.includes('404')) {
            return null;
          }
          throw new Error(
            `Failed to get Fly.io sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      list: async (config: FlyConfig) => {
        const { apiToken, apiHostname, appName } = getAndValidateCredentials(config);

        try {
          // Get machines for the specific app only
          const machines = await fetchMachinesApi(
            apiToken,
            apiHostname,
            `/v1/apps/${appName}/machines`,
            { method: 'GET' }
          );

          const machineList = Array.isArray(machines) ? machines : [];
          
          return machineList.map(machine => ({
            sandbox: {
              machineId: machine.id,
              appName,
              region: machine.region,
              privateIp: machine.private_ip
            },
            sandboxId: `${appName}:${machine.id}`
          }));
        } catch (error) {
          throw new Error(
            `Failed to list Fly.io machines: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: FlyConfig, sandboxId: string) => {
        const { apiToken, apiHostname } = getAndValidateCredentials(config);
        const [appName, machineId] = sandboxId.split(':');

        if (!machineId) {
          console.warn('Invalid sandboxId format for destroy');
          return;
        }

        try {
          // 1. Check current machine state
          let machine;
          try {
            machine = await fetchMachinesApi(apiToken, apiHostname, `/v1/apps/${appName}/machines/${machineId}`);
          } catch (error) {
            if (error instanceof Error && error.message.includes('404')) {
              // Machine already deleted
              return;
            }
            throw error;
          }

          const currentState = machine.state;
          
          // 2. Handle based on current state
          if (currentState === 'created') {
            // Machine is in created state, try to start it first, then stop it
            try {
              await fetchMachinesApi(apiToken, apiHostname, `/v1/apps/${appName}/machines/${machineId}/start`, {
                method: 'POST'
              });
              // Wait a moment for it to start
              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch {
              // If start fails, machine might be in a weird state, try deletion anyway
            }
          }
          
          if (currentState !== 'stopped' && currentState !== 'failed' && currentState !== 'destroyed') {

            try {
              await fetchMachinesApi(apiToken, apiHostname, `/v1/apps/${appName}/machines/${machineId}/stop`, {
                method: 'POST',
                body: JSON.stringify({ signal: 'SIGTERM' })
              });

              // Give it 5 seconds to stop gracefully before checking state
              await new Promise(resolve => setTimeout(resolve, 5000));
              
              // Wait for machine to actually stop
              await waitForMachineState(apiToken, apiHostname, appName, machineId, 'stopped', 15000);
            } catch (stopError) {
              // Try force stop if graceful stop failed
              try {
                await fetchMachinesApi(apiToken, apiHostname, `/v1/apps/${appName}/machines/${machineId}/stop`, {
                  method: 'POST',
                  body: JSON.stringify({ signal: 'SIGKILL' })
                });
                
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                await waitForMachineState(apiToken, apiHostname, appName, machineId, 'stopped', 10000);

              } catch {
              }
            }
          }

          // 5. Delete the machine, with force if necessary
          try {
            await fetchMachinesApi(apiToken, apiHostname, `/v1/apps/${appName}/machines/${machineId}`, {
              method: 'DELETE'
            });
          } catch (deleteError) {
            if (deleteError instanceof Error && deleteError.message.includes('412')) {
              // Try force delete if normal delete fails with precondition
              await fetchMachinesApi(apiToken, apiHostname, `/v1/apps/${appName}/machines/${machineId}?force=true`, {
                method: 'DELETE'
              });
            } else {
              throw deleteError;
            }
          }
        } catch (error) {
          console.warn(`Fly.io destroy warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      runCode: async (_sandbox: FlyMachine, _code: string, _runtime?: Runtime) => {
        throw new Error('Fly.io runCode method not implemented yet');
      },

      runCommand: async (_sandbox: FlyMachine, _command: string, _args?: string[], _options?: RunCommandOptions) => {
        throw new Error('Fly.io runCommand method not implemented yet');
      },

      getInfo: async (sandbox: FlyMachine) => {
        throw new Error('Fly.io getInfo method not implemented yet');
      },

      getUrl: async (sandbox: FlyMachine, options: { port: number; protocol?: string }) => {
        throw new Error('Fly.io getUrl method not implemented yet');
      },
    },
  },
});