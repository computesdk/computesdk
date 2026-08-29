/**
 * Provider detection and validation
 */

import {
  PROVIDER_NAMES,
  isProviderAuthComplete,
  getMissingEnvVars,
  getProviderConfigFromEnv,
  type ProviderName,
} from 'computesdk';

// Providers that need additional credentials beyond COMPUTESDK_API_KEY
const PROVIDERS_NEEDING_CREDS = [
  'e2b',
  'railway',
  'modal',
  'vercel',
  'daytona',
  'render',
  'namespace',
  'blaxel',
  'codesandbox',
];

/**
 * Provider status info
 */
export interface ProviderStatus {
  name: string;
  ready: boolean;
  missing: string[];
}

/**
 * Detect all available providers from environment variables
 * Only includes providers supported by the ComputeSDK gateway
 */
export function detectAvailableProviders(): string[] {
  const available: string[] = [];

  // Check for computesdk first (ComputeSDK native - just needs gateway key)
  if (process.env.COMPUTESDK_API_KEY) {
    available.push('computesdk');
  }

  // Then check for individual cloud providers (need their own creds)
  for (const provider of PROVIDER_NAMES) {
    if (PROVIDERS_NEEDING_CREDS.includes(provider as string) && isProviderAuthComplete(provider)) {
      available.push(provider);
    }
  }

  return available;
}

/**
 * Get status of all providers
 * Only includes providers supported by the ComputeSDK gateway
 */
export function getProviderStatus(): ProviderStatus[] {
  const statuses: ProviderStatus[] = [];

  // Add computesdk status (ComputeSDK native)
  const hasGatewayKey = !!process.env.COMPUTESDK_API_KEY;
  statuses.push({
    name: 'computesdk',
    ready: hasGatewayKey,
    missing: hasGatewayKey ? [] : ['COMPUTESDK_API_KEY'],
  });

  // Add individual cloud providers (need their own creds)
  for (const provider of PROVIDER_NAMES) {
    if (PROVIDERS_NEEDING_CREDS.includes(provider as string)) {
      statuses.push({
        name: provider,
        ready: isProviderAuthComplete(provider),
        missing: getMissingEnvVars(provider),
      });
    }
  }

  return statuses;
}

/**
 * Check if gateway mode is available
 */
export function isGatewayAvailable(): boolean {
  return !!process.env.COMPUTESDK_API_KEY;
}

/**
 * Build the full compute config for a provider from env vars
 */
export function buildProviderConfig(provider: string): Record<string, unknown> {
  const config: Record<string, unknown> = {
    provider,
    apiKey: process.env.COMPUTESDK_API_KEY,  // Gateway API key (top-level)
  };

  // For 'computesdk' provider, nest the API key under the provider config too
  if (provider === 'computesdk') {
    config.computesdk = {
      computesdk_api_key: process.env.COMPUTESDK_API_KEY,
    };
  }

  // Add provider-specific config from env vars (for other providers)
  if (provider !== 'computesdk') {
    const providerConfig = getProviderConfigFromEnv(provider as ProviderName);
    if (Object.keys(providerConfig).length > 0) {
      config[provider] = providerConfig;
    }
  }

  return config;
}
