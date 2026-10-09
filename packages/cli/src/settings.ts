/**
 * `compute sandboxes settings` / `compute actions settings` — the org's
 * routing policy for one consumer lane over `GET/PATCH /api/v1/{lane}/settings`.
 * Both lanes print the same shape and take the same flags; the sandbox lane
 * adds the inherit semantics (its order/cap/order type fall back to the
 * Actions values when unset).
 *
 * `--cap`/`--general-cap` prices use the same parser as `--max-price` — a
 * unit is required (`0.12/hour`), so a bare dollar amount never silently
 * becomes per-second pricing.
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { ActionsApiError, type ActionsClient } from './actions-client.js';
import type { CommonOpts } from './actions.js';

/**
 * The helpers these commands need from `actions.js`, injected by the caller —
 * `actions.ts` imports this module, so a runtime import the other way would
 * create a cycle.
 */
export interface SettingsDeps {
  client: (opts: CommonOpts) => Promise<ActionsClient>;
  output: <T>(opts: CommonOpts, data: T, render: (data: T) => void) => void;
  fail: (error: unknown, opts?: CommonOpts) => never;
  usageErrorOutput: (str: string, write: (str: string) => void, argv?: string[]) => void;
}

export const PLATFORM_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;

type Rate = { usd: number; per: string };

/** The settings GET/PATCH wire shape — fields shared by both lanes; the
 * `actions*` keys are the sandbox lane's inherit references. */
export interface LaneSettings {
  providerOrder: string[];
  actionsProviderOrder?: string[];
  marketCap?: Rate | null;
  actionsMarketCap?: Rate | null;
  marketOrderType?: 'market' | 'limit' | null;
  actionsMarketOrderType?: 'market' | 'limit';
  marketCaps?: Record<string, Rate | null>;
  referencePrices?: Record<string, Rate | null>;
  providerResources?: Record<
    string,
    { cpus?: number; memoryMb?: number; ephemeralDiskMb?: number }
  >;
  warmPool?: Record<string, number>;
  snapshotPool?: Record<string, number>;
}

/**
 * `--max-price <usd>/<unit>` (and the `--cap`/`--general-cap` rates): the
 * unit is required — inline (`0.12/hour`) or via the `per` argument — so a
 * bare `--max-price 0.12` never silently defaults to per-second pricing.
 */
export function parseMaxPrice(
  value: string | undefined,
  per: string | undefined,
): { usd: number; per: 'second' | 'minute' | 'hour' } | undefined {
  if (value === undefined) {
    if (per !== undefined) throw new Error('--max-price-per requires --max-price.');
    return undefined;
  }
  let usdText = value;
  let unit: string | undefined = per;
  const slash = value.indexOf('/');
  if (slash !== -1) {
    usdText = value.slice(0, slash);
    const inline = value.slice(slash + 1);
    if (per !== undefined && per !== inline) {
      throw new Error(`--max-price "${value}" conflicts with --max-price-per "${per}".`);
    }
    unit = inline;
  }
  const usd = Number(usdText);
  if (!/^\d+(\.\d+)?([eE][+-]?\d+)?$/.test(usdText) || !Number.isFinite(usd) || usd <= 0) {
    throw new Error(`Invalid --max-price "${value}". Expected a positive dollar amount like 0.12/hour.`);
  }
  if (unit !== 'second' && unit !== 'minute' && unit !== 'hour') {
    throw new Error(
      'a unit is required — write it as <usd>/<unit> (e.g. 0.12/hour)',
    );
  }
  return { usd, per: unit };
}

/** One `<size>=<usd>/<unit>` or `<size>=none` `--cap` flag value. */
function parseSizeCap(entry: string): { size: string; cap: Rate | null } {
  const eq = entry.indexOf('=');
  const size = eq === -1 ? entry : entry.slice(0, eq);
  if (!(PLATFORM_SIZES as readonly string[]).includes(size)) {
    throw new Error(
      `Invalid --cap "${entry}" — size must be one of ${PLATFORM_SIZES.join(', ')}.`,
    );
  }
  const value = eq === -1 ? '' : entry.slice(eq + 1);
  if (value === 'none') return { size, cap: null };
  const cap = parseMaxPrice(value, undefined);
  if (!cap) {
    throw new Error(
      `Invalid --cap "${entry}" — expected <size>=<usd>/<unit> (e.g. small=0.11/hour) or <size>=none.`,
    );
  }
  return { size, cap };
}

const fmtRate = (cap: Rate | null | undefined): string =>
  cap ? `$${cap.usd}/${cap.per}` : '—';

const fmtRef = (ref: Rate | null | undefined): string =>
  ref ? `  ${pc.dim(`reference $${ref.usd}/${ref.per}`)}` : '';

