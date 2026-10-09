/**
 * `compute market` — the sell side of the compute market: post listings,
 * reprice/pause/resume/withdraw them, read the book, and read payouts.
 *
 * Auth: identical to `compute actions` — --api-key / COMPUTE_API_KEY / the
 * stored `compute login` (or `compute bench auth login`) session. The key must belong to an org
 * the platform flags `market_provider`; the seller principal (which
 * executor provider these listings sell) is resolved server-side from the
 * key. Types mirror the wire shapes in benchmarks-platform `lib/market/*`
 * describe functions — keep them in sync by hand; the API is the contract.
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { ActionsCliError } from './actions-client.js';
import {
  client,
  fail,
  output,
  parseInputs,
  safeTerm,
  secretValueClient,
  usageErrorOutput,
  type CommonOpts,
} from './actions.js';

// ─── Wire types (mirror benchmarks-platform lib/market describes) ───────────

export type MarketRatePer = 'second' | 'minute' | 'hour';
export type MarketAskStatus = 'live' | 'paused' | 'withdrawn';

/** `describeAsk` — one row of GET /api/v1/market/asks. */
export interface MarketAsk {
  id: string;
  provider: string;
  region: string | null;
  size: string;
  /** The lane the listing sells into — 'actions' on listings posted before lanes. */
  useCase?: 'actions' | 'sandbox';
  resources: { cpus?: number; memoryMb?: number; ephemeralDiskMb?: number };
  usd: number;
  per: MarketRatePer;
  takeBps: number;
  maxConcurrent: number;
  status: MarketAskStatus;
  /** status === 'live' AND unexpired — a 'live' ask past expiresAt shows as expired. */
  live: boolean;
  expiresAt: string | null;
  rollover: boolean;
  /** A rate edit queued for the next renewal window, when one exists. */
  pendingUsd: number | null;
  pendingPer: MarketRatePer | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketCredentialField {
  name: string;
  label: string;
  secret: boolean;
  required?: boolean;
  placeholder?: string;
}

/** `describeMarketProviderMe` — GET /api/v1/market/provider. */
export interface MarketProvider {
  id: string;
  name: string;
  provider: string;
  organizationId: string | null;
  keyHint: string;
  executorCredentialConnected: boolean;
  revokedAt: string | null;
  createdAt: string;
  /** The lanes this principal is approved to sell into, e.g. ["actions", "sandbox"]. */
  useCases?: string[];
  /** Size presets the bound executor sells, e.g. small/medium/large. */
  sizes: {
    name: string;
    label: string;
    resources: { cpus?: number; memoryMb?: number; ephemeralDiskMb?: number };
  }[];
  regions: string[];
  /** The credential fields `credential connect` must fill ([] = ambient auth). */
  credentialFields: MarketCredentialField[];
}

/** `OrderBook` — GET /api/v1/market/book. */
export interface MarketOrderBook {
  asks: {
    id: string;
    provider: string;
    providerName: string;
    region: string | null;
    size: string;
    /** The lane the listing sells into — 'actions' on asks posted before lanes. */
    useCase?: 'actions' | 'sandbox';
    usd: number;
    per: MarketRatePer;
    takeBps: number;
    maxConcurrent: number;
    expiresAt: string | null;
    rollover: boolean;
    updatedAt: string;
  }[];
  bids: {
    id: string;
    /** Buyer org ids are never exposed — `mine` marks this org's own offer. */
    mine: boolean;
    size: string;
    /** The lane the offer buys on — 'actions' on bids posted before lanes. */
    useCase?: 'actions' | 'sandbox';
    region: string | null;
    maxUsd: number;
    per: MarketRatePer;
    createdAt: string;
    expiresAt: string | null;
  }[];
  fills: {
    id: string;
    askId: string;
    provider: string;
    size: string;
    /** The lane the sale cleared on — 'actions' on fills from before lanes. */
    useCase?: 'actions' | 'sandbox';
    region: string | null;
    usd: number;
    per: MarketRatePer;
    /** 'replaced' = the seller took the capacity back mid-sale. */
    status: 'live' | 'closed' | 'replaced';
    createdAt: string;
  }[];
  prices: { askId: string; usd: number; per: MarketRatePer; changedAt: string }[];
}

/** One evicted sale — POST /api/v1/market/fills/:id/replace and each entry of the listing replace. */
export interface MarketReplacedFill {
  fillId: string;
  askId: string;
  /** Charged to the buyer — the seconds the fill actually lived. */
  settledMicroUsd: number;
  /** An Actions job on the evicted capacity re-places on the buyer's next provider. */
  jobRequeued: boolean;
}

export type MarketReplaceFillOutcome =
  | { ok: true; fill: MarketReplacedFill }
  | { ok: false; status: number; error: string };

/** POST /api/v1/market/listings/:id/replace — paused listing + per-fill outcomes. */
export interface MarketListingReplaceResult {
  listing: MarketAsk;
  fills: MarketReplaceFillOutcome[];
}

/** `describeSettlement` — one row of GET /api/v1/market/settlements. */
export interface MarketSettlement {
  id: string;
  providerId: string;
  provider?: string;
  periodStart: string;
  periodEnd: string;
  vcpuSeconds: number;
  grossUsd: number;
  netUsd: number;
  grossMicroUsd: number;
  netMicroUsd: number;
  invoiceRef: string | null;
  paidAt: string | null;
  createdAt: string;
}

// ─── Parsing helpers (pure, exported for tests) ─────────────────────────────

const USD_RE = /^\d+(\.\d+)?([eE][+-]?\d+)?$/;
const RATE_UNITS: MarketRatePer[] = ['second', 'minute', 'hour'];
const MARKET_LANES = ['actions', 'sandbox'] as const;
export type MarketLane = (typeof MARKET_LANES)[number];

/**
 * `--use-case` → the lane the listing sells into / the book filters to.
 * Absent = 'actions', matching the API default.
 */
export function parseMarketLane(value: string | undefined): MarketLane {
  if (value === undefined) return 'actions';
  if (!MARKET_LANES.includes(value as MarketLane)) {
    throw new ActionsCliError(
      'invalid_argument',
      `--use-case must be ${MARKET_LANES.join(' or ')}, got "${value}".`,
    );
  }
  return value as MarketLane;
}

/**
 * `--price <usd>/<unit>` → the body's `usd`/`per`. The unit is required —
 * either inside the value (`0.12/hour`) or via `--per` — so a bare `--price
 * 0.12` never silently defaults to per-second pricing (same rule as
 * `sandboxes create --max-price`).
 */
export function parseRate(
  price: string | undefined,
  per: string | undefined,
): { usd: number; per: MarketRatePer } {
  if (price === undefined) {
    throw new ActionsCliError('invalid_argument', 'A price is required — pass --price <usd>/<unit>.');
  }
  let usdText = price;
  let unit: string | undefined = per;
  const slash = price.indexOf('/');
  if (slash !== -1) {
    usdText = price.slice(0, slash);
    const inline = price.slice(slash + 1);
    if (per !== undefined && per !== inline) {
      throw new ActionsCliError(
        'invalid_argument',
        `--price "${price}" conflicts with --per "${per}".`,
      );
    }
    unit = inline;
  }
  const usd = Number(usdText);
  if (!USD_RE.test(usdText) || !Number.isFinite(usd) || usd <= 0) {
    throw new ActionsCliError(
      'invalid_argument',
      `Invalid --price "${price}". Expected a positive dollar amount (e.g. 0.12/hour).`,
    );
  }
  if (unit === undefined) {
    throw new ActionsCliError(
      'invalid_argument',
      '--price needs a unit — write it as <usd>/<unit> (e.g. --price 0.12/hour) or pass --per hour.',
    );
  }
  if (!RATE_UNITS.includes(unit as MarketRatePer)) {
    throw new ActionsCliError(
      'invalid_argument',
      `The unit must be second, minute, or hour, got "${unit}".`,
    );
  }
  return { usd, per: unit as MarketRatePer };
}

/** `--capacity` → `maxConcurrent`: a positive integer, absent = server default (1). */
export function parseCapacity(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ActionsCliError(
      'invalid_argument',
      `Invalid --capacity "${value}". Expected a positive integer.`,
    );
  }
  return n;
}

