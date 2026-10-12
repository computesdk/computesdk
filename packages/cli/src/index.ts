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
 *   compute instances …                  # platform compute-instance control plane
 *     (alias: compute sandboxes, compute sbx)
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

// stdout closed early (`compute … | jq -r`, `| head`): exit quietly — the
// consumer already has what it wanted. stderr closed: swallow the write
// error but let the command finish, so a failed command keeps its nonzero
// exit instead of masking as success. Other stream errors still throw.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});
process.stderr.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  throw err;
});

const program = new Command();

program
  .name('compute')
  .description('ComputeSDK CLI')
  .version(VERSION)
  .enablePositionalOptions()
  .passThroughOptions();

function envBaseUrl(): string | undefined {
  return process.env.COMPUTE_PLATFORM_URL ?? process.env.BENCHMARKS_PLATFORM_URL;
}

async function benchAuth(opts: { baseUrl?: string } = {}) {
  const { resolveAuth } = await import('@benchsdk/cli');
  return resolveAuth({ baseUrl: opts.baseUrl ?? envBaseUrl() });
}

async function printSessionLine(options?: { baseUrl?: string }): Promise<void> {
  try {
    const { getMe } = await import('@benchsdk/cli');
    const me = await getMe(await benchAuth({ baseUrl: options?.baseUrl }));
    const active = me.organizations.find((o) => o.id === me.activeOrganizationId);
    const who = me.user.email ?? me.user.name ?? me.user.id;
    if (active) {
      p.log.success(
        `Logged in as ${who} — active org: ${active.slug}. Change with \`compute org use <slug>\`.`,
      );
    } else {
      p.log.success(`Logged in as ${who} — no active org`);
    }
  } catch {
    p.log.warn('Logged in, but could not fetch session info.');
  }
}

// `compute login` and `bench auth login` are the same login: the
// `benchsdk-cli` OAuth client with the full first-party scope set, stored
// once in ~/.benchsdk/credentials.json.
async function runLogin(options?: { baseUrl?: string }): Promise<void> {
  const { oauthLogin } = await import('@benchsdk/cli');
  await oauthLogin({
    baseUrl: options?.baseUrl ?? envBaseUrl(),
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
  .option('--org <slug>', 'organization slug override for this invocation (or $COMPUTE_ORG)')
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
      await printSessionLine();
      p.outro(pc.green('Authenticated!'));
      process.exit(0);
    }

    // Show help by default
    program.help();
  });

// `compute --org <slug> <group> …` (leading position): forward to the env the
// client layer reads. A trailing --org on the subcommand still wins —
// resolveActionsAuth reads opts.org before COMPUTE_ORG.
program.hook('preAction', (thisCommand) => {
  const org = thisCommand.opts().org;
  if (org) process.env.COMPUTE_ORG = org;
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
    await printSessionLine({ baseUrl: opts.baseUrl });
    p.outro(pc.green('Authenticated!'));
  });

program
  .command('logout')
  .description('Clear stored credentials')
  .option('--json', 'print machine-readable JSON')
  .action(async (opts) => {
    await runLogout();
    if (opts.json) {
      console.log(JSON.stringify({ loggedOut: true }, null, 2));
      return;
    }
    console.log();
    p.intro(pc.cyan(`@computesdk/cli v${VERSION}`));
    p.log.success('Logged out. Stored credentials removed.');
    p.outro(pc.green('Done!'));
  });

// ─── org ────────────────────────────────────────────────────────────────────
// Mirrors `bench org` — same credential store and /api/v1/organizations calls
// through @benchsdk/cli. The active org is per user+client, shared by every
// CLI on every machine.

async function printWhoami(options: { json?: boolean; baseUrl?: string } = {}): Promise<void> {
  const { getMe } = await import('@benchsdk/cli');
  const me = await getMe(await benchAuth({ baseUrl: options.baseUrl }));
  if (options.json) {
    console.log(JSON.stringify(me, null, 2));
    return;
  }
  const active = me.organizations.find((o) => o.id === me.activeOrganizationId);
  console.log(me.user.email ?? me.user.name ?? me.user.id);
  console.log(
    `active org: ${active ? `${active.slug} (${active.id})` : '—'}${me.organizations.length > 1 ? '  — change with `compute org use <slug>`' : ''}`,
  );
}

const org = program.command('org').description('Manage the active organization');

org
  .command('list')
  .description('List your organizations')
  .option('--json', 'print machine-readable JSON')
  .action(async (opts) => {
    const { listOrganizations, getMe } = await import('@benchsdk/cli');
    const auth = await benchAuth();
    const [organizations, me] = await Promise.all([listOrganizations(auth), getMe(auth)]);
    if (opts.json) {
      console.log(JSON.stringify(organizations, null, 2));
      return;
    }
    for (const o of organizations) {
      const marker = o.id === me.activeOrganizationId ? pc.green('*') : ' ';
      console.log(`${marker} ${pc.cyan(o.slug)}  ${o.name ?? ''}  ${pc.dim(o.id)}`);
    }
  });

org
  .command('use <slug>')
  .description('Set the active organization (persisted to the stored login)')
  .action(async (slug: string) => {
    const { loadCredentials, saveCredentials, createApiClient, setActiveOrganization } =
      await import('@benchsdk/cli');
    const credentials = (await loadCredentials()) ?? {};
    const { auth } = await createApiClient({ baseUrl: envBaseUrl() });
    const result = await setActiveOrganization(auth, slug);
    if (!result.organization) {
      throw new Error(`Could not set active organization to ${slug}`);
    }
    await saveCredentials({
      ...credentials,
      baseUrl: auth.baseUrl,
      // An API-key login must not be rewritten as an OAuth one — keep its
      // key and kind, and only stamp token fields when this auth actually
      // is a token session.
      ...(auth.token
        ? {
            token: auth.token,
            refreshToken: auth.refreshToken,
            tokenExpiresAt: auth.tokenExpiresAt,
            refreshExpiresAt: auth.refreshExpiresAt,
            kind: 'oauth' as const,
          }
        : {}),
      orgSlug: result.organization.slug,
      orgId: result.organization.id,
    });
    console.log(`Active organization set to ${result.organization.slug} (${result.organization.id})`);
  });

org
  .command('current')
  .description('Show the current user and active organization')
  .option('--base-url <url>', 'platform URL to query')
  .option('--json', 'print machine-readable JSON')
  .action((opts) => printWhoami(opts));

program
  .command('whoami')
  .description('Show the current user and active organization')
  .option('--base-url <url>', 'platform URL to query')
  .option('--json', 'print machine-readable JSON')
  .action((opts) => printWhoami(opts));

// ─── actions ─────────────────────────────────────────────────────────────────

registerActionsCommands(program);

// ─── market ──────────────────────────────────────────────────────────────────
// `compute market` is the sell side of the compute market — same platform
// API and auth as `compute actions`, for orgs flagged `market_provider`.

registerMarketCommands(program);

// ─── sandboxes ───────────────────────────────────────────────────────────────
// `compute instances` (alias `compute sandboxes`/`sbx`) drives
// /api/v1/sandboxes — the customer-facing compute control plane
// (create/exec/processes/files/urls). Same auth as actions.

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
