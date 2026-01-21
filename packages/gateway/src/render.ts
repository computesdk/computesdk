/**
 * Render Infrastructure Provider
 *
 * Provides infrastructure-only methods for creating/destroying Render services.
 * Used by the gateway server to provision compute resources with daemon pre-installed.
 */

import { defineInfraProvider } from '@computesdk/provider';
import type { DaemonConfig, CreateSandboxOptions } from '@computesdk/provider';

/**
 * Render service instance
 */
export interface RenderInstance {
  serviceId: string;
  ownerId: string;
}

/**
 * Render provider configuration
 */
export interface RenderConfig {
  /** Render API key - if not provided, will fallback to RENDER_API_KEY environment variable */
  apiKey?: string;
  /** Render Owner ID - if not provided, will fallback to RENDER_OWNER_ID environment variable */
  ownerId?: string;
}

/**
 * Get and validate Render credentials from config and environment
 */
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
 * Convert daemon config to Render environment variables
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
 * Render infrastructure provider
 *
 * Creates Render services with ComputeSDK daemon pre-installed via Docker image.
 */
export const render = defineInfraProvider<RenderInstance, RenderConfig>({
  name: 'render',

  methods: {
    create: async (config: RenderConfig, options?: CreateSandboxOptions & { daemonConfig?: DaemonConfig }) => {
      const { apiKey, ownerId } = getAndValidateCredentials(config);

      try {
        // Step 1: Create the service without env vars (autoDeploy: 'no' to prevent premature deploy)
        const createServiceData = {
          type: 'web_service',
          autoDeploy: 'no',
          image: {
            ownerId: ownerId,
            imagePath: options?.image ?? 'computesdk/compute:latest'
          },
          serviceDetails: {
            runtime: 'image',
            pullRequestPreviewsEnabled: 'no'
          },
          ownerId: ownerId,
          name: `computesdk-${Date.now()}`
        };

        const responseData = await fetchRender(apiKey, '/services', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(createServiceData)
        });

        if (!responseData) {
          throw new Error('No service returned from Render API - responseData is undefined');
        }

        // Render API returns { service: { id: "...", ... }, deployId: "..." }
        const service = responseData.service;
        if (!service) {
          throw new Error('No service returned from Render API - responseData.service is undefined');
        }

        if (!service.id) {
          throw new Error(`Service ID is undefined. Full service object: ${JSON.stringify(service, null, 2)}`);
        }

        const serviceId = service.id;

        // Step 2: Add environment variables via PUT to /services/{serviceId}/env-vars
        const envVars = buildDaemonEnvVars(options?.daemonConfig);
        const envVarsList = Object.entries(envVars).map(([key, value]) => ({
          key,
          value
        }));

        if (envVarsList.length > 0) {
          await fetchRender(apiKey, `/services/${serviceId}/env-vars`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(envVarsList)
          });
        }

        // Step 3: Trigger deploy to start the service with env vars
        await fetchRender(apiKey, `/services/${serviceId}/deploys`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({})
        });

        const instance: RenderInstance = {
          serviceId,
          ownerId,
        };

        return {
          instance,
          instanceId: serviceId
        };
      } catch (error) {
        throw new Error(
          `Failed to create Render instance: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    getById: async (config: RenderConfig, instanceId: string) => {
      const { apiKey, ownerId } = getAndValidateCredentials(config);

      try {
        const responseData = await fetchRender(apiKey, `/services/${instanceId}`);

        if (!responseData.id) {
          throw new Error('Service data is missing from Render response');
        }

        const instance: RenderInstance = {
          serviceId: responseData.id,
          ownerId,
        };

        return {
          instance,
          instanceId: responseData.id
        };
      } catch (error) {
        // If it's a 404, return null to indicate service not found
        if (error instanceof Error && error.message.includes('404')) {
          return null;
        }
        throw new Error(
          `Failed to get Render instance: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    list: async (config: RenderConfig) => {
      const { apiKey, ownerId } = getAndValidateCredentials(config);

      try {
        const responseData = await fetchRender(apiKey, '/services?includePreviews=true');

        // Extract services from the array response - each item has a "service" property
        const items = responseData || [];

        return items.map((item: any) => {
          const service = item.service;
          const instance: RenderInstance = {
            serviceId: service.id,
            ownerId,
          };

          return {
            instance,
            instanceId: service.id
          };
        });
      } catch (error) {
        throw new Error(
          `Failed to list Render instances: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },

    destroy: async (config: RenderConfig, instanceId: string) => {
      const { apiKey } = getAndValidateCredentials(config);

      try {
        await fetchRender(apiKey, `/services/${instanceId}`, {
          method: 'DELETE'
        });
      } catch (error) {
        // For destroy operations, we log warnings rather than throwing
        // since the resource may already be gone
        console.warn(`Render destroy warning: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  },
});
