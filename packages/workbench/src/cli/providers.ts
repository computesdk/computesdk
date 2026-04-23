/**
 * Provider detection and management for workbench
 */

import type { ProviderStatus } from './types.js';
import { c } from './output.js';

const SHARED_PROVIDER_NAMES = [
  'e2b',
  'railway',
  'daytona',
  'modal',
  'runloop',
  'vercel',
  'cloudflare',
  'beam',
  'just-bash',
  'codesandbox',
  'blaxel',
  'namespace',
  'hopx',
  'declaw',
  'sprites',
  'agentuity',
  'freestyle',
  'secure-exec',
  'upstash',
] as const;

type SharedProviderName = typeof SHARED_PROVIDER_NAMES[number];

const SHARED_PROVIDER_AUTH: Record<SharedProviderName, readonly (readonly string[])[]> = {
  e2b: [['E2B_API_KEY']],
  railway: [['RAILWAY_API_KEY', 'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID']],
  daytona: [['DAYTONA_API_KEY']],
  modal: [['MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET']],
  runloop: [['RUNLOOP_API_KEY']],
  vercel: [
    ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID'],
    ['VERCEL_OIDC_TOKEN'],
  ],
  cloudflare: [
    ['CLOUDFLARE_SANDBOX_URL', 'CLOUDFLARE_SANDBOX_SECRET'],
    ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'],
  ],
  beam: [['BEAM_TOKEN', 'BEAM_WORKSPACE_ID']],
  'just-bash': [[]],
  codesandbox: [['CSB_API_KEY']],
  blaxel: [['BL_API_KEY', 'BL_WORKSPACE']],
  namespace: [['NSC_TOKEN'], ['NSC_TOKEN_FILE']],
  hopx: [['HOPX_API_KEY']],
  declaw: [['DECLAW_API_KEY']],
  sprites: [['SPRITES_TOKEN']],
  agentuity: [['AGENTUITY_SDK_KEY']],
  freestyle: [['FREESTYLE_API_KEY']],
  'secure-exec': [[]],
  upstash: [['UPSTASH_BOX_API_KEY']],
};

const PROVIDER_ENV_MAP: Record<SharedProviderName, Record<string, string>> = {
  e2b: { apiKey: 'E2B_API_KEY' },
  railway: {
    apiKey: 'RAILWAY_API_KEY',
    projectId: 'RAILWAY_PROJECT_ID',
    environmentId: 'RAILWAY_ENVIRONMENT_ID',
  },
  daytona: { apiKey: 'DAYTONA_API_KEY' },
  modal: { tokenId: 'MODAL_TOKEN_ID', tokenSecret: 'MODAL_TOKEN_SECRET' },
  runloop: { apiKey: 'RUNLOOP_API_KEY' },
  vercel: {
    token: 'VERCEL_TOKEN',
    teamId: 'VERCEL_TEAM_ID',
    projectId: 'VERCEL_PROJECT_ID',
  },
  cloudflare: {
    sandboxUrl: 'CLOUDFLARE_SANDBOX_URL',
    sandboxSecret: 'CLOUDFLARE_SANDBOX_SECRET',
  },
  beam: { token: 'BEAM_TOKEN', workspaceId: 'BEAM_WORKSPACE_ID' },
  'just-bash': {},
  codesandbox: { apiKey: 'CSB_API_KEY' },
  blaxel: { apiKey: 'BL_API_KEY', workspace: 'BL_WORKSPACE' },
  namespace: { token: 'NSC_TOKEN', tokenFile: 'NSC_TOKEN_FILE' },
  hopx: { apiKey: 'HOPX_API_KEY' },
  declaw: { apiKey: 'DECLAW_API_KEY' },
  sprites: { token: 'SPRITES_TOKEN' },
  agentuity: { sdkKey: 'AGENTUITY_SDK_KEY' },
  freestyle: { apiKey: 'FREESTYLE_API_KEY' },
  'secure-exec': {},
  upstash: { apiKey: 'UPSTASH_BOX_API_KEY' },
};

function getProviderConfigFromEnv(provider: SharedProviderName): Record<string, string> {
  const map = PROVIDER_ENV_MAP[provider] || {};
  const config: Record<string, string> = {};
  for (const [configKey, envVar] of Object.entries(map)) {
    const value = process.env?.[envVar];
    if (value) config[configKey] = value;
  }
  return config;
}

