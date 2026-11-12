/**
 * `compute sandboxes settings` / `compute actions settings` — one lane's
 * router. Routing is ComputeSDK's managed accounts: the default routing, or
 * the org's own managed order (`--routing`). BYOK is separate: whether the
 * org's own keys are used (`--byok off|first|fallback|only`) and in what
 * order (`--byok-order`), over `GET/PATCH /api/v1/{lane}/routing`. Sizes
 * and pools stay on `GET/PATCH /api/v1/{lane}/settings`. Keys themselves are
 * `compute byok`.
 *
 * `--cap`/`--general-cap` prices use the same parser as `--max-price` — a
 * unit is required (`0.12/hour`), so a bare dollar amount never silently
 * becomes per-second pricing.
 */

import { Command, Option } from 'commander';
import pc from 'picocolors';
import { ActionsApiError, ActionsCliError, type ActionsClient } from './actions-client.js';

import { safeTerm } from './term.js';
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
  /** Preset name matching each providerResources entry, when one does. */
  providerResourcePresets?: Record<string, string | null>;
  warmPool?: Record<string, number>;
  snapshotPool?: Record<string, number>;
  /** Actions lane: the order an org with no providerOrder stored places on. */
  defaultProviderOrder?: string[];
  /** Actions lane: each provider's size presets, the names --resources takes. */
  sizePresets?: Record<string, { name: string; label: string }[]>;
  /** Actions lane: which workflows cap snapshots and which hold live ones. */
  snapshotSummary?: {
    workflows: { repoFullName: string; path: string; name: string; snapshotCap: number | null }[];
    live: { repoFullName: string; workflowPath: string | null; count: number }[];
  };
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

/** Mirrors MAX_WARM_POOL_SIZE in benchmarks-platform lib/providers/org-settings.ts. */
export const MAX_WARM_POOL_SIZE = 16;

/** Mirrors MAX_SNAPSHOT_POOL_SIZE in benchmarks-platform lib/providers/org-settings.ts. */
export const MAX_SNAPSHOT_POOL_SIZE = 32;

/** One `<provider>=<preset>` or `<provider>=none` `--resources` value; the server checks the names. */
export function parseResourcesFlag(entry: string): { provider: string; preset: string | null } {
  const eq = entry.indexOf('=');
  const provider = eq === -1 ? '' : entry.slice(0, eq).trim();
  const preset = eq === -1 ? '' : entry.slice(eq + 1).trim();
  if (provider === '' || preset === '') {
    throw new ActionsCliError(
      'invalid_argument',
      `Invalid --resources "${entry}" — expected <provider>=<preset> (e.g. blaxel=large) or <provider>=none.`,
    );
  }
  return { provider, preset: preset === 'none' ? null : preset };
}

/** One `<provider[:region]>=<n>` pool-flag value, n in 0..max (0 clears the entry). */
function parsePoolFlag(flag: string, entry: string, max: number): { key: string; size: number } {
  const eq = entry.indexOf('=');
  const key = eq === -1 ? '' : entry.slice(0, eq).trim();
  const value = eq === -1 ? '' : entry.slice(eq + 1).trim();
  const size = Number(value);
  if (key === '' || !/^\d+$/.test(value) || size > max) {
    throw new ActionsCliError(
      'invalid_argument',
      `Invalid ${flag} "${entry}" — expected <provider>[:<region>]=<n> with n in 0..${max} (0 clears it).`,
    );
  }
  return { key, size };
}

/** One `<provider[:region]>=<n>` `--warm-pool` value, n in 0..16 (0 clears the entry). */
export function parseWarmPoolFlag(entry: string): { key: string; size: number } {
  return parsePoolFlag('--warm-pool', entry, MAX_WARM_POOL_SIZE);
}

/** One `<provider[:region]>=<n>` `--snapshot-pool` value, n in 0..32 (0 clears the entry). */
export function parseSnapshotPoolFlag(entry: string): { key: string; size: number } {
  return parsePoolFlag('--snapshot-pool', entry, MAX_SNAPSHOT_POOL_SIZE);
}

