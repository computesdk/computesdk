/**
 * Auto-Detection Module
 * 
 * Automatically detects gateway mode and provider from environment variables.
 * Enables zero-config usage of ComputeSDK.
 */

import { GATEWAY_URL, PROVIDER_PRIORITY, PROVIDER_ENV_VARS, type ProviderName } from './constants';
import type { WebSocketConstructor } from './client';

/**
 * Check if gateway mode is enabled
 * Gateway mode requires COMPUTESDK_API_KEY to be set
 */
export function isGatewayModeEnabled(): boolean {
  return !!(typeof process !== 'undefined' && process.env?.COMPUTESDK_API_KEY);
}

/**
 * Check if all required environment variables exist for a provider
 */
function hasProviderEnv(provider: ProviderName): boolean {
  if (typeof process === 'undefined') return false;
  
  const requiredVars = PROVIDER_ENV_VARS[provider];
  if (!requiredVars) return false; // Safety check for invalid provider names
  
  return requiredVars.every(varName => !!process.env?.[varName]);
}

/**
 * Get detailed status of provider credentials
 */
function getProviderEnvStatus(provider: ProviderName): {
  provider: string;
  present: string[];
  missing: string[];
  isComplete: boolean;
} {
  const requiredVars = PROVIDER_ENV_VARS[provider];
  
  if (typeof process === 'undefined' || !requiredVars) {
    return { provider, present: [], missing: requiredVars ? [...requiredVars] : [], isComplete: false };
  }
  
  const present = requiredVars.filter(varName => !!process.env?.[varName]);
  const missing = requiredVars.filter(varName => !process.env?.[varName]);
  
  return {
    provider,
    present: [...present],
    missing: [...missing],
    isComplete: missing.length === 0
  };
}

/**
 * Detect which provider to use from environment variables
 * 
 * Detection order:
 * 1. Check for explicit COMPUTESDK_PROVIDER override
 * 2. Auto-detect based on PROVIDER_PRIORITY order
 * 
 * @returns Provider name or null if none detected
 */
export function detectProvider(): string | null {
  if (typeof process === 'undefined') return null;
  
  // Check for explicit override
  const explicit = process.env.COMPUTESDK_PROVIDER?.toLowerCase();
  if (explicit && hasProviderEnv(explicit as ProviderName)) {
    return explicit;
  }
  
  // Warn if explicit provider set but credentials missing
  if (explicit && !hasProviderEnv(explicit as ProviderName)) {
    console.warn(
      `⚠️  COMPUTESDK_PROVIDER is set to "${explicit}" but required credentials are missing.\n` +
      `   Required: ${PROVIDER_ENV_VARS[explicit as ProviderName]?.join(', ') || 'unknown'}\n` +
      `   Falling back to auto-detection...`
    );
  }
  
  // Auto-detect based on priority order
  for (const provider of PROVIDER_PRIORITY) {
    if (hasProviderEnv(provider)) {
      return provider;
    }
  }
  
  return null;
}

/**
 * Build provider-specific headers from environment variables
 * These headers are passed through to the gateway
 */
export function getProviderHeaders(provider: string): Record<string, string> {
  if (typeof process === 'undefined') return {};
  
  const headers: Record<string, string> = {};
  
  switch (provider) {
    case 'e2b':
      if (process.env.E2B_API_KEY) {
        headers['X-E2B-API-Key'] = process.env.E2B_API_KEY;
      }
      break;
      
    case 'railway':
      if (process.env.RAILWAY_API_KEY) {
        headers['X-Railway-API-Key'] = process.env.RAILWAY_API_KEY;
      }
      if (process.env.RAILWAY_PROJECT_ID) {
        headers['X-Railway-Project-ID'] = process.env.RAILWAY_PROJECT_ID;
      }
      if (process.env.RAILWAY_ENVIRONMENT_ID) {
        headers['X-Railway-Environment-ID'] = process.env.RAILWAY_ENVIRONMENT_ID;
      }
      break;
      
    case 'daytona':
      if (process.env.DAYTONA_API_KEY) {
        headers['X-Daytona-API-Key'] = process.env.DAYTONA_API_KEY;
      }
      break;
      
    case 'modal':
      if (process.env.MODAL_TOKEN_ID) {
        headers['X-Modal-Token-ID'] = process.env.MODAL_TOKEN_ID;
      }
      if (process.env.MODAL_TOKEN_SECRET) {
        headers['X-Modal-Token-Secret'] = process.env.MODAL_TOKEN_SECRET;
      }
      break;
      
    case 'runloop':
      if (process.env.RUNLOOP_API_KEY) {
        headers['X-Runloop-API-Key'] = process.env.RUNLOOP_API_KEY;
      }
      break;
      
    case 'vercel':
      if (process.env.VERCEL_TOKEN) {
        headers['X-Vercel-Token'] = process.env.VERCEL_TOKEN;
      }
      if (process.env.VERCEL_TEAM_ID) {
        headers['X-Vercel-Team-ID'] = process.env.VERCEL_TEAM_ID;
      }
      if (process.env.VERCEL_PROJECT_ID) {
        headers['X-Vercel-Project-ID'] = process.env.VERCEL_PROJECT_ID;
      }
      break;
      
    case 'cloudflare':
      if (process.env.CLOUDFLARE_API_TOKEN) {
        headers['X-Cloudflare-API-Token'] = process.env.CLOUDFLARE_API_TOKEN;
      }
      if (process.env.CLOUDFLARE_ACCOUNT_ID) {
        headers['X-Cloudflare-Account-ID'] = process.env.CLOUDFLARE_ACCOUNT_ID;
      }
      break;
      
    case 'codesandbox':
      if (process.env.CSB_API_KEY) {
        headers['X-CodeSandbox-API-Key'] = process.env.CSB_API_KEY;
      }
      break;
      
    case 'blaxel':
      if (process.env.BL_API_KEY) {
        headers['X-Blaxel-API-Key'] = process.env.BL_API_KEY;
      }
      if (process.env.BL_WORKSPACE) {
        headers['X-Blaxel-Workspace'] = process.env.BL_WORKSPACE;
      }
      break;

    case 'namespace':
      if (process.env.NSC_TOKEN) {
        headers['X-Namespace-Token'] = process.env.NSC_TOKEN;
      }
      break;
  }

  return headers;
}