/** `--expires-in` → `expiresInHours`: a positive number of hours. */
export function parseExpiresIn(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new ActionsCliError(
      'invalid_argument',
      `Invalid --expires-in "${value}". Expected a positive number of hours.`,
    );
  }
  return hours;
}

/**
 * The `POST /api/v1/market/asks` create body for `sell`: `{size, region?,
 * usd, per, maxConcurrent?, expiresInHours?, rollover?}`.
 */
export function sellBody(opts: {
  size: string;
  price?: string;
  per?: string;
  region?: string;
  capacity?: string;
  expiresIn?: string;
  renew?: boolean;
  useCase?: string;
}): Record<string, unknown> {
  const rate = parseRate(opts.price, opts.per);
  const maxConcurrent = parseCapacity(opts.capacity);
  const expiresInHours = parseExpiresIn(opts.expiresIn);
  if (opts.renew && expiresInHours === undefined) {
    throw new ActionsCliError(
      'invalid_argument',
      '--renew requires --expires-in — a standing listing never expires.',
    );
  }
  return {
    size: opts.size,
    useCase: parseMarketLane(opts.useCase),
    ...(opts.region !== undefined && { region: opts.region }),
    usd: rate.usd,
    per: rate.per,
    ...(maxConcurrent !== undefined && { maxConcurrent }),
    ...(expiresInHours !== undefined && { expiresInHours }),
    ...(opts.renew && { rollover: true }),
  };
}

