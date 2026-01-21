/**
 * Namespace Infrastructure Provider
 *
 * Provides infrastructure-only methods for creating/destroying Namespace instances.
 * Used by the gateway server to provision compute resources with daemon pre-installed.
 */

import { defineInfraProvider } from '@computesdk/provider';
import type { DaemonConfig, CreateSandboxOptions } from '@computesdk/provider';

/**
 * Namespace service instance
 */
export interface NamespaceInstance {
  instanceId: string;
  name: string;
}

/**
 * Namespace provider configuration
 */
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

const API_ENDPOINTS = {
  CREATE_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/CreateInstance',
  DESCRIBE_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/DescribeInstance',
  LIST_INSTANCES: '/namespace.cloud.compute.v1beta.ComputeService/ListInstances',
  DESTROY_INSTANCE: '/namespace.cloud.compute.v1beta.ComputeService/DestroyInstance'
};

/**
 * Get and validate Namespace credentials from config and environment
 */
export const getAndValidateCredentials = (config: NamespaceConfig) => {
  const token = config.token || (typeof process !== 'undefined' && process.env?.NSC_TOKEN) || '';

  if (!token) {
    throw new Error(
      'Missing Namespace token. Provide token in config or set NSC_TOKEN environment variable.'
    );
  }

  return { token };
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
 * Convert daemon config to Namespace environment variables
 */
function buildDaemonEnvVars(daemonConfig?: DaemonConfig): Record<string, string> {
  if (!daemonConfig) {
    return {};
  }

  return {
    COMPUTESDK_ACCESS_TOKEN: daemonConfig.accessToken,
    ...(daemonConfig.gatewayUrl && { COMPUTESDK_GATEWAY_URL: daemonConfig.gatewayUrl }),
    ...daemonConfig.env,
  };
}

/**
 * Namespace infrastructure provider
 *
 * Creates Namespace instances with ComputeSDK daemon pre-installed via Docker image.
 */
export const namespace = defineInfraProvider<NamespaceInstance, NamespaceConfig>({
  name: 'namespace',

  methods: {
    create: async (config: NamespaceConfig, options?: CreateSandboxOptions & { daemonConfig?: DaemonConfig }) => {
      const { token } = getAndValidateCredentials(config);

      try {
        // Build environment variables for daemon
        const envVars = buildDaemonEnvVars(options?.daemonConfig);

        const requestBody = {
          shape: {
            virtual_cpu: config.virtualCpu || 2,
            memory_megabytes: config.memoryMegabytes || 4096,
            machine_arch: config.machineArch || 'amd64',
            os: config.os || 'linux'
          },
          containers: [{
            name: 'main-container',
            image_ref: options?.image ?? 'computesdk/compute:latest',
            args: ['sleep', '300'],
            ...(Object.keys(envVars).length > 0 && {
              env: Object.entries(envVars).map(([name, value]) => ({ name, value }))
            })
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

        const instance: NamespaceInstance = {
          instanceId,
          name: instanceName,
        };

        return {
          instance,
          instanceId
        };
      } catch (error) {
        throw new Error(
          `Failed to create Namespace instance: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    getById: async (config: NamespaceConfig, instanceId: string) => {
      const { token } = getAndValidateCredentials(config);

      try {
        const requestBody = {
          instance_id: instanceId
        };

        const responseData = await fetchNamespace(token, API_ENDPOINTS.DESCRIBE_INSTANCE, {
          method: 'POST',
          body: JSON.stringify(requestBody)
        });

        // Extract instance ID from the Namespace API response structure
        if (!responseData.metadata?.instanceId) {
          throw new Error('Instance data is missing from Namespace response');
        }

        const namespaceInstanceId = responseData.metadata.instanceId;
        const instanceName = `instance-${namespaceInstanceId}`;

        const instance: NamespaceInstance = {
          instanceId: namespaceInstanceId,
          name: instanceName,
        };

        return {
          instance,
          instanceId: namespaceInstanceId
        };
      } catch (error) {
        // Handle 404 errors by returning null (instance not found)
        if (error instanceof Error && error.message.includes('404')) {
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
        return instances.map((instanceData: any) => {
          // For list response, instanceId is directly in the instance object, not in metadata
          const namespaceInstanceId = instanceData.instanceId || instanceData.metadata?.instanceId;
          if (!namespaceInstanceId) {
            console.warn('Instance missing instanceId:', instanceData);
            return null;
          }

          const instanceName = `instance-${namespaceInstanceId}`;

          const instance: NamespaceInstance = {
            instanceId: namespaceInstanceId,
            name: instanceName,
          };

          return {
            instance,
            instanceId: namespaceInstanceId
          };
        }).filter(Boolean);
      } catch (error) {
        throw new Error(
          `Failed to list Namespace instances: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    destroy: async (config: NamespaceConfig, instanceId: string) => {
      const { token } = getAndValidateCredentials(config);

      try {
        const requestBody = {
          instance_id: instanceId,
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
        // For destroy operations, we log warnings rather than throwing
        // since the resource may already be gone
        console.warn(`Namespace destroy warning: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  },
});
