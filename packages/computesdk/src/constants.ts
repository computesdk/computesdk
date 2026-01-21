/**
 * ComputeSDK Constants
 *
 * Default configuration values and provider definitions
 */

// Re-export provider config as the single source of truth
export {
  PROVIDER_AUTH,
  PROVIDER_NAMES,
  PROVIDER_HEADERS,
  PROVIDER_ENV_MAP,
  PROVIDER_DASHBOARD_URLS,
  type ProviderName,
  isValidProvider,
  buildProviderHeaders,
  getProviderConfigFromEnv,
  isProviderAuthComplete,
  getMissingEnvVars,
} from './provider-config';

/**
 * Default gateway URL for sandbox lifecycle operations
 */
export const GATEWAY_URL = 'https://gateway.computesdk.com';

/**
 * Provider detection priority order
 * When multiple provider credentials are detected, use the first one in this list
 */
export const PROVIDER_PRIORITY = [
  'e2b',
  'railway',
  'render',
  'daytona',
  'modal',
  'runloop',
  'vercel',
  'cloudflare',
  'codesandbox',
  'blaxel',
] as const;

/**
 * Required environment variables for each provider
 * @deprecated Use PROVIDER_AUTH from provider-config instead
 */
export const PROVIDER_ENV_VARS = {
  e2b: ['E2B_API_KEY'],
  railway: ['RAILWAY_API_KEY', 'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID'],
  render: ['RENDER_API_KEY', 'RENDER_OWNER_ID'],
  daytona: ['DAYTONA_API_KEY'],
  modal: ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET'],
  runloop: ['RUNLOOP_API_KEY'],
  vercel: ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'],
  cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
  codesandbox: ['CSB_API_KEY'],
  blaxel: ['BL_API_KEY', 'BL_WORKSPACE'],
} as const;
