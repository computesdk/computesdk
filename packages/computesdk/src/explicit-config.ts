/**
 * Explicit Config
 *
 * Converts explicit compute configuration to gateway config.
 * Used when compute() is called as a function with configuration.
 */

import type { ExplicitComputeConfig } from './compute';
import type { GatewayConfig } from './auto-detect';
import {
  PROVIDER_AUTH,
  PROVIDER_HEADERS,
  PROVIDER_DASHBOARD_URLS,
  PROVIDER_ENV_MAP,
  type ProviderName,
} from './provider-config';
import { GATEWAY_URL } from './constants';

/**
 * Build provider-specific headers for gateway authentication
 */
function buildProviderHeaders(config: ExplicitComputeConfig): Record<string, string> {
  const headers: Record<string, string> = {};
  const provider = config.provider as ProviderName;
  const headerMap = PROVIDER_HEADERS[provider];
  const providerConfig = config[provider] as Record<string, string | undefined> | undefined;

  if (!providerConfig || !headerMap) return headers;

  for (const [configKey, headerName] of Object.entries(headerMap)) {
    const value = providerConfig[configKey];
    if (value) {
      headers[headerName] = value;
    }
  }

  return headers;
}

/**
 * Validate that the config has the required provider-specific credentials
 */
function validateProviderConfig(config: ExplicitComputeConfig): void {
  const provider = config.provider as ProviderName;
  const authOptions = PROVIDER_AUTH[provider];
  const providerConfig = config[provider] as Record<string, string | undefined> | undefined;
  const dashboardUrl = PROVIDER_DASHBOARD_URLS[provider];

  if (!authOptions) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  // Check if any auth option is satisfied
  // For explicit mode, we check config fields instead of env vars
  for (const option of authOptions) {
    // Map env vars to config field names and check if all are present
    const allPresent = option.every(envVar => {
      const configField = envVarToConfigField(provider, envVar);
      return providerConfig?.[configField];
    });

    if (allPresent) return; // Valid config found
  }

  // No valid config found, build helpful error message
  const configExample = buildConfigExample(provider, authOptions);
  throw new Error(
    `Missing ${provider} configuration. When using provider: '${provider}', you must provide:\n` +
    `${configExample}\n\n` +
    `Get your credentials at: ${dashboardUrl}`
  );
}

/**
 * Map environment variable name to config field name
 * Uses shared PROVIDER_ENV_MAP as single source of truth
 */
function envVarToConfigField(provider: ProviderName, envVar: string): string {
  return PROVIDER_ENV_MAP[provider]?.[envVar] ?? envVar.toLowerCase();
}

/**
 * Build example config for error message
 */
function buildConfigExample(provider: ProviderName, authOptions: readonly (readonly string[])[]): string {
  if (authOptions.length === 1) {
    // Single option
    const fields = authOptions[0].map(envVar => {
      const field = envVarToConfigField(provider, envVar);
      return `${field}: '...'`;
    });
    return `  ${provider}: { ${fields.join(', ')} }`;
  }

  // Multiple options (like Vercel with OIDC or traditional)
  const options = authOptions.map((option, i) => {
    const fields = option.map(envVar => {
      const field = envVarToConfigField(provider, envVar);
      return `${field}: '...'`;
    });
    return `  Option ${i + 1}:\n    ${provider}: { ${fields.join(', ')} }`;
  });

  return options.join('\n\n');
}

/**
 * Create gateway configuration from explicit configuration
 *
 * @param config - Explicit compute configuration
 * @returns Gateway configuration object
 */
export function createConfigFromExplicit(config: ExplicitComputeConfig): GatewayConfig {
  // Support both computesdkApiKey (preferred) and apiKey (deprecated)
  const computesdkApiKey = config.computesdkApiKey || config.apiKey;

  // Validate required fields
  if (!computesdkApiKey) {
    throw new Error(
      `Missing ComputeSDK API key. Set 'computesdkApiKey' in your config.\n\n` +
      `Example:\n` +
      `  compute.setConfig({\n` +
      `    provider: 'e2b',\n` +
      `    computesdkApiKey: process.env.COMPUTESDK_API_KEY,\n` +
      `    e2b: { apiKey: process.env.E2B_API_KEY }\n` +
      `  })\n\n` +
      `Get your API key at: https://computesdk.com/dashboard`
    );
  }

  // Validate provider-specific config
  validateProviderConfig(config);

  // Build provider headers
  const providerHeaders = buildProviderHeaders(config);

  // Create and return gateway config
  return {
    apiKey: computesdkApiKey,
    gatewayUrl: config.gatewayUrl || GATEWAY_URL,
    provider: config.provider,
    providerHeaders,
    WebSocket: config.WebSocket,
  };
}
