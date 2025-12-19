/**
 * ComputeSDK Constants
 * 
 * Default configuration values and provider definitions
 */

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
  'daytona',
  'modal',
  'runloop',
  'vercel',
  'cloudflare',
  'codesandbox',
  'blaxel'
] as const;

/**
 * Required environment variables for each provider
 * Used to detect which provider to use from environment
 */
export const PROVIDER_ENV_VARS = {
  e2b: ['E2B_API_KEY'],
  railway: ['RAILWAY_API_KEY', 'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID'],
  daytona: ['DAYTONA_API_KEY'],
  modal: ['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET'],
  runloop: ['RUNLOOP_API_KEY'],
  vercel: ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'],
  cloudflare: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
  codesandbox: ['CSB_API_KEY'],
  blaxel: ['BL_API_KEY', 'BL_WORKSPACE']
} as const;

/**
 * Type for provider names
 */
export type ProviderName = keyof typeof PROVIDER_ENV_VARS;