export function printLaneSettings(
  s: LaneSettings,
  lane: 'actions' | 'sandboxes',
): void {
  const sandbox = lane === 'sandboxes';
  const orderType = s.marketOrderType ?? (sandbox ? 'inherit' : '—');
  const orderSuffix =
    sandbox && s.marketOrderType == null
      ? pc.dim(`  (Actions: ${s.actionsMarketOrderType ?? '—'})`)
      : '';
  console.log(`order type: ${orderType}${orderSuffix}`);
  const capSuffix =
    sandbox && s.marketCap == null
      ? pc.dim(`  (inherits Actions: ${fmtRate(s.actionsMarketCap)})`)
      : '';
  console.log(`general cap: ${fmtRate(s.marketCap)}${capSuffix}`);
  console.log('per-size caps:');
  for (const size of PLATFORM_SIZES) {
    const cap = s.marketCaps?.[size];
    console.log(
      `  ${size.padEnd(7)} ${fmtRate(cap)}${cap ? '' : fmtRef(s.referencePrices?.[size])}`,
    );
  }
  const orderText =
    s.providerOrder.length > 0
      ? s.providerOrder.join(', ')
      : sandbox
        ? pc.dim(`inherit (Actions: ${(s.actionsProviderOrder ?? []).join(', ') || '—'})`)
        : '—';
  console.log(`provider order: ${orderText}`);
  const resources = Object.entries(s.providerResources ?? {});
  console.log('sizes:');
  if (resources.length === 0) console.log('  —');
  for (const [provider, r] of resources) {
    console.log(
      `  ${provider}  ${r.cpus ?? '?'} vCPU / ${r.memoryMb ?? '?'} MB${r.ephemeralDiskMb ? ` / ${r.ephemeralDiskMb} MB disk` : ''}`,
    );
  }
  const pool = Object.entries(s.warmPool ?? {});
  console.log('warm pool:');
  if (pool.length === 0) console.log('  —');
  for (const [entry, floor] of pool) console.log(`  ${entry}  ${floor}`);
  if (s.snapshotPool !== undefined) {
    const snap = Object.entries(s.snapshotPool);
    console.log('snapshot pool:');
    if (snap.length === 0) console.log('  —');
    for (const [entry, cap] of snap) console.log(`  ${entry}  ${cap}`);
  }
}

function settingsFail(
  e: unknown,
  opts: CommonOpts,
  lane: string,
  deps: SettingsDeps,
): never {
  if (e instanceof ActionsApiError && e.status === 403) {
    return deps.fail(
      new ActionsApiError(
        403,
        `Only org owners/admins can change ${lane} settings`,
        e.body,
      ),
      opts,
    );
  }
  return deps.fail(e, opts);
}

/**
 * Register `settings` / `settings set` on a lane's command group
 * (`compute sandboxes` or `compute actions`).
 */
export function registerSettingsCommands(
  group: Command,
  lane: 'actions' | 'sandboxes',
  common: (cmd: Command) => Command,
  deps: SettingsDeps,
): void {
  const settings = common(
    group
      .command('settings')
      .description(`Show the org's ${lane} routing policy (order, caps, sizes, pools)`)
      .configureOutput({
        outputError: (str, write) => deps.usageErrorOutput(str, write),
      }),
  ).action(async (opts: CommonOpts) => {
    try {
      const c = await deps.client(opts);
      const res = await c.get<LaneSettings>(`/api/v1/${lane}/settings`);
      deps.output(opts, res, (s) => printLaneSettings(s, lane));
    } catch (e) {
      settingsFail(e, opts, lane, deps);
    }
  });

  common(
    settings
      .command('set')
      .description(`Update the org's ${lane} routing policy`)
      .option(
        '--cap <size=rate>',
        'per-size cap: <size>=<usd>/<unit> or <size>=none to clear (repeatable)',
        (v, a: string[]) => a.concat(v),
        [] as string[],
      )
      .option('--general-cap <rate|none>', 'whole-lane price cap (e.g. 0.40/hour); "none" clears it')
      .option(
        '--order-type <type>',
        lane === 'sandboxes'
          ? 'market order type: limit | market | inherit (the Actions value)'
          : 'market order type: limit | market',
      )
      .option(
        '--order <providers>',
        lane === 'sandboxes'
          ? 'provider order, comma-separated (e.g. "market,blaxel,vercel"); "inherit" restores the Actions order'
          : 'provider order, comma-separated (e.g. "market,blaxel,vercel"); "default" restores the platform default',
      ),
  ).action(async (opts: CommonOpts & {
    cap: string[];
    generalCap?: string;
    orderType?: string;
    order?: string;
  }) => {
    try {
      const body: Record<string, unknown> = {};
      if (opts.cap.length > 0) {
        const caps: Record<string, Rate | null> = {};
        for (const entry of opts.cap) {
          const { size, cap } = parseSizeCap(entry);
          caps[size] = cap;
        }
        body.marketCaps = caps;
      }
      if (opts.generalCap !== undefined) {
        body.marketCap =
          opts.generalCap === 'none'
            ? null
            : parseMaxPrice(opts.generalCap, undefined);
      }
      if (opts.orderType !== undefined) {
        if (lane === 'sandboxes' && opts.orderType === 'inherit') {
          body.marketOrderType = null;
        } else if (opts.orderType === 'limit' || opts.orderType === 'market') {
          body.marketOrderType = opts.orderType;
        } else {
          throw new Error(
            lane === 'sandboxes'
              ? '--order-type must be limit, market, or inherit.'
              : '--order-type must be limit or market.',
          );
        }
      }
      if (opts.order !== undefined) {
        if (opts.order === 'inherit' && lane === 'sandboxes') {
          body.providerOrder = [];
        } else if (opts.order === 'default' && lane === 'actions') {
          body.providerOrder = [];
        } else {
          body.providerOrder = opts.order.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
      if (Object.keys(body).length === 0) {
        throw new Error(
          'Nothing to change — pass --cap, --general-cap, --order-type, or --order.',
        );
      }
      const c = await deps.client(opts);
      const res = await c.patch<LaneSettings>(`/api/v1/${lane}/settings`, body);
      deps.output(opts, res, (s) => printLaneSettings(s, lane));
    } catch (e) {
      settingsFail(e, opts, lane, deps);
    }
  });
}
