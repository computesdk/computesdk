/**
 * `compute instances costs` and `compute instances rates [set|rm]` — the org's
 * sandbox spend (`GET /api/v1/sandboxes/costs`) and its per-provider rate
 * table (`GET|PUT|DELETE /api/v1/sandboxes/rates`).
 *
 * Removing an override asks for confirmation (`-y` off a terminal); setting
 * one does not, because the previous rate is one `rates set` away.
 */

import type { Command } from 'commander';
import { ActionsCliError, type ActionsClient } from './actions-client.js';
import type { CommonOpts } from './actions.js';
import { confirmWrite } from './confirm.js';
import { formatMoney, formatUsd, formatUsdPer, type RateAllUnits, type RatePer } from './rate-display.js';

/** Injected by `sandboxes.ts`, matching the settings commands. */
export interface BillingDeps {
  client: (opts: CommonOpts) => Promise<ActionsClient>;
  output: <T>(opts: CommonOpts, data: T, render: (data: T) => void) => void;
  fail: (error: unknown, opts?: CommonOpts) => never;
}

// Wire shapes mirror benchmarks-platform lib/sandboxes/router.ts
// (`OrgSandboxCosts`) and lib/sandboxes/rates.ts (`ResolvedRate`).

export interface SandboxCosts {
  currency: string;
  running: { count: number; costUsd: number };
  settled: { count: number; costUsd: number };
  totalUsd: number;
  byProvider: Array<{
    provider: string;
    count: number;
    costUsd: number;
    /** Absent on servers that predate the per-provider split. */
    running?: { count: number; costUsd: number };
    settled?: { count: number; costUsd: number };
  }>;
}

export type RateSource = 'organization' | 'platform' | 'builtin';

export interface ResolvedRate {
  provider: string;
  usd: number;
  per: RatePer;
  rateUsd: RateAllUnits;
  source: RateSource;
  /** What removing the org's override falls back to; null without an override. */
  fallback: { usd: number; per: RatePer; source: Exclude<RateSource, 'organization'> } | null;
}

export interface RatesResponse {
  rates: ResolvedRate[];
}

const RATE_UNITS: readonly RatePer[] = ['second', 'minute', 'hour'];
const AMOUNT = /^\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * `rates set` input: `<usd>/<unit>` as one argument, or `--usd` with `--per`.
 * Zero is a valid rate (the server takes 0..1000 per unit).
 */
export function parseRateArg(
  rate: string | undefined,
  flags: { usd?: string; per?: string },
): { usd: number; per: RatePer } {
  let usdText: string | undefined;
  let per: string | undefined;
  if (rate !== undefined) {
    if (flags.usd !== undefined || flags.per !== undefined) {
      throw new ActionsCliError('invalid_argument', 'Pass the rate as <usd>/<unit> or as --usd and --per, not both.');
    }
    const slash = rate.indexOf('/');
    if (slash === -1) {
      throw new ActionsCliError(
        'invalid_argument',
        `Invalid rate "${rate}" — a unit is required: <usd>/<unit> (e.g. 0.5/hour).`,
      );
    }
    usdText = rate.slice(0, slash);
    per = rate.slice(slash + 1);
  } else {
    if (flags.usd === undefined) {
      throw new ActionsCliError('invalid_argument', 'Missing rate — pass <usd>/<unit> (e.g. 0.5/hour) or --usd and --per.');
    }
    if (flags.per === undefined) throw new ActionsCliError('invalid_argument', '--usd requires --per.');
    usdText = flags.usd;
    per = flags.per;
  }
  const usd = Number(usdText);
  if (!AMOUNT.test(usdText) || !Number.isFinite(usd)) {
    throw new ActionsCliError('invalid_argument', `Invalid amount "${usdText}" — expected a dollar amount like 0.5.`);
  }
  if (!(RATE_UNITS as readonly string[]).includes(per)) {
    throw new ActionsCliError('invalid_argument', `Invalid unit "${per}" — the unit must be second, minute or hour.`);
  }
  return { usd, per: per as RatePer };
}

function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(header));
  for (const row of rows) console.log(line(row));
}