/** Repeated pool flags as the settings patch: entry → size. */
function poolPatch(entries: string[], parse: (entry: string) => { key: string; size: number }): Record<string, number> {
  const pool: Record<string, number> = {};
  for (const entry of entries) {
    const { key, size } = parse(entry);
    pool[key] = size;
  }
  return pool;
}

function formatResources(r: { cpus?: number; memoryMb?: number; ephemeralDiskMb?: number }): string {
  const parts: string[] = [];
  if (r.cpus !== undefined) parts.push(`${r.cpus} vCPU`);
  if (r.memoryMb !== undefined) parts.push(`${r.memoryMb} MB`);
  if (r.ephemeralDiskMb) parts.push(`${r.ephemeralDiskMb} MB disk`);
  return parts.join(' / ') || '—';
}

export const BYOK_MODES = ['off', 'first', 'fallback', 'only'] as const;
export type ByokMode = (typeof BYOK_MODES)[number];

const BYOK_MODE_HELP: Record<ByokMode, string> = {
  off: "not used: managed accounts only",
  first: 'your keys first, then managed accounts',
  fallback: 'managed accounts first, then your keys',
  only: 'your keys only, never managed accounts',
};

/** `GET/PATCH /api/v1/{lane}/routing`. */
export interface LaneRouting {
  /** "default" (ComputeSDK routing) or the org's own managed order. */
  routing: 'default' | string[];
  /** The managed accounts the router walks now, in order. */
  managed: string[];
  /** Every live managed account a custom order may name. */
  available: string[];
  byok: { mode: ByokMode; order: string[] };
}

const arrow = (list: string[]): string => list.join(' → ');

/** The router: managed routing first (the default path), then BYOK. */
export function printLaneRouting(r: LaneRouting, s: LaneSettings, lane: 'actions' | 'sandboxes'): void {
  const label = (text: string) => text.padEnd(12);
  const managed = r.managed.length > 0 ? arrow(r.managed) : pc.dim('no managed account is live');
  console.log(
    `${label('Routing')}${r.routing === 'default' ? `ComputeSDK default  ${pc.dim(`(${managed})`)}` : `custom: ${managed}`}`,
  );
  console.log(`${label('BYOK')}${r.byok.mode}  ${pc.dim(`(${BYOK_MODE_HELP[r.byok.mode]})`)}`);
  if (r.byok.mode !== 'off') {
    const order =
      r.byok.order.length > 0
        ? arrow(r.byok.order)
        : lane === 'sandboxes'
          ? pc.dim(`inherits Actions (${arrow(s.actionsProviderOrder ?? []) || '—'})`)
          : pc.dim('none set — add keys with `compute byok configure`');
    console.log(`${label('BYOK order')}${order}`);
  }
}

/** Sizes and pools (the BYOK side's per-provider knobs). */
export function printLaneSettings(s: LaneSettings): void {
  const resources = Object.entries(s.providerResources ?? {});
  console.log('resources:');
  if (resources.length === 0) console.log('  —');
  for (const [provider, r] of resources) {
    const preset = s.providerResourcePresets?.[provider];
    console.log(preset ? `  ${provider}  ${preset} (${formatResources(r)})` : `  ${provider}  ${formatResources(r)}`);
  }
  const pool = Object.entries(s.warmPool ?? {});
  console.log('warm pool:');
  if (pool.length === 0) console.log('  —');
  for (const [entry, floor] of pool) console.log(`  ${entry}  ${floor}`);
  if (s.snapshotPool !== undefined) {
    const snap = Object.entries(s.snapshotPool);
    console.log('snapshot pool:');
    if (snap.length === 0) console.log('  —');
    for (const [entry, cap] of snap) console.log(`  ${safeTerm(entry)}  ${cap}`);
  }
  if (s.snapshotSummary !== undefined) printSnapshotSummary(s.snapshotSummary);
}

