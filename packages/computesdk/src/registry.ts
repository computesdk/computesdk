/**
 * ComputeSDK Provider Registry
 * 
 * This file implements the provider registry for managing multiple providers.
 */

import { ComputeSandbox, ProviderMap, ProviderRegistry, Runtime } from './types';
import { ConfigurationError } from './errors';

/**
 * Create a provider registry for managing multiple providers
 * 
 * @param providers Map of provider factories
 * @returns Provider registry instance
 */
export function createComputeRegistry(providers: ProviderMap): ProviderRegistry {
  // Validate provider map
  if (!providers || Object.keys(providers).length === 0) {
    throw new ConfigurationError('Provider registry requires at least one provider', 'registry');
  }

  /**
   * Get a sandbox by ID string
   * 
   * Format: "<provider>:<runtime>" or "<provider>:<container-image>"
   * Examples: "e2b:python", "vercel:node", "fly:python:3.9"
   * 
   * @param id Sandbox identifier string
   * @returns Configured sandbox instance
   */
  function sandbox(id: string): ComputeSandbox {
    const parts = id.split(':');

    if (parts.length < 1) {
      throw new ConfigurationError(`Invalid sandbox ID format: ${id}`, 'registry');
    }

    const providerName = parts[0];
    const providerFactory = providers[providerName];

    if (!providerFactory) {
      const availableProviders = Object.keys(providers).join(', ');
      throw new ConfigurationError(
        `Provider '${providerName}' not found in registry. Available providers: ${availableProviders}`,
        'registry'
      );
    }

    // Handle different ID formats
    if (parts.length === 1) {
      // Just provider name, use default configuration
      return providerFactory();
    } else if (parts.length === 2) {
      // Provider with runtime or container image
      const runtimeOrImage = parts[1];

      // Check if it's a runtime
      if (isRuntime(runtimeOrImage)) {
        return providerFactory({ runtime: runtimeOrImage });
      }

      // Otherwise, treat as container image
      return providerFactory({ container: { image: runtimeOrImage } });
    } else {
      // Handle more complex formats (container with tag)
      const containerImage = parts.slice(1).join(':');
      return providerFactory({ container: { image: containerImage } });
    }
  }

  return { sandbox };
}

/**
 * Check if a string is a valid runtime
 * 
 * @param value String to check
 * @returns Whether the string is a valid runtime
 */
function isRuntime(value: string): value is Runtime {
  return ['node', 'python'].includes(value);
}