/**
 * The `POST /api/v1/market/asks` update body for `price`/`pause`/`resume`:
 * `{askId, usd?, per?, maxConcurrent?, status?}` — exactly one of the
 * change fields must be present.
 */
export function listingPatchBody(
  listingId: string,
  change: {
    price?: string;
    per?: string;
    capacity?: string;
    status?: 'live' | 'paused';
  },
): Record<string, unknown> {
  const body: Record<string, unknown> = { askId: listingId };
  if (change.price !== undefined || change.per !== undefined) {
    const rate = parseRate(change.price, change.per);
    body.usd = rate.usd;
    body.per = rate.per;
  }
  const maxConcurrent = parseCapacity(change.capacity);
  if (maxConcurrent !== undefined) body.maxConcurrent = maxConcurrent;
  if (change.status !== undefined) body.status = change.status;
  if (body.usd === undefined && body.maxConcurrent === undefined && body.status === undefined) {
    throw new ActionsCliError(
      'invalid_argument',
      'Nothing to change — pass --price, --capacity, or a status command.',
    );
  }
  return body;
}

/**
 * The env var `credential connect` reads a field from: the provider and
 * field names upper-snake-cased — tensorlake + apiKey → TENSORLAKE_API_KEY,
 * blaxel + workspace → BLAXEL_WORKSPACE, namespace + token → NAMESPACE_TOKEN.
 * Secrets belong here (or a session env), never in argv where shell history
 * keeps them.
 */
export function credentialEnvVar(providerId: string, fieldName: string): string {
  const snake = (s: string) =>
    s
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .toUpperCase();
  return `${snake(providerId)}_${snake(fieldName)}`;
}

export interface CredentialResolution {
  /** Every field's value, declared fields only. */
  values: Record<string, string>;
  /** Required fields with no value from either source. */
  missing: MarketCredentialField[];
  /** Field names taken from --field (visible in shell history). */
  fromFlag: string[];
  /** The env var each declared field was looked up under. */
  envNames: Record<string, string>;
}

/**
 * Resolve each declared credential field: an explicit `--field name=value`
 * wins, then the `<PROVIDER>_<FIELD>` env var. Empty strings count as
 * missing on both.
 */
