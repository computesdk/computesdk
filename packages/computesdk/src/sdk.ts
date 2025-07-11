import type { 
  SandboxConfig, 
  ComputeSandbox, 
  ProviderType,
  Runtime,
  ContainerConfig
} from './types';
import { 
  ConfigurationError, 
  AuthenticationError 
} from './errors';
import { 
  normalizeSandboxConfig, 
  detectAvailableProviders 
} from './config';

export class ComputeSDK {
  /**
   * Create a new sandbox with the specified configuration
   * 
   * @param config Optional sandbox configuration
   * @returns Configured sandbox instance
   */
  static createSandbox(config?: Partial<SandboxConfig>): ComputeSandbox {
    const normalizedConfig = normalizeSandboxConfig(config);
    
    // Try to dynamically load the provider
    const providerName = normalizedConfig.provider;
    
    try {
      // Attempt to load provider package
      const providerPackage = `@computesdk/${providerName}`;
      const provider = require(providerPackage);
      
      // Get the factory function
      const factory = provider[providerName!];
      if (!factory) {
        throw new ConfigurationError(
          `Provider package ${providerPackage} does not export a '${providerName}' function`,
          'sdk'
        );
      }
      
      // Create the sandbox based on provider type
      if (providerName === 'cloudflare') {
        // Cloudflare requires env parameter with Durable Object namespace
        // This would need to be passed in from the Worker context
        throw new ConfigurationError(
          'Cloudflare provider requires env parameter with Sandbox namespace. ' +
          'Use createSandbox({ provider: "cloudflare", env: yourEnv }) from within a Worker.',
          'sdk'
        );
      } else if (providerName === 'fly') {
        if (!normalizedConfig.container) {
          throw new ConfigurationError(
            `${providerName} provider requires container configuration`,
            'sdk'
          );
        }
        return factory({ ...normalizedConfig, container: normalizedConfig.container });
      } else {
        return factory(normalizedConfig);
      }
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }
      
      // Check if it's a missing package error
      if ((error as any).code === 'MODULE_NOT_FOUND') {
        throw new ConfigurationError(
          `Provider '${providerName}' not installed. Run: npm install @computesdk/${providerName}`,
          'sdk'
        );
      }
      
      throw new ConfigurationError(
        `Failed to load provider '${providerName}': ${(error as Error).message}`,
        'sdk'
      );
    }
  }
  
  /**
   * Detect available providers based on environment variables
   * 
   * @returns Array of available provider types
   */
  static detectProviders(): ProviderType[] {
    return detectAvailableProviders();
  }
}