/**
 * Infrastructure Provider Factory
 * 
 * Creates infrastructure-only providers that provision compute resources
 * but don't have native sandbox capabilities. Used by gateway server.
 */

import type { CreateSandboxOptions } from './types/index.js';

/**
 * Infrastructure provider methods - only resource provisioning
 */
export interface InfraProviderMethods<TInstance = any, TConfig = any> {
  /** Create a new compute instance */
  create: (config: TConfig, options?: CreateSandboxOptions & { daemonConfig?: DaemonConfig }) => Promise<{ instance: TInstance; instanceId: string }>;
  
  /** Get an existing instance by ID */
  getById: (config: TConfig, instanceId: string) => Promise<{ instance: TInstance; instanceId: string } | null>;
  
  /** List all instances */
  list: (config: TConfig) => Promise<Array<{ instance: TInstance; instanceId: string }>>;
  
  /** Destroy an instance */
  destroy: (config: TConfig, instanceId: string) => Promise<void>;

  /** 
   * Get the public URL to the daemon running on port 18080 (optional).
   * Used for direct proxy routing in hybrid mode - all traffic is proxied
   * through the daemon which handles port forwarding internally.
   */
  getDaemonUrl?: (config: TConfig, instanceId: string) => Promise<string>;
}

/**
 * Daemon configuration passed to infrastructure providers
 */
export interface DaemonConfig {
  /** Access token for daemon authentication */
  accessToken: string;
  /** Gateway URL for daemon to connect to */
  gatewayUrl?: string;
  /** Additional daemon environment variables */
  env?: Record<string, string>;
}

/**
 * Infrastructure provider configuration
 */
export interface InfraProviderConfig<TInstance = any, TConfig = any> {
  name: string;
  methods: InfraProviderMethods<TInstance, TConfig>;
}

/**
 * Infrastructure provider interface returned by defineInfraProvider
 */
export interface InfraProvider<TInstance = any> {
  name: string;
  create: (options?: CreateSandboxOptions & { daemonConfig?: DaemonConfig }) => Promise<{ instance: TInstance; instanceId: string }>;
  getById: (instanceId: string) => Promise<{ instance: TInstance; instanceId: string } | null>;
  list: () => Promise<Array<{ instance: TInstance; instanceId: string }>>;
  destroy: (instanceId: string) => Promise<void>;
  /** 
   * Get the public URL to the daemon running on port 18080 (optional).
   * Returns undefined if the provider doesn't support direct URL access.
   * Used for hybrid proxy mode - traffic is routed directly to the daemon
   * which handles internal port forwarding via X-Forward-To-Port header.
   */
  getDaemonUrl?: (instanceId: string) => Promise<string>;
}

/**
 * Create an infrastructure provider from method definitions
 * 
 * Infrastructure providers only handle resource provisioning.
 * The gateway server uses these to create VMs/containers with the ComputeSDK daemon pre-installed.
 * 
 * @example
 * ```typescript
 * export const railway = defineInfraProvider<RailwayInstance, RailwayConfig>({
 *   name: 'railway',
 *   methods: {
 *     create: async (config, options) => {
 *       // Create Railway service with daemon docker image
 *       const service = await railwayAPI.createService({
 *         ...config,
 *         image: 'computesdk/daemon:latest',
 *         env: options?.daemonConfig ? {
 *           COMPUTESDK_ACCESS_TOKEN: options.daemonConfig.accessToken,
 *           COMPUTESDK_GATEWAY_URL: options.daemonConfig.gatewayUrl,
 *         } : {}
 *       });
 *       return { instance: service, instanceId: service.id };
 *     },
 *     destroy: async (config, instanceId) => {
 *       await railwayAPI.deleteService(config, instanceId);
 *     },
 *     getById: async (config, instanceId) => {
 *       const service = await railwayAPI.getService(config, instanceId);
 *       return service ? { instance: service, instanceId: service.id } : null;
 *     },
 *     list: async (config) => {
 *       const services = await railwayAPI.listServices(config);
 *       return services.map(s => ({ instance: s, instanceId: s.id }));
 *     }
 *   }
 * });
 * 
 * // Gateway server usage:
 * const provider = railway({ apiKey, projectId, environmentId });
 * const { instance, instanceId } = await provider.create({
 *   daemonConfig: { accessToken: 'token_xxx' }
 * });
 * ```
 */
export function defineInfraProvider<TInstance, TConfig = any>(
  config: InfraProviderConfig<TInstance, TConfig>
): (providerConfig: TConfig) => InfraProvider<TInstance> {
  return (providerConfig: TConfig) => {
    const provider: InfraProvider<TInstance> = {
      name: config.name,
      
      create: async (options) => {
        return await config.methods.create(providerConfig, options);
      },
      
      getById: async (instanceId) => {
        return await config.methods.getById(providerConfig, instanceId);
      },
      
      list: async () => {
        return await config.methods.list(providerConfig);
      },
      
      destroy: async (instanceId) => {
        await config.methods.destroy(providerConfig, instanceId);
      }
    };

    // Add getDaemonUrl if the provider implements it
    if (config.methods.getDaemonUrl) {
      provider.getDaemonUrl = async (instanceId) => {
        return await config.methods.getDaemonUrl!(providerConfig, instanceId);
      };
    }

    return provider;
  };
}
