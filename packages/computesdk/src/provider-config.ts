/**
 * Unified Provider Configuration
 *
 * Single source of truth for all provider auth requirements.
 * Used by both explicit mode (computesdk) and magic mode (workbench).
 */

/**
 * Provider auth requirements
 *
 * Structure: { provider: [[option1_vars], [option2_vars], ...] }
 * - Outer array: OR conditions (any option can satisfy auth)
 * - Inner arrays: AND conditions (all vars in option must be present)
 *
 * Example: vercel: [['OIDC_TOKEN'], ['TOKEN', 'TEAM_ID', 'PROJECT_ID']]
 *   -> Ready if OIDC_TOKEN is set, OR if all three traditional vars are set
 */
export const PROVIDER_AUTH = {
  e2b: [['E2B_API_KEY']],
  modal: [['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET']],
  railway: [['RAILWAY_API_KEY', 'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID']],
  render: [['RENDER_API_KEY', 'RENDER_OWNER_ID']],
  daytona: [['DAYTONA_API_KEY']],
  vercel: [
    ['VERCEL_OIDC_TOKEN'],
    ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'],
  ],
  runloop: [['RUNLOOP_API_KEY']],
  cloudflare: [['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']],
  codesandbox: [['CSB_API_KEY']],
  blaxel: [['BL_API_KEY', 'BL_WORKSPACE']],
  namespace: [['NSC_TOKEN'], ['NSC_TOKEN_FILE']],
  hopx: [['HOPX_API_KEY']],
} as const;

/**
 * All supported provider names (excluding gateway which is special)
 */
export const PROVIDER_NAMES = Object.keys(PROVIDER_AUTH) as ProviderName[];

/**
 * Provider name type derived from PROVIDER_AUTH
 */
export type ProviderName = keyof typeof PROVIDER_AUTH;

/**
 * Header mapping for each provider
 * Maps config field names to HTTP header names
 */
export const PROVIDER_HEADERS: Record<ProviderName, Record<string, string>> = {
  e2b: {
    apiKey: 'X-E2B-API-Key',
  },
  modal: {
    tokenId: 'X-Modal-Token-Id',
    tokenSecret: 'X-Modal-Token-Secret',
  },
  railway: {
    apiToken: 'X-Railway-API-Key',
    projectId: 'X-Railway-Project-ID',
    environmentId: 'X-Railway-Environment-ID',
  },
  render: {
    apiKey: 'X-Render-API-Key',
    ownerId: 'X-Render-Owner-ID',
  },
  daytona: {
    apiKey: 'X-Daytona-API-Key',
  },
  vercel: {
    oidcToken: 'X-Vercel-OIDC-Token',
    token: 'X-Vercel-Token',
    teamId: 'X-Vercel-Team-Id',
    projectId: 'X-Vercel-Project-Id',
  },
  runloop: {
    apiKey: 'X-Runloop-API-Key',
  },
  cloudflare: {
    apiToken: 'X-Cloudflare-API-Token',
    accountId: 'X-Cloudflare-Account-Id',
  },
  codesandbox: {
    apiKey: 'X-CODESANDBOX-API-Key',
  },
  blaxel: {
    apiKey: 'X-Blaxel-API-Key',
    workspace: 'X-Blaxel-Workspace',
  },
  namespace: {
    token: 'X-Namespace-Token',
  },
  hopx: {
    apiKey: 'X-HOPX-API-Key',
  },
};

/**
 * Environment variable to config field mapping for each provider
 */
