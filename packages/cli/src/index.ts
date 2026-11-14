/**
 * @computesdk/cli
 *
 * ComputeSDK CLI — platform commands and the benchmarks CLI.
 *
 * Usage:
 *   compute login                        # OAuth device login (benchsdk-cli)
 *   compute logout                       # clear stored credentials
 *   compute providers                    # SDK provider credentials in this environment
 *   compute byok …                       # the org's BYOK provider keys and custom rates
 *   compute org …                        # active org, members, invitations
 *   compute invitations …                # your own invitations (show/accept/decline)
 *   compute actions …                    # Actions API
 *   compute credits [ledger | topup <usd>] # prepaid credit, which managed accounts bill from
 *   compute market …                     # not generally available (hidden from help)
 *   compute new [vercel | --vercel]      # create a sandbox (short for `compute sandboxes create`)
 *   compute instances …                  # platform compute-instance control plane
 *     (alias: compute sandboxes, compute sbx)
 *   compute bench …                      # benchmarks platform CLI (runs, results, fork, …)
 */

import 'dotenv/config';
import { Command, Option } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getProviderStatus } from './providers.js';
import { registerActionsCommands } from './actions.js';
import { registerByokCommands } from './byok.js';
import { registerMarketCommands } from './market.js';
import { registerCreditsCommands } from './credits.js';
import { inheritParentOptions } from './option-inheritance.js';
import { registerSandboxesCommands } from './sandboxes.js';
import { registerAgentsCommands } from './agents.js';
import { fail } from './actions.js';
import { registerStatusCommand } from './status.js';
import { login, clearPendingLogins, type LoginOptions } from './login.js';
import { parseBenchDispatch, runBench } from './bench.js';
import { registerManifestCommand } from './manifest.js';
import { registerInvitationsCommands, registerOrgMemberCommands } from './org-members.js';
import { benchAuth, envBaseUrl, fetchWhoami, formatWhoami } from './session.js';

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
// `compute credits --org x topup 50`: a parent's flags reach the subcommand.
inheritParentOptions(program);

program
  .name('compute')
  .description('ComputeSDK CLI')
  .version(VERSION, '-v, --version', 'print the CLI version')
  .enablePositionalOptions()
  .passThroughOptions();

// Keep the previous uppercase shorthand compatible as well.
program.addOption(new Option('-V', 'print the CLI version').hideHelp());
program.on('option:V', () => { console.log(VERSION); process.exit(0); });
program.addHelpText('before', 'Run code on a cloud sandbox:\n  compute new\n  compute exec echo hello\n  compute destroy\n');

// Reports the OAuth login just made, so it reads the stored login rather
// than COMPUTE_API_KEY.
async function printSessionLine(options?: { baseUrl?: string }): Promise<void> {
  try {
    const { getMe, resolveAuth } = await import('@benchsdk/cli');
    const me = await getMe(await resolveAuth({ baseUrl: options?.baseUrl ?? envBaseUrl() }));
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
async function runLogin(options?: LoginOptions): Promise<void> {
  await login(options);
}

async function runLogout(): Promise<void> {
  const { clearCredentials } = await import('@benchsdk/cli');
  await clearCredentials();
  clearPendingLogins();
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
  .option('--no-browser', 'print the sign-in URL instead of opening a browser')
  .option('--json', 'return a sign-in URL and code immediately; use --wait to complete login')
  .option('--wait', 'wait for approval (default without --json)')
  .option('--new', 'replace the pending sign-in with a new code')
  .action(async (opts) => {
    try { await runLogin(opts); } catch (error) { fail(error, opts); return; }
    if (opts.json) return;
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
  const me = await fetchWhoami(await benchAuth({ baseUrl: options.baseUrl }));
  if (options.json) {
    console.log(JSON.stringify(me, null, 2));
    return;
  }
  for (const line of formatWhoami(me)) console.log(line);
}

const org = program.command('org').description('Manage the active organization, its members and invitations');

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
    // The switch belongs to the stored user login: COMPUTE_API_KEY (an org
    // key, no user) must not stand in for it, so only the URL is overridden.
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

// members / invitations / invite / member set-role|remove / leave, over the
// v1 organization routes with the `current` org alias (src/org-members.ts).
registerOrgMemberCommands(org);

program
  .command('whoami')
  .description('Show the current user and active organization')
  .option('--base-url <url>', 'platform URL to query')
  .option('--json', 'print machine-readable JSON')
  .action((opts) => printWhoami(opts));

// ─── invitations ─────────────────────────────────────────────────────────────
// The signed-in user's own invitations: list, show, accept, decline.

registerInvitationsCommands(program);

// ─── actions ─────────────────────────────────────────────────────────────────

registerActionsCommands(program);

// ─── byok ────────────────────────────────────────────────────────────────────
// `compute byok` drives /api/v1/providers — the org's BYOK provider keys and
// custom rates, shared by Actions and sandboxes (src/byok.ts).

registerByokCommands(program);

// ─── market ──────────────────────────────────────────────────────────────────
// `compute market` is the sell side of the compute market — same platform
// API and auth as `compute actions`, for orgs flagged `market_provider`.

registerMarketCommands(program);

// ─── credits ─────────────────────────────────────────────────────────────────
// `compute credits` — prepaid credit (balance, ledger, top-ups), which managed
// accounts bill from (src/credits.ts).
registerCreditsCommands(program);
registerStatusCommand(program);

// ─── sandboxes ───────────────────────────────────────────────────────────────
// `compute instances` (alias `compute sandboxes`/`sbx`) drives
// /api/v1/sandboxes — the customer-facing compute control plane
// (create/exec/processes/files/urls). Same auth as actions.

registerSandboxesCommands(program);

// ─── agents ──────────────────────────────────────────────────────────────────
// `compute agents` (alias `ag`) drives /api/v1/agents — managed agents:
// durable configs whose sessions run inside routed sandboxes. Same auth.

registerAgentsCommands(program);

// ─── bench ───────────────────────────────────────────────────────────────────
// `compute bench` is the benchmarks-platform CLI (@benchsdk/runner's `bench`
// binary) folded under compute: run/check/auth/org/benchmarks/runs/results/
// fork/iterations/artifacts/logs/export all dispatch through it,
// with COMPUTE_PLATFORM_URL, COMPUTE_API_KEY and COMPUTE_ORG/--org forwarded
// (src/bench.ts).

program
  .command('bench')
  .description('Benchmarks platform CLI (run, auth, org, benchmarks, runs, results, fork, artifacts, export, ...)')
  .allowUnknownOption()
  .helpOption(false)
  .action(() => {
    // Never reached: bench args are dispatched pre-parse below.
  });

// ─── __manifest (hidden) ─────────────────────────────────────────────────────
// Regenerate the committed cli-manifest.json with
// `pnpm --filter @computesdk/cli run manifest` after changing commands.

registerManifestCommand(program, {
  version: packageJson.version,
  packageDir: join(__dirname, '..'),
});

// ─── Run ─────────────────────────────────────────────────────────────────────

// Bench args are opaque to commander (its own --flags, `--` separators, file
// paths), so they dispatch before parsing — including `compute --org x bench`.
// `@benchsdk/runner`'s run() owns the process — it exits itself after dispatch.
async function main() {
  const bench = parseBenchDispatch(process.argv.slice(2));
  if (bench) {
    await runBench(bench);
    return;
  }
  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(pc.red(`\nError: ${error.message}`));
  process.exit(1);
});
