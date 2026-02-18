/**
 * create-compute
 *
 * Spin up a cloud sandbox and start coding.
 *
 * Usage:
 *   npx create-compute
 *   npm create compute
 */

import 'dotenv/config';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { compute, type Sandbox } from 'computesdk';
import { detectAvailableProviders, getProviderStatus, buildProviderConfig, type ProviderStatus } from './providers.js';
import { startPTY } from './pty.js';
import { startREPL } from './repl.js';
import { resolveApiKey, clearStoredCredentials } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json to get version
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

async function main() {
  console.log();

  // Handle --logout before anything else
  if (process.argv.includes('--logout')) {
    clearStoredCredentials();
    p.intro(pc.cyan(`create-compute v${packageJson.version}`));
    p.log.success('Logged out. Stored credentials removed.');
    p.outro(pc.green('Done!'));
    process.exit(0);
  }

  p.intro(pc.cyan(`create-compute v${packageJson.version}`));

  // Resolve API key: env var > stored creds > browser auth
  const forceLogin = process.argv.includes('--login');
  try {
    const apiKey = await resolveApiKey({ forceLogin });
    process.env.COMPUTESDK_API_KEY = apiKey;
  } catch (error) {
    p.log.error((error as Error).message);
    p.log.info(`Get your API key at ${pc.cyan('https://console.computesdk.com')}`);
    p.outro(pc.red('Setup incomplete'));
    process.exit(1);
  }

  // Detect available providers
  const available = detectAvailableProviders();
  const providerStatus = getProviderStatus();

  if (available.length === 0) {
    p.log.error('No provider credentials detected');
    p.log.info('Set one of: E2B_API_KEY, MODAL_TOKEN_ID, RAILWAY_API_KEY, etc.');
    p.outro(pc.red('Setup incomplete'));
    process.exit(1);
  }

  // Build provider options for select
  const providerOptions = providerStatus
    .filter((status: ProviderStatus) => status.ready)
    .map((status: ProviderStatus) => ({
      value: status.name,
      label: status.name,
    }));

  // Select provider
  const provider = await p.select({
    message: 'Select provider',
    options: providerOptions,
  });

  if (p.isCancel(provider)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  // Select mode
  const mode = await p.select({
    message: 'Select mode',
    options: [
      { 
        value: 'repl', 
        label: 'REPL',
      },
      { 
        value: 'pty', 
        label: 'Shell (PTY)',
      },
    ],
  });

  if (p.isCancel(mode)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  // Create sandbox
  const spinner = p.spinner();
  spinner.start('Creating sandbox...');

  let sandbox: Sandbox;
  try {
    // Configure compute with provider and credentials from env
    const config = buildProviderConfig(provider as string);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compute.setConfig(config as any);
    sandbox = await compute.sandbox.create();
    spinner.stop(`Sandbox ready: ${pc.cyan(sandbox.sandboxId)}`);
  } catch (error) {
    spinner.stop(pc.red('Failed to create sandbox'));
    p.log.error((error as Error).message);
    process.exit(1);
  }

  // Start selected mode
  if (mode === 'pty') {
    p.log.info('Connecting to shell... ' + pc.gray('(.exit or Ctrl+D to quit)'));
    console.log();
    await startPTY(sandbox);
  } else {
    p.log.info('Starting REPL... ' + pc.gray('(.exit or Ctrl+D to quit)'));
    console.log();
    await startREPL(sandbox, provider as string);
  }

  // Cleanup
  const cleanupSpinner = p.spinner();
  cleanupSpinner.start('Cleaning up...');
  
  try {
    await sandbox.destroy();
    cleanupSpinner.stop('Sandbox destroyed');
  } catch {
    cleanupSpinner.stop(pc.yellow('Cleanup warning'));
  }

  p.outro(pc.green('Done!'));
}

main().catch((error) => {
  console.error(pc.red(`\nError: ${error.message}`));
  process.exit(1);
});