export const PROVIDER_ENV_MAP: Record<ProviderName, Record<string, string>> = {
  e2b: {
    E2B_API_KEY: 'apiKey',
  },
  modal: {
    MODAL_TOKEN_ID: 'tokenId',
    MODAL_TOKEN_SECRET: 'tokenSecret',
  },
  railway: {
    RAILWAY_API_KEY: 'apiToken',
    RAILWAY_PROJECT_ID: 'projectId',
    RAILWAY_ENVIRONMENT_ID: 'environmentId',
  },
  render: {
    RENDER_API_KEY: 'apiKey',
    RENDER_OWNER_ID: 'ownerId',
  },
  daytona: {
    DAYTONA_API_KEY: 'apiKey',
  },
  vercel: {
    VERCEL_OIDC_TOKEN: 'oidcToken',
    VERCEL_TOKEN: 'token',
    VERCEL_TEAM_ID: 'teamId',
    VERCEL_PROJECT_ID: 'projectId',
  },
  runloop: {
    RUNLOOP_API_KEY: 'apiKey',
  },
  cloudflare: {
    CLOUDFLARE_API_TOKEN: 'apiToken',
    CLOUDFLARE_ACCOUNT_ID: 'accountId',
  },
  codesandbox: {
    CSB_API_KEY: 'apiKey',
  },
  blaxel: {
    BL_API_KEY: 'apiKey',
    BL_WORKSPACE: 'workspace',
  },
  namespace: {
    NSC_TOKEN: 'token',
    NSC_TOKEN_FILE: 'tokenFile',
  },
  hopx: {
    HOPX_API_KEY: 'apiKey',
  },
};

/**
 * Dashboard URLs for each provider (for error messages)
 */
export const PROVIDER_DASHBOARD_URLS: Record<ProviderName, string> = {
  e2b: 'https://e2b.dev/dashboard',
  modal: 'https://modal.com/settings',
  railway: 'https://railway.app/account/tokens',
  render: 'https://dashboard.render.com/account',
  daytona: 'https://daytona.io/dashboard',
  vercel: 'https://vercel.com/account/tokens',
  runloop: 'https://runloop.ai/dashboard',
  cloudflare: 'https://dash.cloudflare.com/profile/api-tokens',
  codesandbox: 'https://codesandbox.io/dashboard/settings',
  blaxel: 'https://blaxel.ai/dashboard',
  namespace: 'https://cloud.namespace.so',
  hopx: 'https://hopx.ai/dashboard',
};

/**
 * Check if a provider name is valid
 */
export function isValidProvider(name: string): name is ProviderName {
  return name in PROVIDER_AUTH;
}

/**
 * Build headers from provider config
 */
export function buildProviderHeaders(
  provider: ProviderName,
  config: Record<string, string | undefined>
): Record<string, string> {
  const headers: Record<string, string> = {};
  const headerMap = PROVIDER_HEADERS[provider];

  for (const [configKey, headerName] of Object.entries(headerMap)) {
    const value = config[configKey];
    if (value) {
      headers[headerName] = value;
    }
  }

  return headers;
}

/**
 * Get provider config from environment variables
 */
export function getProviderConfigFromEnv(provider: ProviderName): Record<string, string> {
  const config: Record<string, string> = {};
  const envMap = PROVIDER_ENV_MAP[provider];

  for (const [envVar, configKey] of Object.entries(envMap)) {
    const value = process.env[envVar];
    if (value) {
      config[configKey] = value;
    }
  }

  return config;
}

/**
 * Check if provider has complete auth from environment
 */
export function isProviderAuthComplete(provider: ProviderName): boolean {
  const authOptions = PROVIDER_AUTH[provider];

  for (const option of authOptions) {
    const allPresent = option.every(envVar => !!process.env[envVar]);
    if (allPresent) return true;
  }

  return false;
}

/**
 * Get missing env vars for a provider (returns the option closest to completion)
 */
export function getMissingEnvVars(provider: ProviderName): string[] {
  const authOptions = PROVIDER_AUTH[provider];
  let bestOption: { presentCount: number; missing: string[] } | null = null;

  for (const option of authOptions) {
    const missing: string[] = [];
    let presentCount = 0;

    for (const envVar of option) {
      if (process.env[envVar]) {
        presentCount++;
      } else {
        missing.push(envVar);
      }
    }

    if (missing.length === 0) return [];

    if (!bestOption || presentCount > bestOption.presentCount) {
      bestOption = { presentCount, missing };
    }
  }

  return bestOption?.missing ?? [];
}
