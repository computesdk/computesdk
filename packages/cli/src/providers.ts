/**
 * Provider detection and validation
 *
 * Detection is local: each provider declares the env vars its credentials come
 * from, and "ready" means all of them are set. This used to import helpers from
 * `computesdk` that the package no longer exports, which made every `compute`
 * invocation fail at module load.
 */

interface ProviderEnvSpec {
  /** Env vars that must all be set for the provider to be usable. */
  required: string[];
  /**
   * Maps each env var to the provider's nested config key (the field names in
   * the provider package's config interface, e.g. `apiKey`, `tokenId`).
   */
  configKeys: Record<string, string>;
}

const PROVIDER_ENV: Record<string, ProviderEnvSpec> = {
  e2b: { required: ['E2B_API_KEY'], configKeys: { E2B_API_KEY: 'apiKey' } },
  railway: { required: ['RAILWAY_API_TOKEN'], configKeys: { RAILWAY_API_TOKEN: 'token' } },
  modal: {
    required: ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET'],
    configKeys: { MODAL_TOKEN_ID: 'tokenId', MODAL_TOKEN_SECRET: 'tokenSecret' },
  },
  vercel: {
    required: ['VERCEL_TOKEN'],
    configKeys: {
      VERCEL_TOKEN: 'token',
      VERCEL_TEAM_ID: 'teamId',
      VERCEL_PROJECT_ID: 'projectId',
    },
  },
  daytona: { required: ['DAYTONA_API_KEY'], configKeys: { DAYTONA_API_KEY: 'apiKey' } },
  namespace: { required: ['NSC_TOKEN'], configKeys: { NSC_TOKEN: 'token' } },
  blaxel: {
    required: ['BL_API_KEY', 'BL_WORKSPACE'],
    configKeys: { BL_API_KEY: 'apiKey', BL_WORKSPACE: 'workspace' },
  },
  codesandbox: { required: ['CSB_API_KEY'], configKeys: { CSB_API_KEY: 'apiKey' } },
  render: { required: ['RENDER_API_KEY'], configKeys: { RENDER_API_KEY: 'apiKey' } },
};

const PROVIDER_NAMES = Object.keys(PROVIDER_ENV);

function missingEnvVars(provider: string): string[] {
  const spec = PROVIDER_ENV[provider];
  if (!spec) return [];
  return spec.required.filter((name) => !process.env[name]);
}

function isProviderAuthComplete(provider: string): boolean {
  return missingEnvVars(provider).length === 0;
}

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
    if (isProviderAuthComplete(provider)) {
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
    statuses.push({
      name: provider,
      ready: isProviderAuthComplete(provider),
      missing: missingEnvVars(provider),
    });
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
    return config;
  }

  // Add provider-specific config from env vars
  const spec = PROVIDER_ENV[provider];
  if (spec) {
    const providerConfig: Record<string, string> = {};
    for (const [envVar, key] of Object.entries(spec.configKeys)) {
      const value = process.env[envVar];
      if (value) providerConfig[key] = value;
    }
    if (Object.keys(providerConfig).length > 0) {
      config[provider] = providerConfig;
    }
  }

  return config;
}