/** Workflows carrying their own snapshot cap, then the workflows holding live snapshots. */
function printSnapshotSummary(summary: NonNullable<LaneSettings['snapshotSummary']>): void {
  const capped = summary.workflows.filter((w) => w.snapshotCap !== null);
  console.log('workflow snapshot caps:');
  if (capped.length === 0) console.log(`  ${pc.dim('— (every workflow uses the dynamic pool)')}`);
  for (const w of capped) {
    const cap = w.snapshotCap === 0 ? 'off' : String(w.snapshotCap);
    console.log(`  ${safeTerm(w.repoFullName)}  ${safeTerm(w.path)}  ${cap}`);
  }
  console.log('live snapshots:');
  if (summary.live.length === 0) console.log('  —');
  for (const row of summary.live) {
    console.log(`  ${safeTerm(row.repoFullName)}  ${row.workflowPath === null ? pc.dim('(no workflow)') : safeTerm(row.workflowPath)}  ${row.count}`);
  }
}

function settingsFail(
  e: unknown,
  opts: CommonOpts,
  lane: string,
  verb: 'view' | 'change',
  deps: SettingsDeps,
): never {
  if (e instanceof ActionsApiError && e.status === 403) {
    return deps.fail(
      new ActionsApiError(
        403,
        `Only org owners/admins can ${verb} ${lane} settings`,
        e.body,
      ),
      opts,
    );
  }
  return deps.fail(e, opts);
}