/**
 * Workbench-specific provider names (includes gateway)
 */
export const PROVIDER_NAMES = [
  'gateway',
  ...SHARED_PROVIDER_NAMES,
] as const;

export type ProviderName = typeof PROVIDER_NAMES[number];

/**
 * Auth requirements for each provider
 * Extends shared config with gateway-specific auth
 */
export const PROVIDER_AUTH: Record<ProviderName, readonly (readonly string[])[]> = {
  gateway: [['COMPUTESDK_API_KEY']],
  ...SHARED_PROVIDER_AUTH,
};

/**
 * Get detailed status for a specific provider
 */
export function getProviderStatus(provider: ProviderName): ProviderStatus {
  const authOptions = PROVIDER_AUTH[provider];

  if (typeof process === 'undefined') {
    return {
      name: provider,
      isComplete: false,
      present: [],
      missing: [...authOptions[0]],
    };
  }

  // Build a set of all present env vars (checked once per unique var)
  const allVars = new Set(authOptions.flat());
  const presentSet = new Set<string>();
  for (const v of allVars) {
    if (process.env?.[v]) presentSet.add(v);
  }

  // Evaluate each auth option in a single pass
  let bestOption: { presentCount: number; missing: string[] } | null = null;

  for (const option of authOptions) {
    const missing: string[] = [];
    let presentCount = 0;

    for (const v of option) {
      if (presentSet.has(v)) {
        presentCount++;
      } else {
        missing.push(v);
      }
    }

    // If all vars present, this option is satisfied
    if (missing.length === 0) {
      return {
        name: provider,
        isComplete: true,
        present: [...presentSet],
        missing: [],
      };
    }

    // Track the option closest to completion
    if (!bestOption || presentCount > bestOption.presentCount) {
      bestOption = { presentCount, missing };
    }
  }

  return {
    name: provider,
    isComplete: false,
    present: [...presentSet],
    missing: bestOption?.missing ?? [],
  };
}

/**
 * Get all available (fully configured) providers
 */
export function getAvailableProviders(): string[] {
  return PROVIDER_NAMES.filter(provider => {
    const status = getProviderStatus(provider);
    return status.isComplete;
  });
}

/**
 * Display all providers with their status
 */
export function showProviders() {
  console.log('\n' + c.bold('Provider Status:'));

  for (const provider of PROVIDER_NAMES) {
    const status = getProviderStatus(provider);

    if (status.isComplete) {
      console.log(`  ${c.green('✅')} ${provider} - Ready`);
    } else if (status.present.length > 0) {
      const ratio = `${status.present.length}/${status.present.length + status.missing.length}`;
      console.log(`  ${c.yellow('⚠️ ')} ${provider} - Incomplete (${ratio} credentials)`);
      console.log(`      ${c.dim('Missing:')} ${status.missing.join(', ')}`);
    } else {
      console.log(`  ${c.dim('❌')} ${c.dim(provider)} - Not configured`);
    }
  }

  console.log('');
}

/**
 * Display environment status with helpful setup instructions
 */
export function showEnv() {
  console.log('\n' + c.bold('Environment Configuration:'));
  console.log('');

  for (const provider of PROVIDER_NAMES) {
    const status = getProviderStatus(provider);

    console.log(c.bold(`${provider}:`));

    if (status.isComplete) {
      console.log(`  ${c.green('✅')} All credentials present`);
      status.present.forEach(varName => {
        console.log(`     ${c.dim('•')} ${varName}`);
      });
    } else {
      if (status.present.length > 0) {
        console.log(c.dim('  Present:'));
        status.present.forEach(varName => {
          console.log(`    ${c.green('✓')} ${varName}`);
        });
      }

      if (status.missing.length > 0) {
        console.log(c.dim('  Missing:'));
        status.missing.forEach(varName => {
          console.log(`    ${c.red('✗')} ${varName}`);
        });
      }
    }

    console.log('');
  }

  console.log(c.dim('Tip: Set credentials in your .env file'));
  console.log('');
}

/**
 * Auto-detect best provider to use
 */