export function credentialValues(
  providerId: string,
  fields: MarketCredentialField[],
  overrides: Record<string, string>,
  env: Record<string, string | undefined> = process.env,
): CredentialResolution {
  const declared = new Set(fields.map((f) => f.name));
  const unknown = Object.keys(overrides).filter((name) => !declared.has(name));
  if (unknown.length > 0) {
    throw new ActionsCliError(
      'invalid_argument',
      `${providerId} takes no credential field "${unknown.join('", "')}" — expected one of ${fields
        .map((f) => f.name)
        .join(', ')}.`,
    );
  }
  const values: Record<string, string> = {};
  const fromFlag: string[] = [];
  const missing: MarketCredentialField[] = [];
  const envNames: Record<string, string> = {};
  for (const field of fields) {
    envNames[field.name] = credentialEnvVar(providerId, field.name);
    const fromOverride = overrides[field.name];
    if (fromOverride !== undefined && fromOverride.trim() !== '') {
      values[field.name] = fromOverride.trim();
      fromFlag.push(field.name);
      continue;
    }
    const fromEnv = env[envNames[field.name]];
    if (fromEnv !== undefined && fromEnv.trim() !== '') {
      values[field.name] = fromEnv.trim();
      continue;
    }
    if (field.required !== false) missing.push(field);
  }
  return { values, missing, fromFlag, envNames };
}

/**
 * The `POST /api/v1/market/provider/credential` body: `{key}` for a
 * single-field executor, `{fields}` for a multi-field one — the same two
 * shapes the org provider-key routes take.
 */
export function credentialBody(
  fields: MarketCredentialField[],
  values: Record<string, string>,
): Record<string, unknown> {
  if (fields.length === 1) {
    return { key: values[fields[0].name] };
  }
  return { fields: values };
}

// ─── Formatting (pure, exported for tests) ──────────────────────────────────

/** `$0.12`, `$5` — micro-USD-precision dollars without trailing zeros. */
export function formatUsd(usd: number): string {
  return `$${usd.toFixed(6).replace(/\.?0+$/, '')}`;
}

/** `$0.12/second` — how a listing (or offer, or sale) is priced. */
export function formatRate(usd: number, per: string): string {
  return `${formatUsd(usd)}/${per}`;
}

/** The human status: withdrawn > paused > expired > live. */
export function formatListingStatus(ask: Pick<MarketAsk, 'status' | 'live' | 'pendingUsd' | 'pendingPer'>): string {
  let label: string;
  if (ask.status === 'withdrawn') label = pc.gray('withdrawn');
  else if (ask.status === 'paused') label = pc.yellow('paused');
  else if (!ask.live) label = pc.gray('expired');
  else label = pc.green('live');
  if (ask.pendingUsd !== null && ask.pendingPer !== null) {
    label += pc.dim(` → ${formatRate(ask.pendingUsd, ask.pendingPer)} next window`);
  }
  return label;
}

export function formatListingRow(ask: MarketAsk): string {
  const expiry = ask.expiresAt
    ? ask.rollover
      ? `renews ${ask.expiresAt}`
      : `expires ${ask.expiresAt}`
    : 'standing';
  return [
    ask.id,
    formatListingStatus(ask),
    pc.dim(ask.useCase === 'sandbox' ? 'sandbox' : 'actions'),
    safeTerm(ask.size),
    safeTerm(ask.region ?? '-'),
    formatRate(ask.usd, ask.per),
    pc.dim(`×${ask.maxConcurrent}`),
    pc.dim(expiry),
  ].join('  ');
}

export function formatProviderStatus(p: MarketProvider): string {
  const lines: string[] = [];
  lines.push(`${pc.bold(safeTerm(p.name))}  ${pc.dim(`selling ${safeTerm(p.provider)}`)}`);
  lines.push(`id:          ${p.id}`);
  lines.push(
    `credential:  ${
      p.executorCredentialConnected
        ? pc.green('connected')
        : pc.yellow('not connected — your listings cannot fill until `compute market credential connect`')
    }`,
  );
  if (p.revokedAt) lines.push(pc.red(`revoked:     ${p.revokedAt}`));
  lines.push(
    `lanes:       ${(p.useCases ?? ['actions']).join(', ')}`,
  );
  lines.push(
    `sizes:       ${p.sizes.map((s) => `${s.name} (${s.label})`).join(', ') || '-'}`,
  );
  lines.push(`regions:     ${p.regions.join(', ') || '-'}`);
  if (p.credentialFields.length > 0) {
    lines.push(
      `credential fields: ${p.credentialFields
        .map((f) => `${f.name}${f.secret ? ' (secret)' : ''}`)
        .join(', ')}`,
    );
  }
  lines.push(`created:     ${p.createdAt}`);
  return lines.join('\n');
}

