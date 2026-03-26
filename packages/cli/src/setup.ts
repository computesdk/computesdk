/**
 * Shared setup logic for CLI commands
 *
 * Resolves authentication and configures the compute client
 * for a given provider. Used by both subcommands and the REPL.
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import { compute } from 'computesdk';
import { detectAvailableProviders, getProviderStatus, buildProviderConfig, type ProviderStatus } from './providers.js';
import { resolveApiKey } from './auth.js';

/**
 * Authenticate and set COMPUTESDK_API_KEY in the environment.
 * Exits the process on failure.
 */
export async function ensureAuth(options?: { forceLogin?: boolean }): Promise<void> {
  try {
    const apiKey = await resolveApiKey({ forceLogin: options?.forceLogin });
    process.env.COMPUTESDK_API_KEY = apiKey;
  } catch (error) {
    p.log.error((error as Error).message);
    p.log.info(`Get your API key at ${pc.cyan('https://console.computesdk.com')}`);
    p.outro(pc.red('Setup incomplete'));
    process.exit(1);
  }
}

/**
 * Resolve which provider to use.
 *
 * If `--provider` is given, validates it's configured and returns it.
 * If `interactive` is true and multiple providers are available, prompts user.
 * In non-interactive mode, requires `--provider` when multiple are configured.
 * Exits the process if no providers are available.
 */
export async function resolveProvider(
  providerFlag?: string,
  options?: { interactive?: boolean },
): Promise<string> {
  const interactive = options?.interactive ?? false;
  const available = detectAvailableProviders();
  const providerStatus = getProviderStatus();

  if (providerFlag) {
    const match = providerStatus.find(
      (s: ProviderStatus) => s.name.toLowerCase() === providerFlag.toLowerCase(),
    );

    if (!match) {
      p.log.error(`Unknown provider: ${providerFlag}`);
      p.log.info(`Available providers: ${providerStatus.map((s: ProviderStatus) => s.name).join(', ')}`);
      process.exit(1);
    }

    if (!match.ready) {
      p.log.error(`Provider ${providerFlag} is not configured`);
      if (match.missing.length > 0) {
        p.log.info(`Missing env vars: ${match.missing.join(', ')}`);
      }
      process.exit(1);
    }

    return match.name;
  }

  if (available.length === 0) {
    p.log.error('No provider credentials detected');
    p.log.info('Set one of: E2B_API_KEY, MODAL_TOKEN_ID, RAILWAY_API_KEY, etc.');
    p.outro(pc.red('Setup incomplete'));
    process.exit(1);
  }

  // Single provider — no ambiguity
  if (available.length === 1) {
    return available[0];
  }

  // Multiple providers — interactive mode can prompt, non-interactive must fail
  if (!interactive) {
    p.log.error('Multiple providers configured. Use --provider to specify one.');
    p.log.info(`Available: ${available.join(', ')}`);
    process.exit(1);
  }

  const providerOptions = providerStatus
    .filter((status: ProviderStatus) => status.ready)
    .map((status: ProviderStatus) => ({
      value: status.name,
      label: status.name,
    }));

  const provider = await p.select({
    message: 'Select provider',
    options: providerOptions,
  });

  if (p.isCancel(provider)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  return provider as string;
}

/**
 * Configure the compute client for a provider.
 * Must be called after ensureAuth().
 */
export function configureCompute(provider: string): void {
  const config = buildProviderConfig(provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compute.setConfig(config as any);
}
