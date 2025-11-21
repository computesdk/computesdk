/**
 * Railway Provider - Factory-based Implementation
 */

import { createProvider, createBackgroundCommand } from 'computesdk';
import type { Runtime, ExecutionResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from 'computesdk';

/**
 * Railway sandbox interface
 */
interface RailwaySandbox {
  serviceId: string;
  projectId: string;
  environmentId: string;
}

export interface RailwayConfig {
  /** Railway API key - if not provided, will fallback to RAILWAY_API_KEY environment variable */
  apiKey?: string;
  /** Railway Project ID */
  projectId?: string;
  /** Railway Environment ID - if not provided, will fallback to RAILWAY_ENVIRONMENT_ID environment variable */
  environmentId?: string;
}

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

const handleGraphQLErrors = (data: any, operation: string) => {
  if (data.errors) {
    throw new Error(`Railway GraphQL error (${operation}): ${data.errors.map((e: any) => e.message).join(', ')}`);
  }
};

const handleGetByIdErrors = (data: any) => {
  if (data.errors) {
    // Railway returns "Not Authorized" for non-existent services
    const isNotAuthorized = data.errors.some((error: any) => 
      error.message === 'Not Authorized' && error.path && error.path.includes('service')
    );
    if (isNotAuthorized) return null;
    throw new Error(`Railway GraphQL error: ${data.errors.map((e: any) => e.message).join(', ')}`);
  }
  return false;
};



export const fetchRailway = async (
  apiKey: string, 
  mutation: any, 
  operation: string, 
  extractPath?: string
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
  
  // Special handling for getById operations
  if (operation === 'get service') {
    const errorResult = handleGetByIdErrors(data);
    if (errorResult === null) return null;
  } else {
    handleGraphQLErrors(data, operation);
  }

  // Extract the specific data based on the path
  if (extractPath) {
    const pathParts = extractPath.split('.');
    let result = data.data;
    for (const part of pathParts) {
      result = result?.[part];
    }
    return result;
  }

  return data; // For destroy or custom handling
};

/**
 * Create a Railway provider instance using the factory pattern
 */
export const railway = createProvider<RailwaySandbox, RailwayConfig>({
  name: 'railway',
  methods: {
    sandbox: {
      // Collection operations (compute.sandbox.*)
      create: async (config: RailwayConfig, options?: CreateSandboxOptions) => {
        const { apiKey, projectId, environmentId } = getAndValidateCredentials(config);

        try {
          const mutation = {
            query: GRAPHQL_QUERIES.CREATE_SERVICE,
            variables: {
              input: {
                projectId,
                environmentId,
                source: {
                  image: options?.runtime === 'node' ? 'node:alpine' : 'python:alpine'
                }
              }
            }
          };

          const service = await fetchRailway(apiKey, mutation, 'create service', 'serviceCreate');
          const railwaySandbox: RailwaySandbox = {
            serviceId: service.id,
            projectId,
            environmentId,
          };

          return {
            sandbox: railwaySandbox,
            sandboxId: service.id
          };
        } catch (error) {
          throw new Error(
            `Failed to create Railway sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: RailwayConfig, sandboxId: string) => {
        const { apiKey, projectId, environmentId } = getAndValidateCredentials(config);

        try {
          const mutation = {
            query: GRAPHQL_QUERIES.GET_SERVICE,
            variables: {
              serviceId: sandboxId
            }
          };

          const service = await fetchRailway(apiKey, mutation, 'get service', 'service');
          
          // If service doesn't exist, Railway returns null (handled by fetchRailway)
          if (service === null) {
            return null;
          }
          const railwaySandbox: RailwaySandbox = {
            serviceId: service.id,
            projectId,
            environmentId,
          };

          return {
            sandbox: railwaySandbox,
            sandboxId: service.id
          };
        } catch (error) {
          throw new Error(
            `Failed to get Railway sandbox: ${error instanceof Error ? error.message : String(error)}`
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

          const services = await fetchRailway(apiKey, mutation, 'list services', 'project.services.edges') || [];
          
          // Transform each service into the expected format
          const sandboxes = services.map((edge: any) => {
            const service = edge.node;
            const railwaySandbox: RailwaySandbox = {
              serviceId: service.id,
              projectId,
              environmentId,
            };

            return {
              sandbox: railwaySandbox,
              sandboxId: service.id
            };
          });

          return sandboxes;
        } catch (error) {
          throw new Error(
            `Failed to list Railway sandboxes: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: RailwayConfig, sandboxId: string) => {
        const { apiKey } = getAndValidateCredentials(config);

        try {
          const mutation = {
            query: GRAPHQL_QUERIES.DELETE_SERVICE,
            variables: {
              id: sandboxId
            }
          };

          const data = await fetchRailway(apiKey, mutation, 'delete service');
          
          if (data.errors) {
            // Log errors but don't throw for destroy operations
            console.warn(`Railway delete warning: ${data.errors.map((e: any) => e.message).join(', ')}`);
          }
        } catch (error) {
          // For destroy operations, we typically don't throw if the service is already gone
          console.warn(`Railway destroy warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      // Instance operations (minimal stubs - not implemented yet)
      runCode: async (_sandbox: RailwaySandbox, _code: string, _runtime?: Runtime) => {
        throw new Error('Railway runCode method not implemented yet');
      },

      runCommand: async (_sandbox: RailwaySandbox, _command: string, _args?: string[], _options?: RunCommandOptions) => {
        throw new Error('Railway runCommand method not implemented yet');
      },

      getInfo: async (_sandbox: RailwaySandbox) => {
        throw new Error('Railway getInfo method not implemented yet');
      },

      getUrl: async (_sandbox: RailwaySandbox, _options: { port: number; protocol?: string }) => {
        throw new Error('Railway getUrl method not implemented yet');
      },

    },
  },
});