/** The live book, plainly labeled: who's selling, who's buying, what cleared. */
export function formatBook(book: MarketOrderBook): string {
  const lines: string[] = [];
  const lane = (useCase?: 'actions' | 'sandbox') =>
    pc.dim(useCase === 'sandbox' ? 'sandbox' : 'actions');
  lines.push(pc.bold("sellers' asking prices"));
  if (book.asks.length === 0) lines.push(pc.dim('  no listings are live'));
  for (const ask of book.asks) {
    const where = ask.region ? safeTerm(ask.region) : 'any region';
    const expiry = ask.expiresAt
      ? pc.dim(ask.rollover ? `  renews ${ask.expiresAt}` : `  until ${ask.expiresAt}`)
      : '';
    lines.push(
      `  ${lane(ask.useCase)}  ${formatRate(ask.usd, ask.per)}  ${safeTerm(ask.providerName)}  ${safeTerm(ask.size)}  ${where}  up to ${ask.maxConcurrent} at once${expiry}`,
    );
  }
  lines.push('');
  lines.push(pc.bold('buyer offers'));
  if (book.bids.length === 0) lines.push(pc.dim('  no open offers'));
  for (const bid of book.bids) {
    const where = bid.region ? safeTerm(bid.region) : 'anywhere';
    const yours = bid.mine ? pc.cyan(' (yours)') : '';
    lines.push(
      `  ${lane(bid.useCase)}  pays up to ${formatRate(bid.maxUsd, bid.per)}  ${safeTerm(bid.size)}  ${where}  ${pc.dim(`posted ${bid.createdAt}`)}${yours}`,
    );
  }
  lines.push('');
  lines.push(pc.bold('recent sales'));
  if (book.fills.length === 0) lines.push(pc.dim('  nothing has sold yet'));
  for (const fill of book.fills) {
    const statusNote =
      fill.status === 'replaced'
        ? pc.yellow('  replaced')
        : fill.status === 'closed'
          ? pc.gray('  closed')
          : '';
    lines.push(
      `  ${pc.dim(fill.id)}  ${lane(fill.useCase)}  ${formatRate(fill.usd, fill.per)}  ${safeTerm(fill.provider)}  ${safeTerm(fill.size)}  ${safeTerm(fill.region ?? '-')}  ${pc.dim(fill.createdAt)}${statusNote}`,
    );
  }
  return lines.join('\n');
}

/** `replaced  f-1  settled $0.0003` (+ a note when an Actions job re-places). */
export function formatReplacedFill(fill: MarketReplacedFill): string {
  const settled = formatUsd(fill.settledMicroUsd / 1e6);
  const job = fill.jobRequeued
    ? pc.dim(" — job re-places on the buyer's next provider")
    : '';
  return `replaced  ${pc.cyan(fill.fillId)}  settled ${settled}${job}`;
}

/**
 * `compute market replace` resolves to exactly one endpoint: `--fill` evicts
 * one sale, a listing ID pauses the listing and evicts every sale on it.
 */
export function replaceTarget(
  listingId: string | undefined,
  fillId: string | undefined,
): { path: string; scope: 'listing' | 'fill' } {
  if (fillId !== undefined) {
    return {
      path: `/api/v1/market/fills/${encodeURIComponent(fillId)}/replace`,
      scope: 'fill',
    };
  }
  if (listingId === undefined) {
    throw new ActionsCliError(
      'invalid_argument',
      'Nothing to replace — pass a listing ID or --fill <fill-id>.',
    );
  }
  return {
    path: `/api/v1/market/listings/${encodeURIComponent(listingId)}/replace`,
    scope: 'listing',
  };
}