export function autoDetectProvider(forceGatewayMode = false): string | null {
  // Check for explicit override
  const explicit = process.env.COMPUTESDK_PROVIDER?.toLowerCase();
  if (explicit && isValidProvider(explicit) && isProviderReady(explicit)) {
    return explicit;
  }

  // If forcing gateway mode, only return gateway if available
  if (forceGatewayMode) {
    return isProviderReady('gateway') ? 'gateway' : null;
  }

  // Auto-detect based on priority order
  for (const provider of PROVIDER_NAMES) {
    if (isProviderReady(provider)) {
      return provider;
    }
  }

  return null;
}

/**
 * Validate that a provider name is valid
 */
export function isValidProvider(name: string): name is ProviderName {
  return PROVIDER_NAMES.includes(name as ProviderName);
}

/**
 * Check if provider is fully configured
 */
export function isProviderReady(provider: string): boolean {
  if (!isValidProvider(provider)) return false;
  const status = getProviderStatus(provider);
  return status.isComplete;
}

/**
 * Get helpful error message for unconfigured provider
 */
export function getProviderSetupHelp(provider: string): string {
  if (!isValidProvider(provider)) {
    return `Unknown provider: ${provider}\nAvailable: ${PROVIDER_NAMES.join(', ')}`;
  }

  const status = getProviderStatus(provider);

  if (status.isComplete) {
    return `Provider ${provider} is already configured`;
  }

  const lines = [
    `Provider ${provider} requires these environment variables:`,
    '',
    ...status.missing.map(varName => `  ${varName}`),
    '',
    'Add them to your .env file or export them in your shell.',
  ];

  return lines.join('\n');
}

/**
 * Dynamically import a provider package
 */
export async function loadProvider(providerName: ProviderName): Promise<any> {
  try {
    switch (providerName) {
      case 'gateway':
        // Gateway is built into computesdk package
        return await import('computesdk');
      case 'e2b':
        return await import('@computesdk/e2b');
      case 'railway':
        return await import('@computesdk/railway');
      case 'daytona':
        return await import('@computesdk/daytona');
      case 'modal':
        // @ts-ignore - package type declarations may be unavailable in local workbench typecheck
        return await import('@computesdk/modal');
      case 'runloop':
        return await import('@computesdk/runloop');
      case 'vercel':
        return await import('@computesdk/vercel');
      case 'cloudflare':
        // @ts-ignore - @cloudflare/sandbox types may not be available
        return await import('@computesdk/cloudflare');
      case 'beam':
        return await import('@computesdk/beam');
      case 'just-bash':
        return await import('@computesdk/just-bash');
      case 'codesandbox':
        return await import('@computesdk/codesandbox');
      case 'blaxel':
        return await import('@computesdk/blaxel');
      case 'namespace':
        // @ts-ignore - package type declarations may be unavailable in local workbench typecheck
        return await import('@computesdk/namespace');
      case 'hopx':
        return await import('@computesdk/hopx');
      case 'declaw':
        return await import('@computesdk/declaw');
      case 'sprites':
        return await import('@computesdk/sprites');
      case 'agentuity':
        return await import('@computesdk/agentuity');
      case 'freestyle':
        return await import('@computesdk/freestyle');
      case 'secure-exec':
        return await import('@computesdk/secure-exec');
      case 'upstash':
        return await import('@computesdk/upstash');
      default:
        throw new Error(`Unknown provider: ${providerName}`);
    }
  } catch (error) {
    if (providerName === 'gateway') {
      throw new Error(`Failed to load gateway provider from computesdk package.`);
    }
    throw new Error(
      `Failed to load provider ${providerName}. ` +
      `Make sure to install it: npm install @computesdk/${providerName}`
    );
  }
}

/**
 * Create provider config from environment variables
 * Uses shared PROVIDER_ENV_MAP from computesdk
 */
export function getProviderConfig(providerName: ProviderName): Record<string, string> {
  // Handle gateway separately (not in shared config)
  if (providerName === 'gateway') {
    const config: Record<string, string> = {};
    if (process.env.COMPUTESDK_API_KEY) config.apiKey = process.env.COMPUTESDK_API_KEY;
    return config;
  }

  // Use shared utility for other providers
  return getProviderConfigFromEnv(providerName as SharedProviderName);
}
