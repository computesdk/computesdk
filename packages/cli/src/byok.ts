/**
 * `compute byok` — the org's BYOK providers over `/api/v1/providers`: the
 * providers it brings its own key for, each key's state, and the org's custom
 * rate. Keys and custom rates serve every product that places sandboxes
 * (Actions jobs and sandbox creates alike), which is why they live here and
 * not under `compute actions` or `compute instances`.
 *
 * A custom rate is the org's own number for cost reporting (typically what it
 * pays the provider). Sandbox costs on that provider are reported at it
 * instead of the platform rate; it never changes what the org is billed.
 *
 * `compute providers` is a different thing: the provider credentials in the
 * local environment that the SDK would use.
 */

import type { Command } from 'commander';
import pc from 'picocolors';
import { output, client, fail, parseInputs, secretValueClient, usageErrorOutput, type CommonOpts } from './actions.js';
import { confirmWrite } from './confirm.js';
import { formatRateAllUnits, type RateAllUnits, type RatePer } from './rate-display.js';
import { safeTerm } from './term.js';

// Wire shapes: benchmarks-platform lib/providers/byok-wire.ts.

export interface ProviderRate {
  usd: number;
  per: RatePer;
  rateUsd: RateAllUnits;
}

export interface ByokKey {
  provider: string;
  /** Masked tail of the stored key; null when none is stored. Never the key. */
  keyHint: string | null;
  lastCheckedAt: string | null;
  status: 'connected' | 'unconfigured' | 'error';
  statusDetail: string | null;
  actCapable: boolean;
  credential: 'key';
  fields: Array<{ name: string; label: string; placeholder?: string; secret: boolean; required?: boolean }>;
  /** Region-keyed credentials (archil): each region's masked hint. */
  pairs?: Array<{ region: string; keyHint: string | null }>;
}

export interface ByokProvider {
  provider: string;
  regions: string[];
  key: ByokKey;
  /** What costs are reported at: `customRate` when set, else `platformRate`. */
  rate: ProviderRate;
  customRate: ProviderRate | null;
  platformRate: ProviderRate;
}

export interface ByokKeyResponse {
  key: ByokKey;
  /** Present on the verify response. */
  verified?: boolean;
}

const RATE_UNITS: RatePer[] = ['second', 'minute', 'hour'];
const MAX_RATE_USD = 1_000;

function providerPath(provider: string, rest = ''): string {
  return `/api/v1/providers/${encodeURIComponent(provider)}${rest}`;
}

function keyText(key: ByokKey): string {
  if (key.keyHint === null) return pc.gray('no key');
  const status =
    key.status === 'connected' ? pc.green('connected') : key.status === 'error' ? pc.red('error') : pc.yellow('untested');
  const hints = key.pairs?.length
    ? key.pairs.map((p) => `${safeTerm(p.keyHint ?? '—')}@${safeTerm(p.region)}`).join(',')
    : safeTerm(key.keyHint);
  return `${status} ${pc.dim(hints)}`;
}

function rateText(p: ByokProvider): string {
  return p.customRate
    ? `${formatRateAllUnits(p.customRate.rateUsd)} ${pc.cyan('custom')}`
    : `${formatRateAllUnits(p.platformRate.rateUsd)} ${pc.dim('platform')}`;
}

/** `● blaxel  connected …abcd  $0.1008/hr · … platform`. */
export function formatByokRow(p: ByokProvider): string {
  const ready = p.key.status === 'connected';
  const icon = ready ? pc.green('●') : pc.gray('○');
  const name = ready ? pc.white(p.provider) : pc.gray(p.provider);
  return `  ${icon} ${name}  ${keyText(p.key)}  ${rateText(p)}`;
}

export function formatByokDetail(p: ByokProvider): string {
  const lines = [
    `${pc.white(p.provider)}  ${keyText(p.key)}`,
    `  regions        ${p.regions.length > 0 ? p.regions.join(', ') : 'account default'}`,
    `  last tested    ${p.key.lastCheckedAt ?? '—'}`,
    `  platform rate  ${formatRateAllUnits(p.platformRate.rateUsd)}`,
    `  custom rate    ${p.customRate ? formatRateAllUnits(p.customRate.rateUsd) : pc.dim('none (costs report at the platform rate)')}`,
  ];
  if (p.key.status === 'error' && p.key.statusDetail) lines.push(`  last error     ${pc.dim(safeTerm(p.key.statusDetail))}`);
  return lines.join('\n');
}

export function formatByokVerify(r: ByokKeyResponse): string {
  const head = r.verified === true ? pc.green('verified') : pc.red('not verified');
  const detail = r.key.statusDetail ? pc.dim(`  ${safeTerm(r.key.statusDetail)}`) : '';
  const act = r.key.actCapable ? pc.green('  act-capable') : '';
  return `${head}  ${r.key.provider}${act}${detail}`;
}

/** `<usd>` and `--per` as the rate route takes them; refuses what the server would. */
export function parseRateArgs(usd: string, per: string | undefined): { usd: number; per: RatePer } {
  const amount = Number(usd);
  if (usd.trim() === '' || !Number.isFinite(amount) || amount < 0 || amount > MAX_RATE_USD) {
    throw new Error(`<usd> must be a number from 0 to ${MAX_RATE_USD}`);
  }
  const unit = (per ?? 'hour') as RatePer;
  if (!RATE_UNITS.includes(unit)) throw new Error('--per must be second, minute or hour');
  return { usd: amount, per: unit };
}

/** The `PUT …/key` body from `--key` or `--field name=value`. */
export function keyBody(opts: { key?: string; field?: string[] }): Record<string, unknown> {
  if (opts.field !== undefined) {
    if (opts.key !== undefined) throw new Error('Pass either --key or --field, not both.');
    return { fields: parseInputs(opts.field) };
  }
  if (opts.key !== undefined) return { key: opts.key };
  throw new Error('Pass --key <key> or --field name=value.');
}

