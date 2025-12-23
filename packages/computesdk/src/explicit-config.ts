/**
 * Explicit Config
 *
 * Converts explicit compute configuration to a gateway provider.
 * Used when compute() is called as a function with configuration.
 */

import { gateway } from './providers/gateway';
import type { Provider, ExplicitComputeConfig } from './types';
import {
  PROVIDER_AUTH,
  PROVIDER_HEADERS,
  PROVIDER_DASHBOARD_URLS,
  type ProviderName,
} from './provider-config';

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
 */
function envVarToConfigField(provider: ProviderName, envVar: string): string {
  // Common patterns
  const mappings: Record<string, Record<string, string>> = {
    e2b: { E2B_API_KEY: 'apiKey' },
    modal: { MODAL_TOKEN_ID: 'tokenId', MODAL_TOKEN_SECRET: 'tokenSecret' },
    railway: { RAILWAY_API_KEY: 'apiToken', RAILWAY_PROJECT_ID: 'projectId', RAILWAY_ENVIRONMENT_ID: 'environmentId' },
    daytona: { DAYTONA_API_KEY: 'apiKey' },
    vercel: { VERCEL_OIDC_TOKEN: 'oidcToken', VERCEL_TOKEN: 'token', VERCEL_TEAM_ID: 'teamId', VERCEL_PROJECT_ID: 'projectId' },
    runloop: { RUNLOOP_API_KEY: 'apiKey' },
    cloudflare: { CLOUDFLARE_API_TOKEN: 'apiToken', CLOUDFLARE_ACCOUNT_ID: 'accountId' },
    codesandbox: { CSB_API_KEY: 'apiKey' },
    blaxel: { BL_API_KEY: 'apiKey', BL_WORKSPACE: 'workspace' },
  };

  return mappings[provider]?.[envVar] ?? envVar.toLowerCase();
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
 * Create a gateway provider from explicit configuration
 *
 * @param config - Explicit compute configuration
 * @returns A configured gateway provider
 */
export function createProviderFromConfig(config: ExplicitComputeConfig): Provider {
  // Validate required fields
  if (!config.apiKey) {
    throw new Error(
      `Missing ComputeSDK API key. The 'apiKey' field is required.\n\n` +
      `Get your API key at: https://computesdk.com/dashboard`
    );
  }

  // Validate provider-specific config
  validateProviderConfig(config);

  // Build provider headers
  const providerHeaders = buildProviderHeaders(config);

  // Create and return gateway provider
  return gateway({
    apiKey: config.apiKey,
    provider: config.provider,
    providerHeaders,
  });
}
