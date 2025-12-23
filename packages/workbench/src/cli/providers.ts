/**
 * Provider detection and management for workbench
 *
 * Uses shared provider config from computesdk as single source of truth
 */

import type { ProviderStatus } from './types.js';
import { c } from './output.js';
import {
  PROVIDER_AUTH as SHARED_PROVIDER_AUTH,
  PROVIDER_NAMES as SHARED_PROVIDER_NAMES,
  PROVIDER_ENV_MAP,
  type ProviderName as SharedProviderName,
  isProviderAuthComplete,
  getMissingEnvVars,
  getProviderConfigFromEnv,
} from 'computesdk';

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
        return await import('@computesdk/modal');
      case 'runloop':
        return await import('@computesdk/runloop');
      case 'vercel':
        return await import('@computesdk/vercel');
      case 'cloudflare':
        return await import('@computesdk/cloudflare');
      case 'codesandbox':
        return await import('@computesdk/codesandbox');
      case 'blaxel':
        return await import('@computesdk/blaxel');
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
