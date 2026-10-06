/**
 * @computesdk/cli
 *
 * ComputeSDK CLI — platform commands and the benchmarks CLI.
 *
 * Usage:
 *   compute login                        # OAuth device login (benchsdk-cli)
 *   compute logout                       # clear stored credentials
 *   compute providers                    # list configured providers
 *   compute actions …                    # Actions API
 *   compute market …                     # market sell-side commands
 *   compute sandboxes …                  # platform sandbox control plane
 *   compute bench …                      # benchmarks platform CLI
 */

import 'dotenv/config';
import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getProviderStatus } from './providers.js';
import { registerActionsCommands } from './actions.js';
import { registerMarketCommands } from './market.js';
import { registerSandboxesCommands } from './sandboxes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

// Detect if running from dev workspace
const isDevBuild = import.meta.url.includes('worktrees') ||
                   import.meta.url.includes('/packages/cli/');
const VERSION = isDevBuild ? `${packageJson.version}-dev` : packageJson.version;

const program = new Command();

program
  .name('compute')
  .description('ComputeSDK CLI')
  .version(VERSION)
  .enablePositionalOptions()
  .passThroughOptions();

// `compute` fronts the Actions, Sandboxes and Market CLIs, so its login needs
// the full first-party scope set on the `benchsdk-cli` OAuth client.
const COMPUTE_OAUTH_CLIENT_ID = 'benchsdk-cli';
const COMPUTE_OAUTH_SCOPE = [
  'actions:read',
  'actions:write',
  'benchmarks:read',
  'benchmarks:write',
  'billing:read',
  'market:read',
  'market:write',
  'org:read',
  'org:admin',
  'sandboxes:read',
  'sandboxes:write',
  'vault:read',
  'vault:write',
  'offline_access',
].join(' ');

async function runLogin(options?: { baseUrl?: string }): Promise<void> {
  const { oauthLogin } = await import('@benchsdk/cli');
  await oauthLogin({
    clientId: COMPUTE_OAUTH_CLIENT_ID,
    scope: COMPUTE_OAUTH_SCOPE,
    baseUrl: options?.baseUrl,
  });
}

async function runLogout(): Promise<void> {
  const { clearCredentials } = await import('@benchsdk/cli');
  await clearCredentials();
}

// ─── Default action: Show help ─────────────────────────────────────────────

program
  .option('--login', 'force re-authentication')
  .option('--logout', 'clear stored credentials')
  .action(async (opts) => {
    if (opts.logout) {
      console.log();
      p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
      await runLogout();
      p.log.success('Logged out. Stored credentials removed.');
      p.outro(pc.green('Done!'));
      process.exit(0);
    }

    if (opts.login) {
      console.log();
      p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
      await runLogin();
      p.outro(pc.green('Authenticated!'));
      process.exit(0);
    }

    // Show help by default
    program.help();
  });

// ─── providers ───────────────────────────────────────────────────────────────

program
  .command('providers')
  .description('List all providers and their configuration status')
  .action(async () => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));

    const statuses = getProviderStatus();

    console.log();
    for (const status of statuses) {
      const icon = status.ready ? pc.green('●') : pc.gray('○');
      const name = status.ready ? pc.white(status.name) : pc.gray(status.name);
      const detail = status.ready
        ? pc.green('ready')
        : pc.gray(`missing: ${status.missing.join(', ')}`);
      console.log(`  ${icon} ${name}  ${detail}`);
    }
    console.log();
  });

// ─── login / logout ──────────────────────────────────────────────────────────

program
  .command('login')
  .description('Authenticate with ComputeSDK (OAuth device flow)')
  .option('--base-url <url>', 'platform URL to authenticate against')
  .action(async (opts) => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
    await runLogin({ baseUrl: opts.baseUrl });
    p.outro(pc.green('Authenticated!'));
  });

program
  .command('logout')
  .description('Clear stored credentials')
  .action(async () => {
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
    await runLogout();
    p.log.success('Logged out. Stored credentials removed.');
    p.outro(pc.green('Done!'));
  });

// ─── actions ─────────────────────────────────────────────────────────────────

registerActionsCommands(program);

// ─── market ──────────────────────────────────────────────────────────────────
// `compute market` is the sell side of the compute market — same platform
// API and auth as `compute actions`, for orgs flagged `market_provider`.

registerMarketCommands(program);

// ─── sandboxes ───────────────────────────────────────────────────────────────
// `compute sandboxes` drives /api/v1/sandboxes — the customer-facing sandbox
// control plane (create/exec/processes/files/urls). Same auth as actions.

registerSandboxesCommands(program);

// ─── bench ───────────────────────────────────────────────────────────────────
// `compute bench` is the benchmarks-platform CLI (@benchsdk/runner's `bench`
// binary) folded under compute: run/check/auth/org/benchmarks/runs/results/
// iterations/artifacts/logs/export all dispatch through it.

program
  .command('bench')
  .description('Benchmarks platform CLI (run, auth, org, benchmarks, runs, results, artifacts, export, ...)')
  .allowUnknownOption()
  .helpOption(false)
  .action(() => {
    // Never reached: bench args are dispatched pre-parse below.
  });

// ─── Run ─────────────────────────────────────────────────────────────────────

// Bench args are opaque to commander (its own --flags, `--` separators, file
// paths), so they dispatch before parsing. `@benchsdk/runner`'s run() owns the
// process — it exits itself after dispatch.
async function main() {
  if (process.argv[2] === 'bench' || process.argv[2] === 'benchmark') {
    const { run: benchRun } = await import('@benchsdk/runner');
    await benchRun(process.argv.slice(3));
    return;
  }
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(pc.red(`\nError: ${error.message}`));
  process.exit(1);
});