export function formatSettlementRow(s: MarketSettlement): string {
  const period = `${s.periodStart.slice(0, 10)} → ${s.periodEnd.slice(0, 10)}`;
  const paid = s.paidAt
    ? pc.green(`paid ${s.paidAt.slice(0, 10)}`)
    : s.invoiceRef
      ? pc.yellow(`invoiced ${safeTerm(s.invoiceRef)}`)
      : pc.dim('unpaid');
  return [
    pc.dim(period),
    `${s.vcpuSeconds.toLocaleString('en-US')} vCPU·s`,
    `gross ${formatUsd(s.grossUsd)}`,
    `net ${formatUsd(s.netUsd)}`,
    paid,
  ].join('  ');
}

// ─── Commands ───────────────────────────────────────────────────────────────

export function registerMarketCommands(program: Command): void {
  const market = program
    .command('market')
    .description('Sell compute capacity on the compute market')
    .configureOutput({ outputError: usageErrorOutput });

  const common = (cmd: Command) =>
    cmd
      .option('--api-key <key>', 'API key (default: $COMPUTE_API_KEY)')
      .option('--base-url <url>', 'API base URL (default: https://platform.computesdk.com)')
      .option('--org <slug>', 'organization slug for this command (or $COMPUTE_ORG)')
      .option('--allow-untrusted-host', 'send an explicit --api-key/env key to a non-computesdk, non-localhost --base-url (stored login credentials are never sent)')
      .option('--json', 'print machine-readable JSON');

  common(
    market
      .command('listings')
      .alias('list')
      .description('Your listings — live, paused, expired, and withdrawn'),
  ).action(async (opts: CommonOpts) => {
    try {
      const { asks } = await (await client(opts)).get<{ asks: MarketAsk[] }>(
        '/api/v1/market/asks',
      );
      output(opts, asks, (rows) => {
        if (rows.length === 0) {
          console.log('No listings yet — post one with `compute market sell`.');
          return;
        }
        for (const ask of rows) console.log(formatListingRow(ask));
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    market
      .command('sell')
      .description('Post a listing: sell capacity at a price')
      .requiredOption('--price <usd/unit>', 'price per unit of time (e.g. 0.12/hour)')
      .option('--per <unit>', 'unit for a bare --price usd (second, minute, or hour)')
      .option('--size <tier>', 'size tier to sell (default: medium, else the provider\'s first tier)')
      .option('--use-case <lane>', 'lane to sell into: actions or sandbox (default: actions)')
      .option('--region <region>', 'region to sell in (default: anywhere the provider runs)')
      .option('--capacity <n>', 'max simultaneous fills (default: 1)')
      .option('--expires-in <hours>', 'delist after this many hours (default: standing)')
      .option('--renew', 're-list for the same window each time it expires (requires --expires-in)'),
  ).action(async (opts: CommonOpts & { price: string; per?: string; size?: string; region?: string; capacity?: string; expiresIn?: string; renew?: boolean; useCase?: string }) => {
    try {
      const c = await client(opts);
      // Validate the lane before any network writes — an unapproved lane
      // still fails server-side with market_lane_not_approved.
      const useCase = parseMarketLane(opts.useCase);
      let size = opts.size;
      if (size === undefined) {
        // The tier is required by the API; when the seller doesn't name one,
        // the provider's middle tier (or first) is the sensible default.
        const { provider } = await c.get<{ provider: MarketProvider }>(
          '/api/v1/market/provider',
        );
        const preset =
          provider.sizes.find((s) => s.name === 'medium') ?? provider.sizes[0];
        if (!preset) {
          throw new ActionsCliError(
            'invalid_argument',
            `--size is required — ${provider.provider} advertises no size tiers.`,
          );
        }
        size = preset.name;
        console.error(pc.dim(`no --size given — listing at "${size}"`));
      }
      const result = await c.post<{ ask: MarketAsk }>(
        '/api/v1/market/asks',
        sellBody({ ...opts, size, useCase }),
      );
      output(opts, result, (r) => {
        console.log(`listed  ${pc.cyan(r.ask.id)}`);
        console.log(formatListingRow(r.ask));
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    market
      .command('price')
      .description('Reprice a listing')
      .argument('<listing-id>', 'listing ID')
      .requiredOption('--price <usd/unit>', 'new price per unit of time (e.g. 0.08/hour)')
      .option('--per <unit>', 'unit for a bare --price usd (second, minute, or hour)'),
  ).action(async (listingId: string, opts: CommonOpts & { price: string; per?: string }) => {
    try {
      const result = await (await client(opts)).post<{ ask: MarketAsk }>(
        '/api/v1/market/asks',
        listingPatchBody(listingId, { price: opts.price, per: opts.per }),
      );
      output(opts, result, (r) => {
        // A committed-window (rollover) listing keeps its rate in usd/per
        // until the window renews; the new rate sits in pendingUsd/pendingPer.
        const rate =
          r.ask.pendingUsd !== null && r.ask.pendingPer !== null
            ? `${formatRate(r.ask.pendingUsd, r.ask.pendingPer)} ${pc.dim('(applies next window)')}`
            : formatRate(r.ask.usd, r.ask.per);
        console.log(`repriced  ${pc.cyan(r.ask.id)}  ${rate}`);
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  const setStatus = async (
    listingId: string,
    status: 'live' | 'paused',
    opts: CommonOpts,
  ): Promise<void> => {
    try {
      const result = await (await client(opts)).post<{ ask: MarketAsk }>(
        '/api/v1/market/asks',
        listingPatchBody(listingId, { status }),
      );
      output(opts, result, (r) => {
        console.log(`${status === 'live' ? 'resumed' : 'paused'}  ${pc.cyan(r.ask.id)}`);
      });
    } catch (e) {
      fail(e, opts);
    }
  };

  common(
    market
      .command('pause')
      .description('Pause a listing — it stays posted but cannot fill')
      .argument('<listing-id>', 'listing ID'),
  ).action((listingId: string, opts: CommonOpts) => setStatus(listingId, 'paused', opts));

  common(
    market
      .command('resume')
      .description('Resume a paused listing')
      .argument('<listing-id>', 'listing ID'),
  ).action((listingId, opts: CommonOpts) => setStatus(listingId, 'live', opts));

  common(
    market
      .command('withdraw')
      .description('Withdraw a listing — it leaves the book for good')
      .argument('<listing-id>', 'listing ID'),
  ).action(async (listingId: string, opts: CommonOpts) => {
    try {
      const result = await (await client(opts)).del<{ ask: MarketAsk }>(
        `/api/v1/market/asks?id=${encodeURIComponent(listingId)}`,
      );
      output(opts, result, (r) => {
        console.log(`withdrew  ${pc.cyan(r.ask.id)}`);
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    market
      .command('replace')
      .description(
        'Take capacity back: evict a sale, or pause a listing and evict every sale on it.\n' +
          "An evicted Actions job restarts on the buyer's next provider; the buyer pays\n" +
          'only for the seconds the sale actually ran.',
      )
      .argument('[listing-id]', 'listing to pause and evict every sale on')
      .option('--fill <fill-id>', 'evict one sale without touching the listing'),
  ).action(
    async (
      listingId: string | undefined,
      opts: CommonOpts & { fill?: string },
    ) => {
      try {
        const target = replaceTarget(listingId, opts.fill);
        const c = await client(opts);
        if (target.scope === 'fill') {
          const result = await c.post<{ fill: MarketReplacedFill }>(target.path, {});
          output(opts, result, (r) => console.log(formatReplacedFill(r.fill)));
        } else {
          const result = await c.post<MarketListingReplaceResult>(target.path, {});
          output(opts, result, (r) => {
            console.log(`paused  ${pc.cyan(r.listing.id)}`);
            if (r.fills.length === 0) {
              console.log(pc.dim('  no live sales to evict'));
              return;
            }
            for (const f of r.fills) {
              if (f.ok) console.log(formatReplacedFill(f.fill));
              else console.log(pc.red(`  could not evict a sale — ${f.error}`));
            }
          });
          // A partial eviction is not success: some sales are still running.
          if (result.fills.some((f) => !f.ok)) process.exitCode = 1;
        }
      } catch (e) {
        fail(e, opts);
      }
    },
  );

  common(
    market
      .command('book')
      .description("Live prices: sellers' asking prices, buyer offers, recent sales")
      .option('--use-case <lane>', 'only this lane: actions or sandbox (default: both)'),
  ).action(async (opts: CommonOpts & { useCase?: string }) => {
    try {
      const lane = opts.useCase === undefined ? undefined : parseMarketLane(opts.useCase);
      const book = await (await client(opts)).get<MarketOrderBook>(
        `/api/v1/market/book${lane ? `?useCase=${lane}` : ''}`,
      );
      output(opts, book, (b) => console.log(formatBook(b)));
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    market
      .command('settlements')
      .description('Your monthly payout reports'),
  ).action(async (opts: CommonOpts) => {
    try {
      const { settlements } = await (await client(opts)).get<{
        settlements: MarketSettlement[];
      }>('/api/v1/market/settlements');
      output(opts, settlements, (rows) => {
        if (rows.length === 0) {
          console.log('No settlements yet.');
          return;
        }
        for (const s of rows) console.log(formatSettlementRow(s));
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    market
      .command('status')
      .description('Who you are on the market: seller identity, credential, sizes, regions'),
  ).action(async (opts: CommonOpts) => {
    try {
      const { provider } = await (await client(opts)).get<{
        provider: MarketProvider;
      }>('/api/v1/market/provider');
      output(opts, provider, (p) => console.log(formatProviderStatus(p)));
    } catch (e) {
      fail(e, opts);
    }
  });

  const credential = market
    .command('credential')
    .description('Connect the credential your listings fill under');

  common(
    credential
      .command('connect')
      .description(
        'Save the executor credential your sold capacity runs under. Each field is read from\n' +
          'a <PROVIDER>_<FIELD> env var (e.g. TENSORLAKE_API_KEY) — never pass secrets in argv;\n' +
          '--field name=value overrides a field (visible in shell history)',
      )
      .option('--field <pairs...>', 'credential fields as name=value (prefer env vars for secrets)'),
  ).action(async (opts: CommonOpts & { field?: string[] }) => {
    try {
      const c = await secretValueClient(opts, 'credential values');
      const { provider } = await c.get<{ provider: MarketProvider }>(
        '/api/v1/market/provider',
      );
      if (provider.credentialFields.length === 0) {
        throw new ActionsCliError(
          'invalid_argument',
          `${provider.provider} authenticates with the deployment's own identity — there is no credential to connect.`,
        );
      }
      const resolved = credentialValues(
        provider.provider,
        provider.credentialFields,
        parseInputs(opts.field),
      );
      if (resolved.missing.length > 0) {
        const hints = resolved.missing
          .map((f) => `  export ${resolved.envNames[f.name]}=…   # ${f.label}`)
          .join('\n');
        throw new ActionsCliError(
          'invalid_argument',
          `Missing credential field${resolved.missing.length === 1 ? '' : 's'}. Set:\n${hints}`,
        );
      }
      if (resolved.fromFlag.some((name) => provider.credentialFields.find((f) => f.name === name)?.secret)) {
        console.error(
          pc.yellow('note: a secret passed via --field stays in your shell history — prefer the env vars.'),
        );
      }
      const result = await c.post<{ provider: MarketProvider }>(
        '/api/v1/market/provider/credential',
        credentialBody(provider.credentialFields, resolved.values),
      );
      output(opts, result, (r) => {
        console.log(`connected  ${pc.cyan(safeTerm(r.provider.name))}  credential saved`);
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    credential
      .command('disconnect')
      .description('Remove the stored credential — listings stop filling until a new one connects'),
  ).action(async (opts: CommonOpts) => {
    try {
      const result = await (await client(opts)).del<{ provider: MarketProvider }>(
        '/api/v1/market/provider/credential',
      );
      output(opts, result, (r) => {
        console.log(`disconnected  ${pc.cyan(safeTerm(r.provider.name))}  credential removed`);
      });
    } catch (e) {
      fail(e, opts);
    }
  });
}
