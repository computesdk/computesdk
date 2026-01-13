/**
 * Railway Infrastructure Provider
 * 
 * Provides infrastructure-only methods for creating/destroying Railway services.
 * Used by the gateway server to provision compute resources with daemon pre-installed.
 */

import { defineInfraProvider } from '@computesdk/provider';
import type { DaemonConfig, CreateSandboxOptions } from '@computesdk/provider';

/**
 * Railway service instance
 */
export interface RailwayInstance {
  serviceId: string;
  projectId: string;
  environmentId: string;
}

/**
 * Railway provider configuration
 */
export interface RailwayConfig {
  /** Railway API key - if not provided, will fallback to RAILWAY_API_KEY environment variable */
  apiKey?: string;
  /** Railway Project ID */
  projectId?: string;
  /** Railway Environment ID - if not provided, will fallback to RAILWAY_ENVIRONMENT_ID environment variable */
  environmentId?: string;
}

/**
 * Get and validate Railway credentials from config and environment
 */
export const getAndValidateCredentials = (config: RailwayConfig) => {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.RAILWAY_API_KEY) || '';
  const projectId = config.projectId || (typeof process !== 'undefined' && process.env?.RAILWAY_PROJECT_ID) || '';
  const environmentId = config.environmentId || (typeof process !== 'undefined' && process.env?.RAILWAY_ENVIRONMENT_ID) || '';

  if (!apiKey) {
    throw new Error(
      'Missing Railway API key. Provide apiKey in config or set RAILWAY_API_KEY environment variable.'
    );
  }

  if (!projectId) {
    throw new Error(
      'Missing Railway Project ID. Provide projectId in config or set RAILWAY_PROJECT_ID environment variable.'
    );
  }

  if (!environmentId) {
    throw new Error(
      'Missing Railway Environment ID. Provide environmentId in config or set RAILWAY_ENVIRONMENT_ID environment variable.'
    );
  }

  return { apiKey, projectId, environmentId };
};

const GRAPHQL_QUERIES = {
  CREATE_SERVICE: `mutation ServiceCreate($input: ServiceCreateInput!) { serviceCreate(input: $input) { id name } }`,
  GET_SERVICE: `query Service($serviceId: String!) { service(id: $serviceId) { id name createdAt } }`,
  LIST_SERVICES: `query Project($projectId: String!) { project(id: $projectId) { services { edges { node { id name createdAt updatedAt } } } } }`,
  DELETE_SERVICE: `mutation ServiceDelete($id: String!) { serviceDelete(id: $id) }`
};

const handleGraphQLErrors = (data: any) => {
  if (data.errors) {
    throw new Error(`Railway GraphQL error: ${data.errors.map((e: any) => e.message).join(', ')}`);
  }
};

export const fetchRailway = async (
  apiKey: string, 
  mutation: any,
) => {
  const response = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(mutation)
  });

  if (!response.ok) {
    throw new Error(`Railway API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  handleGraphQLErrors(data);

  return data.data;
};

/**
 * Convert daemon config to Railway environment variables
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
 * Railway infrastructure provider
 * 
 * Creates Railway services with ComputeSDK daemon pre-installed via Docker image.
 */
export const railway = defineInfraProvider<RailwayInstance, RailwayConfig>({
  name: 'railway',
  
  methods: {
    create: async (config: RailwayConfig, options?: CreateSandboxOptions & { daemonConfig?: DaemonConfig }) => {
      const { apiKey, projectId, environmentId } = getAndValidateCredentials(config);

      try {
        // Build environment variables for daemon
        const envVars = buildDaemonEnvVars(options?.daemonConfig);

        const mutation = {
          query: GRAPHQL_QUERIES.CREATE_SERVICE,
          variables: {
            input: {
              projectId,
              environmentId,
              source: {
                image: 'computesdk/compute:latest'
              },
              ...(Object.keys(envVars).length > 0 && {
                variables: envVars
              })
            }
          }
        };

        const responseData = await fetchRailway(apiKey, mutation);
        const service = responseData?.serviceCreate;
        
        if (!service) {
          throw new Error('No service returned from Railway API - responseData.serviceCreate is undefined');
        }
        
        if (!service.id) {
          throw new Error(`Service ID is undefined. Full service object: ${JSON.stringify(service, null, 2)}`);
        }

        const instance: RailwayInstance = {
          serviceId: service.id,
          projectId,
          environmentId,
        };

        return {
          instance,
          instanceId: service.id
        };
      } catch (error) {
        throw new Error(
          `Failed to create Railway instance: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    getById: async (config: RailwayConfig, instanceId: string) => {
      const { apiKey, projectId, environmentId } = getAndValidateCredentials(config);

      try {
        const mutation = {
          query: GRAPHQL_QUERIES.GET_SERVICE,
          variables: {
            serviceId: instanceId
          }
        };

        const responseData = await fetchRailway(apiKey, mutation);
        
        if (responseData === null) {
          return null;
        }
        
        const service = responseData?.service;
        
        if (!service) {
          throw new Error('Service data is missing from Railway response');
        }

        const instance: RailwayInstance = {
          serviceId: service.id,
          projectId,
          environmentId,
        };

        return {
          instance,
          instanceId: service.id
        };
      } catch (error) {
        throw new Error(
          `Failed to get Railway instance: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    
    list: async (config: RailwayConfig) => {
      const { apiKey, projectId, environmentId } = getAndValidateCredentials(config);

      try {
        const mutation = {
          query: GRAPHQL_QUERIES.LIST_SERVICES,
          variables: {
            projectId
          }
        };

        const responseData = await fetchRailway(apiKey, mutation);
        const services = responseData?.project?.services?.edges || [];
        
        return services.map((edge: any) => {
          const service = edge.node;
          const instance: RailwayInstance = {
            serviceId: service.id,
            projectId,
            environmentId,
          };

          return {
            instance,
            instanceId: service.id
          };
        });
      } catch (error) {
        throw new Error(
          `Failed to list Railway instances: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    destroy: async (config: RailwayConfig, instanceId: string) => {
      const { apiKey } = getAndValidateCredentials(config);

      try {
        const mutation = {
          query: GRAPHQL_QUERIES.DELETE_SERVICE,
          variables: {
            id: instanceId
          }
        };

        const data = await fetchRailway(apiKey, mutation);
        
        if (data.errors) {
          console.warn(`Railway delete warning: ${data.errors.map((e: any) => e.message).join(', ')}`);
        }
      } catch (error) {
        console.warn(`Railway destroy warning: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  },
});
