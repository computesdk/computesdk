/**
 * Render Provider - Factory-based Implementation
 */

import { createProvider } from 'computesdk';
import type { Runtime, CodeResult, CommandResult, SandboxInfo, CreateSandboxOptions, FileEntry, RunCommandOptions } from 'computesdk';

/**
 * Render sandbox interface
 */
interface RenderSandbox {
  serviceId: string;
  ownerId: string;
}

export interface RenderConfig {
  /** Render API key - if not provided, will fallback to RENDER_API_KEY environment variable */
  apiKey?: string;
  /** Render Owner ID - if not provided, will fallback to RENDER_OWNER_ID environment variable */
  ownerId?: string;
}

export const getAndValidateCredentials = (config: RenderConfig) => {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.RENDER_API_KEY) || '';
  const ownerId = config.ownerId || (typeof process !== 'undefined' && process.env?.RENDER_OWNER_ID) || '';

  if (!apiKey) {
    throw new Error(
      'Missing Render API key. Provide apiKey in config or set RENDER_API_KEY environment variable.'
    );
  }

  if (!ownerId) {
    throw new Error(
      'Missing Render Owner ID. Provide ownerId in config or set RENDER_OWNER_ID environment variable.'
    );
  }

  return { apiKey, ownerId };
};

export const fetchRender = async (
  apiKey: string,
  endpoint: string,
  options: RequestInit = {}
) => {
  const url = `https://api.render.com/v1${endpoint}`;
  const requestOptions = {
    method: 'GET',
    ...options,
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(options.headers || {})
    }
  };
  
  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    throw new Error(`Render API error: ${response.status} ${response.statusText}`);
  }

  // Handle 204 No Content responses (like DELETE operations)
  if (response.status === 204) {
    return {};
  }

  return response.json();
};



/**
 * Create a Render provider instance using the factory pattern
 */
export const render = createProvider<RenderSandbox, RenderConfig>({
  name: 'render',
  methods: {
    sandbox: {
      // Collection operations (compute.sandbox.*)
      create: async (config: RenderConfig, options?: CreateSandboxOptions) => {
        const { apiKey, ownerId } = getAndValidateCredentials(config);

        try {
          const createServiceData = {
            type: 'web_service',
            autoDeploy: 'yes',
            image: {
              ownerId: ownerId,
              imagePath: options?.runtime === 'node' ? 'docker.io/traefik/whoami' : 'docker.io/traefik/whoami'
            },
            serviceDetails: {
              runtime: 'image',
              envSpecificDetails: {
                dockerCommand: options?.runtime === 'node' ? '/whoami --port 10000' : '/whoami --port 10000'
              },
              pullRequestPreviewsEnabled: 'no'
            },
            ownerId: ownerId,
            name: `render-sandbox-${Date.now()}`
          };


          const responseData = await fetchRender(apiKey, '/services', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(createServiceData)
          });
          
          if (!responseData) {
            throw new Error('No service returned from Render API');
          }
          
          // Render API returns { service: { id: "...", ... }, deployId: "..." }
          const service = responseData.service;
          if (!service || !service.id) {
            throw new Error(`Service ID is undefined. Full response: ${JSON.stringify(responseData, null, 2)}`);
          }

          const renderSandbox: RenderSandbox = {
            serviceId: service.id,
            ownerId,
          };

          return {
            sandbox: renderSandbox,
            sandboxId: service.id
          };
        } catch (error) {
          throw new Error(
            `Failed to create Render sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: RenderConfig, sandboxId: string) => {
        const { apiKey, ownerId } = getAndValidateCredentials(config);

        try {
          const responseData = await fetchRender(apiKey, `/services/${sandboxId}`);
          
          // If service doesn't exist, the API will throw an error which we catch
          if (!responseData) {
            return null;
          }
          
          // Service should be defined if we get here
          if (!responseData.id) {
            throw new Error('Service data is missing from Render response');
          }
          
          const renderSandbox: RenderSandbox = {
            serviceId: responseData.id,
            ownerId,
          };

          return {
            sandbox: renderSandbox,
            sandboxId: responseData.id
          };
        } catch (error) {
          // If it's a 404, return null to indicate service not found
          if (error instanceof Error && error.message.includes('404')) {
            return null;
          }
          throw new Error(
            `Failed to get Render sandbox: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },
      
      list: async (config: RenderConfig) => {
        const { apiKey, ownerId } = getAndValidateCredentials(config);

        try {
          const responseData = await fetchRender(apiKey, '/services?includePreviews=true&limit=20');
          
          // Extract services from the array response - each item has a "service" property
          const items = responseData || [];
          
          // Transform each service into the expected format
          const sandboxes = items.map((item: any) => {
            const service = item.service;
            const renderSandbox: RenderSandbox = {
              serviceId: service.id,
              ownerId,
            };

            return {
              sandbox: renderSandbox,
              sandboxId: service.id
            };
          });

          return sandboxes;
        } catch (error) {
          throw new Error(
            `Failed to list Render sandboxes: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: RenderConfig, sandboxId: string) => {
        const { apiKey } = getAndValidateCredentials(config);

        try {
          await fetchRender(apiKey, `/services/${sandboxId}`, {
            method: 'DELETE'
          });
        } catch (error) {
          // For destroy operations, we typically don't throw if the service is already gone
          console.warn(`Render destroy warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      },

      // Instance operations (minimal stubs - not implemented yet)
      runCode: async (_sandbox: RenderSandbox, _code: string, _runtime?: Runtime) => {
        throw new Error('Render runCode method not implemented yet');
      },

      runCommand: async (_sandbox: RenderSandbox, _command: string, _args?: string[], _options?: RunCommandOptions) => {
        throw new Error('Render runCommand method not implemented yet');
      },

      getInfo: async (_sandbox: RenderSandbox) => {
        throw new Error('Render getInfo method not implemented yet');
      },

      getUrl: async (_sandbox: RenderSandbox, _options: { port: number; protocol?: string }) => {
        throw new Error('Render getUrl method not implemented yet');
      },

    },
  },
});