export function registerByokCommands(program: Command): void {
  const byok = program
    .command('byok')
    .description("The org's BYOK providers: their keys and custom rates, shared by Actions and sandboxes")
    .configureOutput({ outputError: usageErrorOutput });

  const common = (cmd: Command) =>
    cmd
      .option('--api-key <key>', 'API key (default: $COMPUTE_API_KEY)')
      .option('--base-url <url>', 'API base URL (default: https://platform.computesdk.com)')
      .option('--org <slug>', 'organization slug for this command (or $COMPUTE_ORG)')
      .option('--allow-untrusted-host', 'send an explicit --api-key/env key to a non-computesdk, non-localhost --base-url (stored login credentials are never sent)')
      .option('--json', 'print machine-readable JSON');

  const list = async (opts: CommonOpts) => {
    try {
      const data = await (await client(opts)).get<{ providers: ByokProvider[] }>('/api/v1/providers');
      output(opts, data, (d) => {
        for (const p of d.providers) console.log(formatByokRow(p));
      });
    } catch (e) {
      fail(e, opts);
    }
  };
  common(byok).action(list);
  common(byok.command('list').alias('ls').description('Every provider the org may bring a key for, with key state and rate')).action(list);

  common(
    byok
      .command('show')
      .description("One provider's key state, platform rate and custom rate")
      .argument('<provider>', 'provider id (e.g. tensorlake, blaxel)'),
  ).action(async (provider: string, opts: CommonOpts) => {
    try {
      const data = await (await client(opts)).get<{ provider: ByokProvider }>(providerPath(provider));
      output(opts, data, (d) => console.log(formatByokDetail(d.provider)));
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    byok
      .command('configure')
      .description("Save the org's key for a provider; untested until verified (owner/admin)")
      .argument('<provider>', 'provider id (e.g. tensorlake, blaxel)')
      .option('--key <key>', 'provider API key (single-field credentials)')
      .option('--field <pair...>', 'credential fields as name=value (multi-field providers)')
      .option('--verify', 'test the key with a real sandbox after saving'),
  ).action(async (provider: string, opts: CommonOpts & { key?: string; field?: string[]; verify?: boolean }) => {
    try {
      // A provider key is a local secret: trusted hosts only, even with --allow-untrusted-host.
      const c = await secretValueClient(opts, 'provider keys');
      const saved = await c.put<ByokKeyResponse>(providerPath(provider, '/key'), keyBody(opts));
      const verification = opts.verify ? await c.post<ByokKeyResponse>(providerPath(provider, '/verify')) : undefined;
      output(opts, verification ? { key: saved.key, verification } : saved, () => {
        console.log(`saved  ${saved.key.provider}  ${pc.dim(saved.key.keyHint ?? '')}  ${saved.key.status}`);
        if (verification) console.log(formatByokVerify(verification));
      });
      if (verification?.verified === false) process.exitCode = 1;
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    byok
      .command('verify')
      .description('Test the stored key by placing a real sandbox with it ("Test" in Settings; owner/admin)')
      .argument('<provider>', 'provider id'),
  ).action(async (provider: string, opts: CommonOpts) => {
    try {
      const result = await (await client(opts)).post<ByokKeyResponse>(providerPath(provider, '/verify'));
      output(opts, result, (r) => console.log(formatByokVerify(r)));
      if (result.verified === false) process.exitCode = 1;
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    byok
      .command('remove')
      .alias('rm')
      .description("Delete the org's stored key for a provider; nothing places on it until a new key passes (owner/admin)")
      .argument('<provider>', 'provider id')
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (provider: string, opts: CommonOpts & { yes?: boolean }) => {
    try {
      await confirmWrite(`Remove the ${provider} key? Sandboxes and Actions jobs stop placing on ${provider}.`, opts);
      const result = await (await client(opts)).del<{ provider: string; deleted: boolean }>(providerPath(provider, '/key'));
      output(opts, result, (r) => console.log(`deleted  ${r.provider}`));
    } catch (e) {
      fail(e, opts);
    }
  });

  const rate = byok
    .command('rate')
    .description('Custom rates: report sandbox costs at your own price. Reporting only; billing is unchanged');

  common(
    rate
      .command('set')
      .description("Report a provider's sandbox costs at your own rate, e.g. what you pay it (owner/admin). Doesn't change what you're billed")
      .argument('<provider>', 'provider id')
      .argument('<usd>', 'the rate in USD')
      .option('--per <unit>', 'second, minute or hour', 'hour'),
  ).action(async (provider: string, usd: string, opts: CommonOpts & { per?: string }) => {
    try {
      const body = parseRateArgs(usd, opts.per);
      const data = await (await client(opts)).put<{ provider: ByokProvider }>(providerPath(provider, '/rate'), body);
      output(opts, data, (d) => {
        console.log(`${d.provider.provider} costs now report at ${formatRateAllUnits(d.provider.rate.rateUsd)}`);
        console.log(pc.dim('Reporting only: billing is unchanged. Applies to sandboxes created from now on.'));
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    rate
      .command('clear')
      .description("Drop a provider's custom rate; its costs report at the platform rate again (owner/admin)")
      .argument('<provider>', 'provider id'),
  ).action(async (provider: string, opts: CommonOpts) => {
    try {
      const data = await (await client(opts)).del<{ provider: ByokProvider }>(providerPath(provider, '/rate'));
      output(opts, data, (d) =>
        console.log(`${d.provider.provider} costs now report at the platform rate, ${formatRateAllUnits(d.provider.platformRate.rateUsd)}`),
      );
    } catch (e) {
      fail(e, opts);
    }
  });
}
