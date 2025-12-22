/**
 * Explicit Config
 *
 * Converts explicit compute configuration to a gateway provider.
 * Used when compute() is called as a function with configuration.
 */

import { gateway } from './providers/gateway';
import type { Provider, ExplicitComputeConfig, ExplicitProviderName } from './types';

/**
 * Build provider-specific headers for gateway authentication
 */
function buildProviderHeaders(config: ExplicitComputeConfig): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (config.provider) {
    case 'e2b':
      if (config.e2b?.apiKey) {
        headers['X-E2B-API-Key'] = config.e2b.apiKey;
      }
      break;

    case 'modal':
      if (config.modal?.tokenId) {
        headers['X-Modal-Token-Id'] = config.modal.tokenId;
      }
      if (config.modal?.tokenSecret) {
        headers['X-Modal-Token-Secret'] = config.modal.tokenSecret;
      }
      break;

    case 'railway':
      if (config.railway?.apiToken) {
        headers['X-Railway-API-Token'] = config.railway.apiToken;
      }
      break;

    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown provider: ${exhaustiveCheck}`);
    }
  }

  return headers;
}

/**
 * Validate that the config has the required provider-specific credentials
 */
function validateProviderConfig(config: ExplicitComputeConfig): void {
  const providerName = config.provider;

  switch (providerName) {
    case 'e2b':
      if (!config.e2b?.apiKey) {
        throw new Error(
          `Missing E2B configuration. When using provider: 'e2b', you must provide:\n` +
          `  e2b: { apiKey: 'your-e2b-api-key' }\n\n` +
          `Get your API key at: https://e2b.dev/dashboard`
        );
      }
      break;

    case 'modal':
      if (!config.modal?.tokenId || !config.modal?.tokenSecret) {
        throw new Error(
          `Missing Modal configuration. When using provider: 'modal', you must provide:\n` +
          `  modal: { tokenId: '...', tokenSecret: '...' }\n\n` +
          `Get your tokens at: https://modal.com/settings`
        );
      }
      break;

    case 'railway':
      if (!config.railway?.apiToken) {
        throw new Error(
          `Missing Railway configuration. When using provider: 'railway', you must provide:\n` +
          `  railway: { apiToken: 'your-railway-token' }\n\n` +
          `Get your token at: https://railway.app/account/tokens`
        );
      }
      break;

    default: {
      const exhaustiveCheck: never = providerName;
      throw new Error(`Unknown provider: ${exhaustiveCheck}`);
    }
  }
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