/** A comma-separated provider list flag; empty is a usage error. */
function providerList(flag: string, value: string): string[] {
  const list = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (list.length === 0) throw new Error(`${flag} "${value}" names no providers — pass a comma-separated list.`);
  return list;
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
  const routerName = lane === 'sandboxes' ? 'Sandboxes' : 'Actions';
  const show = async (c: ActionsClient) => {
    const [routing, settings] = await Promise.all([
      c.get<LaneRouting>(`/api/v1/${lane}/routing`),
      c.get<LaneSettings>(`/api/v1/${lane}/settings`),
    ]);
    return { routing, settings };
  };
  const print = ({ routing, settings }: { routing: LaneRouting; settings: LaneSettings }) => {
    printLaneRouting(routing, settings, lane);
    printLaneSettings(settings);
  };

  const settings = common(
    group
      .command('settings')
      .description(`Show the ${routerName} router: managed routing, BYOK use, sizes and pools`)
      .configureOutput({
        outputError: (str, write) => deps.usageErrorOutput(str, write),
      }),
  ).action(async (opts: CommonOpts) => {
    try {
      deps.output(opts, await show(await deps.client(opts)), print);
    } catch (e) {
      settingsFail(e, opts, lane, 'view', deps);
    }
  });

  const set = common(
    settings
      .command('set')
      .description(`Change the ${routerName} router (owner/admin)`)
      .option(
        '--routing <default|providers>',
        'managed routing: "default" for ComputeSDK routing, or your own managed-account order (e.g. daytona,e2b)',
      )
      .option('--byok <mode>', `use your own keys: ${BYOK_MODES.join(' | ')}`)
      .option(
        '--byok-order <providers>',
        lane === 'sandboxes'
          ? 'your own providers in order (e.g. tensorlake,blaxel); "inherit" uses the Actions BYOK order'
          : 'your own providers in order (e.g. tensorlake,blaxel)',
      )
      // Pre-router spelling of --byok-order, kept for existing scripts.
      .addOption(new Option('--order <providers>').hideHelp()),
  );
  set
    .option(
      '--resources <provider=preset>',
      'per-provider size preset (e.g. blaxel=large); <provider>=none clears it (repeatable)',
      (v, a: string[]) => a.concat(v),
      [] as string[],
    )
    .option(
      '--warm-pool <provider[:region]=n>',
      `warm pool size per BYOK entry, 0..${MAX_WARM_POOL_SIZE}; 0 clears it (repeatable)`,
      (v, a: string[]) => a.concat(v),
      [] as string[],
    );
  if (lane === 'actions') {
    set.option(
      '--snapshot-pool <provider[:region]=n>',
      `snapshot cap per BYOK entry, 0..${MAX_SNAPSHOT_POOL_SIZE}; 0 clears it (repeatable)`,
      (v, a: string[]) => a.concat(v),
      [] as string[],
    );
  }
  // Caps and order types price the compute market, which is not generally
  // available; accepted, but kept out of help.
  set
    .addOption(new Option('--cap <size=rate>').hideHelp().argParser((v, a: string[] = []) => a.concat(v)).default([]))
    .addOption(new Option('--general-cap <rate|none>').hideHelp())
    .addOption(new Option('--order-type <type>').hideHelp());

  set.action(async (opts: CommonOpts & {
    routing?: string;
    byok?: string;
    byokOrder?: string;
    order?: string;
    cap: string[];
    generalCap?: string;
    orderType?: string;
    resources?: string[];
    warmPool?: string[];
    snapshotPool?: string[];
  }) => {
    try {
      const routing: Record<string, unknown> = {};
      if (opts.routing !== undefined) {
        routing.routing = opts.routing === 'default' ? 'default' : providerList('--routing', opts.routing);
      }
      if (opts.byok !== undefined) {
        if (!(BYOK_MODES as readonly string[]).includes(opts.byok)) {
          throw new Error(`--byok must be one of ${BYOK_MODES.join(', ')}.`);
        }
        routing.byok = opts.byok;
      }
      if (opts.byokOrder !== undefined && opts.order !== undefined) {
        throw new Error('--order is the old name of --byok-order; pass one.');
      }
      const byokOrder = opts.byokOrder ?? opts.order;
      if (byokOrder !== undefined) {
        const flag = opts.byokOrder !== undefined ? '--byok-order' : '--order';
        routing.byokOrder =
          (byokOrder === 'inherit' && lane === 'sandboxes') || (byokOrder === 'default' && lane === 'actions')
            ? []
            : providerList(flag, byokOrder);
      }

      const settingsBody: Record<string, unknown> = {};
      if (opts.cap.length > 0) {
        const caps: Record<string, Rate | null> = {};
        for (const entry of opts.cap) {
          const { size, cap } = parseSizeCap(entry);
          caps[size] = cap;
        }
        settingsBody.marketCaps = caps;
      }
      if (opts.generalCap !== undefined) {
        settingsBody.marketCap = opts.generalCap === 'none' ? null : parseMaxPrice(opts.generalCap, undefined);
      }
      if (opts.orderType !== undefined) {
        if (lane === 'sandboxes' && opts.orderType === 'inherit') {
          settingsBody.marketOrderType = null;
        } else if (opts.orderType === 'limit' || opts.orderType === 'market') {
          settingsBody.marketOrderType = opts.orderType;
        } else {
          throw new Error('--order-type must be limit or market.');
        }
      }
      if (opts.resources && opts.resources.length > 0) {
        const resources: Record<string, string | null> = {};
        for (const entry of opts.resources) {
          const { provider, preset } = parseResourcesFlag(entry);
          resources[provider] = preset;
        }
        settingsBody.providerResources = resources;
      }
      if (opts.warmPool && opts.warmPool.length > 0) {
        settingsBody.warmPool = poolPatch(opts.warmPool, parseWarmPoolFlag);
      }
      if (opts.snapshotPool && opts.snapshotPool.length > 0) {
        settingsBody.snapshotPool = poolPatch(opts.snapshotPool, parseSnapshotPoolFlag);
      }
      if (Object.keys(routing).length === 0 && Object.keys(settingsBody).length === 0) {
        throw new Error(
          lane === 'sandboxes'
            ? 'Nothing to change — pass --routing, --byok, --byok-order, --resources, or --warm-pool.'
            : 'Nothing to change — pass --routing, --byok, --byok-order, --resources, --warm-pool, or --snapshot-pool.',
        );
      }
      const c = await deps.client(opts);
      if (Object.keys(routing).length > 0) await c.patch<LaneRouting>(`/api/v1/${lane}/routing`, routing);
      if (Object.keys(settingsBody).length > 0) await c.patch<LaneSettings>(`/api/v1/${lane}/settings`, settingsBody);
      deps.output(opts, await show(c), print);
    } catch (e) {
      settingsFail(e, opts, lane, 'change', deps);
    }
  });
}
