/**
 * ComputeSDK Configuration Management
 * 
 * This file manages configuration and provider selection logic.
 */

import { SandboxConfig, ProviderType, Runtime, ContainerConfig } from './types';
import { ConfigurationError } from './errors';

// Global type declarations for platform detection
declare global {
  var DurableObject: any;
  var WebSocketPair: any;
}

// Default configuration values
export const DEFAULT_TIMEOUT = 300000; // 5 minutes in milliseconds

/**
 * Environment variable names for provider API keys
 */
export const ENV_KEYS = {
  E2B: 'E2B_API_KEY',
  VERCEL: 'VERCEL_TOKEN',
  CLOUDFLARE: 'CLOUDFLARE_API_TOKEN',
  FLY: 'FLY_API_TOKEN',
};

/**
 * Detect if running in Cloudflare Workers environment
 * 
 * @returns True if running in Cloudflare Workers
 */
export function isCloudflareWorkers(): boolean {
  return typeof DurableObject !== 'undefined' && 
         typeof WebSocketPair !== 'undefined' &&
         typeof caches !== 'undefined';
}

/**
 * Detect available providers based on environment variables
 * 
 * @returns Array of available provider types
 */
export function detectAvailableProviders(): ProviderType[] {
  const available: ProviderType[] = [];

  if (process.env[ENV_KEYS.E2B]) {
    available.push('e2b');
  }

  if (process.env[ENV_KEYS.VERCEL]) {
    available.push('vercel');
  }

  // Cloudflare can be detected by environment OR API key
  if (isCloudflareWorkers() || process.env[ENV_KEYS.CLOUDFLARE]) {
    available.push('cloudflare');
  }

  if (process.env[ENV_KEYS.FLY]) {
    available.push('fly');
  }

  return available;
}

/**
 * Auto-select the best provider based on available API keys
 * 
 * @returns Selected provider type or undefined if none available
 */
export function autoSelectProvider(): ProviderType | undefined {
  const available = detectAvailableProviders();
  return available.length > 0 ? available[0] : undefined;
}

/**
 * Validate and normalize container configuration
 * 
 * @param container Container configuration or image string
 * @returns Normalized container configuration
 */
export function normalizeContainerConfig(container: string | ContainerConfig | undefined): ContainerConfig | undefined {
  if (!container) {
    return undefined;
  }

  if (typeof container === 'string') {
    return { image: container };
  }

  if (!container.image) {
    throw new ConfigurationError('Container configuration must include an image', 'config');
  }

  return container;
}

/**
 * Get the appropriate runtime based on provider and configuration
 * 
 * @param provider Provider type
 * @param runtime Optional runtime preference
 * @returns Selected runtime
 */
export function getDefaultRuntime(provider: ProviderType, runtime?: Runtime): Runtime {
  if (runtime) {
    return runtime;
  }

  // Provider-specific defaults
  switch (provider) {
    case 'e2b':
      return 'python';
    case 'vercel':
      return 'node';
    case 'cloudflare':
    case 'fly':
      throw new ConfigurationError(
        `Container-based provider '${provider}' requires explicit runtime or container configuration`,
        provider
      );
    default:
      return 'node';
  }
}

/**
 * Validate API key for selected provider
 * 
 * @param provider Provider type
 * @throws AuthenticationError if API key is missing
 */
export function validateProviderApiKey(provider: ProviderType): void {
  let envKey: string;

  switch (provider) {
    case 'e2b':
      envKey = ENV_KEYS.E2B;
      break;
    case 'vercel':
      envKey = ENV_KEYS.VERCEL;
      break;
    case 'cloudflare':
      // Cloudflare can work without API key if in Workers environment
      if (isCloudflareWorkers()) {
        return;
      }
      envKey = ENV_KEYS.CLOUDFLARE;
      break;
    case 'fly':
      envKey = ENV_KEYS.FLY;
      break;
    case 'auto':
      return; // Will be handled by auto-selection
    default:
      throw new ConfigurationError(`Unknown provider: ${provider}`, 'config');
  }

  if (!process.env[envKey]) {
    const available = detectAvailableProviders();
    const suggestions = available.length > 0
      ? `Available providers: ${available.join(', ')}`
      : `No provider API keys found. Set ${Object.values(ENV_KEYS).join(' or ')} environment variables.`;

    throw new ConfigurationError(
      `Missing API key for provider '${provider}'. ${suggestions}`,
      provider
    );
  }
}

/**
 * Normalize and validate sandbox configuration
 * 
 * @param config User-provided configuration
 * @returns Normalized configuration with defaults applied
 */
export function normalizeSandboxConfig(config?: Partial<SandboxConfig>): SandboxConfig {
  const normalized: SandboxConfig = {
    provider: config?.provider || 'auto',
    timeout: config?.timeout || DEFAULT_TIMEOUT,
  };

  // Handle provider selection
  if (normalized.provider === 'auto') {
    const autoProvider = autoSelectProvider();
    if (!autoProvider) {
      throw new ConfigurationError(
        `No provider API keys found. Set one of the following environment variables: ${Object.values(ENV_KEYS).join(', ')}`,
        'config'
      );
    }
    normalized.provider = autoProvider;
  } else {
    validateProviderApiKey(normalized.provider!);
  }

  // Handle runtime selection
  if (config?.runtime) {
    normalized.runtime = config.runtime;
  } else if (!config?.container) {
    normalized.runtime = getDefaultRuntime(normalized.provider!);
  }

  // Handle container configuration
  if (config?.container) {
    normalized.container = normalizeContainerConfig(config.container);
  }

  return normalized;
}
