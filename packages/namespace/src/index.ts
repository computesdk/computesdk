/**
 * Namespace Provider - Factory-based Implementation
 */

import { defineProvider } from '@computesdk/provider';

import type { Runtime, CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from '@computesdk/provider';

/**
 * Namespace sandbox interface
 */
interface NamespaceSandbox {
  instanceId: string;
  name: string;
}

export interface NamespaceConfig {
  /** Namespace API token - if not provided, will fallback to NSC_TOKEN environment variable */
  token?: string;
  /** Virtual CPU cores for the instance */
  virtualCpu?: number;
  /** Memory in megabytes for the instance */
  memoryMegabytes?: number;
  /** Machine architecture (default: amd64) */
  machineArch?: string;
  /** Operating system (default: linux) */
  os?: string;
  /** Documented purpose for the instance */
  documentedPurpose?: string;
  /** Reason for destroying instances (default: "ComputeSDK cleanup") */
  destroyReason?: string;
}

export const getAndValidateCredentials = (config: NamespaceConfig) => {
  const token = config.token || (typeof process !== 'undefined' && process.env?.NSC_TOKEN) || '';

  if (!token) {
    throw new Error(
      'Missing Namespace token. Provide token in config or set NSC_TOKEN environment variable.'
    );
  }

  return { token };
};

const API_ENDPOINTS = {
  CREATE_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/CreateInstance',
  DESCRIBE_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/DescribeInstance',
  LIST_INSTANCES: '/namespace.cloud.compute.v1beta.ComputeService/ListInstances',
  DESTROY_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/DestroyInstance'
};

const handleApiErrors = (response: any) => {
  if (response.error) {
    throw new Error(`Namespace API error: ${response.error}`);
  }
};

export const fetchNamespace = async (
  token: string, 
  endpoint: string,
  options: RequestInit = {}
) => {
  
  const response = await fetch(`https://us.compute.namespaceapis.com${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers
    }
  });

  if (!response.ok) {
    throw new Error(`Namespace API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  // Standard error handling for all operations
  handleApiErrors(data);

  return data;
};

/**
 * Create a Namespace provider instance using the factory pattern
 */
export const namespace = defineProvider<NamespaceSandbox, NamespaceConfig>({
  name: 'namespace',
  methods: {
    sandbox: {
      // Collection operations (compute.sandbox.*)
      create: async (config: NamespaceConfig, options?: CreateSandboxOptions) => {
        const { token } = getAndValidateCredentials(config);

        try {
          // Get image based on runtime
          const getImageRef = (runtime?: Runtime) => {
            return runtime === 'node' ? 'node:alpine' : 'python:alpine';
          };

          const requestBody = {
            shape: {
              virtual_cpu: config.virtualCpu || 2,
              memory_megabytes: config.memoryMegabytes || 4096,
              machine_arch: config.machineArch || 'amd64',
              os: config.os || 'linux'
            },
            containers: [{
              name: 'main-container',
              image_ref: getImageRef(options?.runtime),
              args: ['sleep', '300']
            }],
            documented_purpose: config.documentedPurpose || 'ComputeSDK sandbox'
          };

          const responseData = await fetchNamespace(token, API_ENDPOINTS.CREATE_INSTANCE, {
            method: 'POST',
            body: JSON.stringify(requestBody)
          });
          
          // Extract instance ID from the Namespace API response structure
          if (!responseData.metadata?.instanceId) {
            throw new Error(`Instance ID is undefined. Full response object: ${JSON.stringify(responseData, null, 2)}`);
          }

          const instanceId = responseData.metadata.instanceId;
          const instanceName = `instance-${instanceId}`;

          const namespaceSandbox: NamespaceSandbox = {
            instanceId,
            name: instanceName,
          };

          return {
            sandbox: namespaceSandbox,
            sandboxId: instanceId
          };
        } catch (error) {
          throw new Error(
            `Failed to create Namespace instance: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: NamespaceConfig, sandboxId: string) => {
        const { token } = getAndValidateCredentials(config);

        try {
          const requestBody = {
            instance_id: sandboxId
          };

          const responseData = await fetchNamespace(token, API_ENDPOINTS.DESCRIBE_INSTANCE, {
            method: 'POST',
            body: JSON.stringify(requestBody)
          });
          
          // Extract instance ID from the Namespace API response structure
          if (!responseData.metadata?.instanceId) {
            throw new Error('Instance data is missing from Namespace response');
          }

          const instanceId = responseData.metadata.instanceId;
          const instanceName = `instance-${instanceId}`;

          const namespaceSandbox: NamespaceSandbox = {
            instanceId,
            name: instanceName,
          };

          return {
            sandbox: namespaceSandbox,
            sandboxId: instanceId
          };
        } catch (error) {
          // Handle 404 errors by returning null (instance not found)
          if (error instanceof Error && error.message.includes('404 Not Found')) {
            return null;
          }
          
          throw new Error(
            `Failed to get Namespace instance: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },
      
      list: async (config: NamespaceConfig) => {
        const { token } = getAndValidateCredentials(config);

        try {
          const responseData = await fetchNamespace(token, API_ENDPOINTS.LIST_INSTANCES, {
            method: 'POST',
            body: JSON.stringify({})
          });
          
          // Extract instances from the response
          const instances = responseData?.instances || [];
          
          // Transform each instance into the expected format
          const namespaceSandboxes = instances.map((instanceData: any) => {
            // For list response, instanceId is directly in the instance object, not in metadata
            const instanceId = instanceData.instanceId || instanceData.metadata?.instanceId;
            if (!instanceId) {
              console.warn('Instance missing instanceId:', instanceData);
              return null;
            }
            
            const instanceName = `instance-${instanceId}`;

            const namespaceSandbox: NamespaceSandbox = {
              instanceId,
              name: instanceName,
            };

            return {
              sandbox: namespaceSandbox,
              sandboxId: instanceId
            };
          }).filter(Boolean); // Remove any null entries

          return namespaceSandboxes;
        } catch (error) {
          throw new Error(
            `Failed to list Namespace instances: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: NamespaceConfig, sandboxId: string) => {
        const { token } = getAndValidateCredentials(config);

        try {
          const requestBody = {
            instance_id: sandboxId,
            reason: config.destroyReason || "ComputeSDK cleanup"
          };

          const data = await fetchNamespace(token, API_ENDPOINTS.DESTROY_INSTANCE, {
            method: 'POST',
            body: JSON.stringify(requestBody)
          });
          
          if (data.error) {
            // Log errors but don't throw for destroy operations
            console.warn(`Namespace destroy warning: ${data.error}`);
          }
        } catch (error) {
          // For destroy operations, we typically don't throw if the instance is already gone
          console.warn(`Namespace destroy warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      // Instance operations (minimal stubs - not implemented yet)
      runCode: async (_sandbox: NamespaceSandbox, _code: string, _runtime?: Runtime) => {
        throw new Error('Namespace runCode method not implemented yet');
      },

      runCommand: async (_sandbox: NamespaceSandbox, _command: string, _options?: RunCommandOptions) => {
        throw new Error('Namespace runCommand method not implemented yet');
      },

      getInfo: async (_sandbox: NamespaceSandbox) => {
        throw new Error('Namespace getInfo method not implemented yet');
      },

      getUrl: async (_sandbox: NamespaceSandbox, _options: { port: number; protocol?: string }) => {
        throw new Error('Namespace getUrl method not implemented yet');
      },

    },
  },
});
