/**
 * AVM Provider - Factory-based Implementation
 * 
 * AVM Sandbox Platform API integration for ComputeSDK
 * API Documentation: https://api.avm.codes/
 */

import { createProvider } from 'computesdk';
import type { Runtime, ExecutionResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from 'computesdk';

/**
 * AVM sandbox interface matching the API response structure
 */
interface AVMSandbox {
  id: string;
  name: string;
  created_at: string;
  cpu: number;
  memory: number;
  status: string;
  volumes?: Array<{
    volume_id: string;
    mount_path: string;
    volume_name: string;
  }>;
}

/**
 * AVM-specific configuration options
 */
export interface AVMConfig {
  /** AVM API key - if not provided, will fallback to AVM_API_KEY environment variable */
  apiKey?: string;
}

/**
 * Extended create options for AVM sandboxes
 */
export interface AVMCreateOptions extends CreateSandboxOptions {
  /** Custom Docker image (defaults to node:alpine) */
  image?: string;
  /** Sandbox name (defaults to avm-sandbox-{timestamp}) */
  name?: string;
  /** Resource allocation */
  resources?: {
    cpus?: number;    // default: 0.25
    memory?: number;  // default: 512 (MB)
  };
  /** Volume configuration */
  volumes?: Array<{
    volume_name: string;
    mount_path: string;
  }>;
}

/**
 * Validate and retrieve AVM API credentials
 */
export const getAndValidateCredentials = (config: AVMConfig) => {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.AVM_API_KEY) || '';

  if (!apiKey) {
    throw new Error(
      'Missing AVM API key. Provide apiKey in config or set AVM_API_KEY environment variable.'
    );
  }

  return { apiKey };
};

/**
 * Fetch helper for AVM API calls
 */
export const fetchAVM = async (
  apiKey: string,
  endpoint: string,
  options: RequestInit = {}
) => {
  const url = `https://api.avm.codes/v1${endpoint}`;
  const requestOptions: RequestInit = {
    method: 'GET',
    ...options,
    headers: {
      'Accept': 'application/json',
      'x-api-key': apiKey,
      ...(options.headers || {})
    }
  };
  
  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    throw new Error(`AVM API error: ${response.status} ${response.statusText}`);
  }

  // Handle 204 No Content responses (like DELETE operations)
  if (response.status === 204) {
    return {};
  }

  return response.json();
};

/**
 * Create an AVM provider instance using the factory pattern
 */
export const avm = createProvider<AVMSandbox, AVMConfig>({
  name: 'avm',
  methods: {
    sandbox: {
      // Collection operations (compute.sandbox.*)
      create: async (config: AVMConfig, options?: AVMCreateOptions) => {
        const { apiKey } = getAndValidateCredentials(config);

        try {
          const createSandboxData = {
            name: options?.name || `computesdk-${Date.now()}`,
            image: options?.image || 'node:alpine',
            resources: {
              cpus: options?.resources?.cpus || 0.25,
              memory: options?.resources?.memory || 512
            },
            ...(options?.volumes && { volumes: options.volumes })
          };

          const responseData = await fetchAVM(apiKey, '/sandboxes/create', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(createSandboxData)
          });
          
          if (!responseData || !responseData.id) {
            throw new Error(`Sandbox ID is undefined. Full response: ${JSON.stringify(responseData, null, 2)}`);
          }

          const avmSandbox: AVMSandbox = {
            id: responseData.id,
            name: responseData.name,
            created_at: responseData.created_at,
            cpu: responseData.cpu,
            memory: responseData.memory,
            status: responseData.status,
            volumes: responseData.volumes
          };

          return {
            sandbox: avmSandbox,
            sandboxId: responseData.id
          };
        } catch (error) {
          throw new Error(
            `Failed to create AVM sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: AVMConfig, sandboxId: string) => {
        const { apiKey } = getAndValidateCredentials(config);

        try {
          // AVM's getById fetches logs for the sandbox
          const responseData = await fetchAVM(apiKey, `/sandboxes/${sandboxId}/logs`);
          
          if (!responseData) {
            return null;
          }
          
          // Return the logs data wrapped in the expected format
          // Note: This returns logs, not sandbox metadata
          return {
            sandbox: responseData as any,
            sandboxId: sandboxId
          };
        } catch (error) {
          // If it's a 404, return null to indicate sandbox not found
          if (error instanceof Error && error.message.includes('404')) {
            return null;
          }
          throw new Error(
            `Failed to get AVM sandbox logs: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },
      
      list: async (config: AVMConfig) => {
        const { apiKey } = getAndValidateCredentials(config);

        try {
          const responseData = await fetchAVM(apiKey, '/sandboxes/list');
          
          // Extract sandboxes from the data array
          const items = responseData?.data || [];
          
          // Transform each sandbox into the expected format
          const sandboxes = items.map((sandbox: any) => {
            const avmSandbox: AVMSandbox = {
              id: sandbox.id,
              name: sandbox.name,
              created_at: sandbox.created_at,
              cpu: sandbox.cpu,
              memory: sandbox.memory,
              status: sandbox.status,
              volumes: sandbox.volumes
            };

            return {
              sandbox: avmSandbox,
              sandboxId: sandbox.id
            };
          });

          return sandboxes;
        } catch (error) {
          throw new Error(
            `Failed to list AVM sandboxes: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: AVMConfig, sandboxId: string) => {
        const { apiKey } = getAndValidateCredentials(config);

        try {
          await fetchAVM(apiKey, `/sandboxes/${sandboxId}/delete`, {
            method: 'DELETE'
          });
        } catch (error) {
          // For destroy operations, we typically don't throw if the sandbox is already gone
          console.warn(`AVM destroy warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      // Instance operations (minimal stubs - not implemented yet)
      runCode: async (_sandbox: AVMSandbox, _code: string, _runtime?: Runtime) => {
        throw new Error('AVM runCode method not implemented yet');
      },

      runCommand: async (_sandbox: AVMSandbox, _command: string, _args?: string[], _options?: RunCommandOptions) => {
        throw new Error('AVM runCommand method not implemented yet');
      },

      getInfo: async (_sandbox: AVMSandbox) => {
        throw new Error('AVM getInfo method not implemented yet');
      },

      getUrl: async (_sandbox: AVMSandbox, _options: { port: number; protocol?: string }) => {
        throw new Error('AVM getUrl method not implemented yet');
      },

    },
  },
});