/**
 * Gateway configuration object
 */
export interface GatewayConfig {
  apiKey: string;
  gatewayUrl: string;
  provider: string;
  providerHeaders: Record<string, string>;
  WebSocket?: WebSocketConstructor;
}

/**
 * Main auto-configuration function
 * Returns gateway configuration or null if auto-detection not possible
 *
 * @throws Error if COMPUTESDK_API_KEY is set but no provider detected
 */
export function autoConfigureCompute(): GatewayConfig | null {
  // Only auto-configure in gateway mode
  if (!isGatewayModeEnabled()) {
    return null;
  }

  const provider = detectProvider();
  if (!provider) {
    // Build detailed diagnostic information
    const detectionResults = PROVIDER_PRIORITY.map(p => getProviderEnvStatus(p));
    
    // Create status indicators
    const statusLines = detectionResults.map(result => {
      const status = result.isComplete ? '✅' : 
                     result.present.length > 0 ? '⚠️ ' : '❌';
      const ratio = `${result.present.length}/${result.present.length + result.missing.length}`;
      let line = `  ${status} ${result.provider.padEnd(12)} ${ratio} credentials`;
      
      // Show what's missing for partial matches
      if (result.present.length > 0 && result.missing.length > 0) {
        line += ` (missing: ${result.missing.join(', ')})`;
      }
      
      return line;
    });
    
    throw new Error(
      `COMPUTESDK_API_KEY is set but no provider detected.\n\n` +
      `Provider detection results:\n` +
      statusLines.join('\n') +
      `\n\n` +
      `To fix this, set one of the following:\n\n` +
      `  E2B:        export E2B_API_KEY=xxx\n` +
      `  Railway:    export RAILWAY_API_KEY=xxx RAILWAY_PROJECT_ID=xxx RAILWAY_ENVIRONMENT_ID=xxx\n` +
      `  Daytona:    export DAYTONA_API_KEY=xxx\n` +
      `  Modal:      export MODAL_TOKEN_ID=xxx MODAL_TOKEN_SECRET=xxx\n` +
      `  Runloop:    export RUNLOOP_API_KEY=xxx\n` +
      `  Vercel:     export VERCEL_TOKEN=xxx VERCEL_TEAM_ID=xxx VERCEL_PROJECT_ID=xxx\n` +
      `  Cloudflare: export CLOUDFLARE_API_TOKEN=xxx CLOUDFLARE_ACCOUNT_ID=xxx\n` +
      `  CodeSandbox: export CSB_API_KEY=xxx\n` +
      `  Blaxel:     export BL_API_KEY=xxx BL_WORKSPACE=xxx\n` +
      `  Namespace:  export NSC_TOKEN=xxx\n\n` +
      `Or set COMPUTESDK_PROVIDER to specify explicitly:\n` +
      `  export COMPUTESDK_PROVIDER=e2b\n\n` +
      `Docs: https://computesdk.com/docs/quickstart`
    );
  }

  const gatewayUrl = process.env.COMPUTESDK_GATEWAY_URL || GATEWAY_URL;
  const computesdkApiKey = process.env.COMPUTESDK_API_KEY!;
  const providerHeaders = getProviderHeaders(provider);

  // Validate gateway URL
  try {
    new URL(gatewayUrl);
  } catch (error) {
    throw new Error(
      `Invalid gateway URL: "${gatewayUrl}"\n\n` +
      `The URL must be a valid HTTP/HTTPS URL.\n` +
      `Check your COMPUTESDK_GATEWAY_URL environment variable.`
    );
  }

  // Debug logging if enabled
  if (process.env.COMPUTESDK_DEBUG) {
    console.log(`✨ ComputeSDK: Auto-detected ${provider} provider`);
    console.log(`🌐 Gateway: ${gatewayUrl}`);
    console.log(`🔑 Provider headers:`, Object.keys(providerHeaders).join(', '));
  }

  const config: GatewayConfig = {
    apiKey: computesdkApiKey,
    gatewayUrl,
    provider,
    providerHeaders
  };
  
  return config;
}