/** Older servers send no per-provider running / settled split; those cells show `—`. */
export function printCosts(c: SandboxCosts, customerOnly: boolean): void {
  if (customerOnly) console.log('customer sandboxes only');
  printTable(
    ['PROVIDER', 'SANDBOXES', 'RUNNING', 'RUNNING COST', 'SETTLED', 'TOTAL'],
    [
      [
        'all',
        String(c.running.count + c.settled.count),
        String(c.running.count),
        formatMoney(c.running.costUsd),
        `${c.settled.count} · ${formatMoney(c.settled.costUsd)}`,
        formatMoney(c.totalUsd),
      ],
      ...c.byProvider.map((p) => [
        p.provider,
        String(p.count),
        p.running ? String(p.running.count) : '—',
        p.running ? formatMoney(p.running.costUsd) : '—',
        p.settled ? `${p.settled.count} · ${formatMoney(p.settled.costUsd)}` : '—',
        formatMoney(p.costUsd),
      ]),
    ],
  );
  if (c.currency !== 'USD') console.log(`currency: ${c.currency}`);
}

export function printRates(r: RatesResponse): void {
  if (r.rates.length === 0) {
    console.log('No providers.');
    return;
  }
  printTable(
    ['PROVIDER', 'RATE', 'PER', 'SOURCE', 'FALLBACK'],
    r.rates.map((rate) => [
      rate.provider,
      formatUsd(rate.usd),
      rate.per,
      rate.source,
      rate.fallback ? `${formatUsd(rate.fallback.usd)}/${rate.fallback.per} (${rate.fallback.source})` : '—',
    ]),
  );
}

function printProviderRate(r: RatesResponse, provider: string, lead: string): void {
  const rate = r.rates.find((x) => x.provider === provider);
  if (!rate) {
    console.log(lead);
    return;
  }
  console.log(`${lead}: ${provider} ${formatUsdPer(rate)} (${rate.source})`);
}

export function registerBillingCommands(
  group: Command,
  common: (cmd: Command) => Command,
  deps: BillingDeps,
): void {
  common(
    group
      .command('costs')
      .description("Show the org's sandbox spend: running, settled and per provider")
      .option('--customer-only', 'exclude idle platform sandboxes (warm pool, CI sync, snapshot builds); Actions job sandboxes stay'),
  ).action(async (opts: CommonOpts & { customerOnly?: boolean }) => {
    try {
      const c = await deps.client(opts);
      const res = await c.get<SandboxCosts>(
        '/api/v1/sandboxes/costs',
        opts.customerOnly ? { customerOnly: 'true' } : undefined,
      );
      deps.output(opts, res, (data) => printCosts(data, opts.customerOnly === true));
    } catch (e) {
      deps.fail(e, opts);
    }
  });

  const rates = common(
    group.command('rates').description("Show the org's sandbox rate per provider and where each comes from"),
  ).action(async (opts: CommonOpts) => {
    try {
      const c = await deps.client(opts);
      deps.output(opts, await c.get<RatesResponse>('/api/v1/sandboxes/rates'), printRates);
    } catch (e) {
      deps.fail(e, opts);
    }
  });

  common(
    rates
      .command('set')
      .description('Set the org rate override for a provider (applies to sandboxes created afterwards)')
      .argument('<provider>', 'provider id, e.g. beam')
      .argument('[rate]', '<usd>/<second|minute|hour>, e.g. 0.5/hour')
      .option('--usd <amount>', 'dollar amount (with --per)')
      .option('--per <unit>', 'second | minute | hour (with --usd)'),
  ).action(async (provider: string, rate: string | undefined, opts: CommonOpts & { usd?: string; per?: string }) => {
    try {
      const { usd, per } = parseRateArg(rate, opts);
      const c = await deps.client(opts);
      const res = await c.put<RatesResponse>('/api/v1/sandboxes/rates', { provider, usd, per });
      deps.output(opts, res, (r) => printProviderRate(r, provider, 'set'));
    } catch (e) {
      deps.fail(e, opts);
    }
  });

  common(
    rates
      .command('rm')
      .alias('remove')
      .description("Remove the org's rate override for a provider")
      .argument('<provider>', 'provider id, e.g. beam')
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (provider: string, opts: CommonOpts & { yes?: boolean }) => {
    try {
      await confirmWrite(
        `Remove the ${provider} rate override? New ${provider} sandboxes fall back to the platform rate.`,
        opts,
      );
      const c = await deps.client(opts);
      const res = await c.del<RatesResponse>(`/api/v1/sandboxes/rates?provider=${encodeURIComponent(provider)}`);
      deps.output(opts, res, (r) => printProviderRate(r, provider, `removed the ${provider} rate override; now`));
    } catch (e) {
      deps.fail(e, opts);
    }
  });
}
