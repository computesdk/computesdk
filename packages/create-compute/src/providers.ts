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
 */
export function detectAvailableProviders(): string[] {
  const available: string[] = [];

  for (const provider of PROVIDER_NAMES) {
    if (isProviderAuthComplete(provider)) {
      available.push(provider);
    }
  }

  return available;
}

/**
 * Get status of all providers
 */
export function getProviderStatus(): ProviderStatus[] {
  return PROVIDER_NAMES.map((provider) => ({
    name: provider,
    ready: isProviderAuthComplete(provider),
    missing: getMissingEnvVars(provider),
  }));
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
    computesdkApiKey: process.env.COMPUTESDK_API_KEY,
  };

  // Add provider-specific config from env vars
  const providerConfig = getProviderConfigFromEnv(provider as ProviderName);
  if (Object.keys(providerConfig).length > 0) {
    config[provider] = providerConfig;
  }

  return config;
}
