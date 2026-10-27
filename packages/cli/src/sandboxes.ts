/**
 * `compute instances` (alias `compute sandboxes`) — drive instances placed through the platform's
 * `/api/v1/sandboxes` API: create/list/get/destroy, exec commands, spawn and
 * control detached processes, read/write the filesystem, and resolve port
 * URLs.
 *
 * Auth: identical to `compute actions`/`compute market` — --api-key /
 * COMPUTE_API_KEY / the stored `compute login` session. Types
 * mirror the wire shapes in benchmarks-platform `lib/sandboxes/*` — keep
 * them in sync by hand; the API is the contract.
 */

import * as readline from 'node:readline';
import { Command } from 'commander';
import pc from 'picocolors';
import { ActionsApiError, type ActionsClient } from './actions-client.js';
import {
  client,
  fail,
  output,
  parseInputs,
  safeTerm,
  usageErrorOutput,
  type CommonOpts,
} from './actions.js';
import {
  clearCurrentInstance,
  dirKey,
  isUuid,
  orgKey,
  readFileCurrent,
  resolveInstanceId,
  setCurrentInstance,
  shortId,
} from './current-instance.js';
import { formatMoney, formatRateAllUnits, formatUsd, formatUsdPer, rateAllUnits } from './rate-display.js';
import { parseMaxPrice, registerSettingsCommands } from './settings.js';

// ─── Wire types (mirror benchmarks-platform lib/sandboxes) ──────────────────

export interface SandboxCost {
  rate: { usd: number; unit: string } | null;
  runtimeSeconds: number;
  costUsd: number | null;
  settled: boolean;
}

/** `toSummary` — one row of GET /api/v1/sandboxes. */
export interface SandboxSummary {
  id: string;
  label: string | null;
  provider: string | null;
  providerSandboxId: string | null;
  status: 'creating' | 'running' | 'destroyed' | string;
  placementAttempts: unknown[];
  commandCount: number;
  secrets: string[];
  /** The `boot.image` asked for, and what the provider actually booted. */
  requestedImage: string | null;
  image: string | null;
  createdAt: string;
  lastCommandAt: string | null;
  destroyedAt: string | null;
  destroyError: string | null;
  /** How the sandbox was placed — source, order type, rate, max price, the
   * requested platform `size` and the seller's `box` on a market fill. */
  placement: {
    source: 'market' | 'own-key';
    size?: string | null;
    box?: {
      provider: string;
      sizeName: string | null;
      resources?: { cpus: number | null; memoryMb: number | null; ephemeralDiskMb: number | null };
    };
    orderType?: 'market' | 'limit';
    rate: { usd: number; per: string };
    maxPrice?: { usd: number; per: string };
  } | null;
  cost: SandboxCost;
}

/** `toDetail` — POST /sandboxes and GET /sandboxes/{id}. */
export interface SandboxDetail extends SandboxSummary {
  /** BYOK direct-attach descriptor — null on market fills and ambient providers. */
  attach: { provider: string; providerSandboxId: string; region: string | null } | null;
}

export interface SandboxProcess {
  id: string;
  jobId: string;
  pid: number | null;
  command: string;
  cwd: string | null;
  envNames: string[];
  /** Whether the job's stdin pipe is open (spawn `--stdin`). */
  stdin: boolean;
  status: string;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  exitedAt: string | null;
}

export interface SandboxProcessStatus extends SandboxProcess {
  stdout: string;
  stderr: string;
}

export interface CommandResult {
  commandId: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
}

export type PathView =
  | { path: string; type: 'file'; content: string }
  | { path: string; type: 'directory'; entries: FileEntry[] };

/** `snapshotView` — one row of GET /sandboxes/{id}/snapshots. */
export interface SandboxSnapshot {
  id: string;
  sandboxId: string;
  provider: string;
  region: string | null;
  providerSnapshotId: string;
  label: string | null;
  expiresAt: string | null;
  createdAt: string;
  deletedAt: string | null;
}

/** POSIX single-quote: argv survives intact through the remote `sh -lc`. */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

// ─── Rendering ───────────────────────────────────────────────────────────────

/** `$0.12/h` — the compact one-unit rate the instance line shows. */
function shortRate(rate: { usd: number; per: string }): string {
  return `${formatUsd(rateAllUnits(rate).perHour)}/h`;
}

/** `2026-10-27 14:02` — a timestamp in the viewer's local time. */
function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The default instance view: one line of ID, status, provider, size and
 * rate, plus a label line when one is set. `--verbose` adds everything the
 * old output printed (providerSandboxId, image, full placement, command
 * count, attach). `attach` never leaves `--json`.
 */
function printSandbox(s: SandboxSummary, verbose = false): void {
  const p = s.placement;
  console.log(
    `${pc.cyan(s.id)}  ${s.status}  ${p?.box?.provider ?? s.provider ?? '—'}  ${p?.size ?? '—'}  ${p ? shortRate(p.rate) : '—'}`,
  );
  if (s.label) {
    console.log(`  label: ${s.label}   created: ${formatLocalTime(s.createdAt)}`);
  }
  if (s.destroyError) console.log(`  destroyError: ${pc.red(s.destroyError)}`);
  if (!verbose) return;
  console.log(`  providerSandboxId: ${s.providerSandboxId ?? '—'}   commands: ${s.commandCount}`);
  if (s.image !== undefined) {
    console.log(`  image: ${s.image ?? '—'}${s.requestedImage !== null && s.requestedImage !== s.image ? `  ${pc.dim(`(requested: ${s.requestedImage})`)}` : ''}`);
  }
  if (p) {
    const box = p.box
      ? ` / ${p.box.sizeName ?? 'custom'}${p.box.resources ? ` (${p.box.resources.cpus ?? '?'} vCPU / ${p.box.resources.memoryMb ?? '?'} MB)` : ''}`
      : '';
    console.log(
      `  placement: ${p.source}${box}   order: ${p.orderType ?? '—'}   rate: ${formatUsdPer(p.rate)}` +
        `${p.maxPrice ? `   max price: ${formatUsdPer(p.maxPrice)}` : ''}`,
    );
  }
  const attach = 'attach' in s ? (s as SandboxDetail).attach : undefined;
  if (attach !== undefined) {
    console.log(
      attach === null
        ? '  attach: none (market fill or ambient provider — platform drive only)'
        : `  attach: ${attach.provider} / ${attach.providerSandboxId}${attach.region ? ` (${attach.region})` : ''}`,
    );
  }
}

/** The GET /sandboxes/quote payload — mirrors SandboxQuote on the platform. */
interface SandboxQuoteWire {
  ok: boolean;
  reason?: string;
  providerOrder: string[];
  orderType: 'market' | 'limit';
  placement?: {
    source: 'market' | 'own-key';
    provider: string;
    region: string | null;
    size: string | null;
    box?: {
      provider: string;
      sizeName: string | null;
      resources?: { cpus: number | null; memoryMb: number | null; ephemeralDiskMb: number | null };
    };
  };
  rate?: { usd: number; per: string };
  rateUsd?: { perSecond: number; perMinute: number; perHour: number };
  maxPrice?: { usd: number; per: string };
  estimatedCostUsd?: number;
  marketCapUsdPerHour?: number;
  protectionLimitUsdPerHour?: number;
  cheapestLiveUsdPerHour?: number;
  referenceUsdPerHour?: number;
  liveAskDepth?: number;
  creditBalanceUsd: number;
  requiredHoldUsd?: number;
  topUpPath?: string;
}

/** A per-hour dollar field off the wire → all-units display (`—` when absent). */
const perHour = (n: number | undefined): string =>
  n === undefined ? '—' : formatRateAllUnits(rateAllUnits({ usd: n, per: 'hour' }));

const usdAmount = (n: number | undefined): string => (n === undefined ? '—' : formatMoney(n));

function printQuote(q: SandboxQuoteWire, timeoutMs?: string): void {
  console.log(`quote: ${q.ok ? pc.green('ok') : pc.red(q.reason ?? 'unfillable')}`);
  const box = q.placement?.box;
  console.log(
    `  size: ${q.placement?.size ?? '—'}   provider: ${q.placement?.provider ?? '—'}` +
      (box ? `   box: ${box.sizeName ?? 'custom'} (${box.provider}${box.resources ? `, ${box.resources.cpus ?? '?'} vCPU / ${box.resources.memoryMb ?? '?'} MB` : ''})` : ''),
  );
  console.log(`  order type: ${q.orderType}   order: ${q.providerOrder.join(', ')}`);
  if (q.rateUsd) {
    console.log(`  rate: ${formatRateAllUnits(q.rateUsd)}`);
  } else if (q.rate) {
    console.log(`  rate: ${formatUsdPer(q.rate)}`);
  }
  console.log(`  cheapest live: ${perHour(q.cheapestLiveUsdPerHour)}`);
  console.log(`  reference: ${perHour(q.referenceUsdPerHour)}`);
  const timeout = timeoutMs !== undefined ? ` for ${timeoutMs}ms` : '';
  console.log(
    `  est. cost${timeout}: ${usdAmount(q.estimatedCostUsd)}   required hold: ${usdAmount(q.requiredHoldUsd)}` +
      `   balance: ${usdAmount(q.creditBalanceUsd)}`,
  );
  console.log(`  cap: ${q.maxPrice ? formatUsdPer(q.maxPrice) : perHour(q.marketCapUsdPerHour)}`);
  console.log(`  protection limit: ${perHour(q.protectionLimitUsdPerHour)}`);
  if (!q.ok && q.topUpPath) console.log(`  ${pc.dim(`→ ${q.topUpPath}`)}`);
  if (q.liveAskDepth !== undefined) console.log(`  ${pc.dim(`live asks: ${q.liveAskDepth}`)}`);
}

function printProcess(p: SandboxProcess | SandboxProcessStatus): void {
  const exit = p.status === 'exited' ? `exit=${p.exitCode ?? '?'}${p.signal ? ` (${p.signal})` : ''}` : '';
  const stdin = p.stdin && p.status === 'running' ? '  [stdin open]' : '';
  console.log(`${pc.cyan(p.jobId)}  ${p.status}${exit ? '  ' + exit : ''}${stdin}  ${p.command}`);
}

function printSnapshot(s: SandboxSnapshot): void {
  const state = s.deletedAt !== null ? `  ${pc.dim(`(deleted ${s.deletedAt})`)}` : '';
  console.log(`${pc.cyan(s.id)}  ${s.providerSnapshotId}${state}`);
  console.log(
    `  provider: ${s.provider}${s.region ? ` (${s.region})` : ''}   label: ${s.label ?? '—'}   created: ${s.createdAt}${s.expiresAt ? `   expires: ${s.expiresAt}` : ''}`,
  );
}

// ─── Commands ────────────────────────────────────────────────────────────────

interface LeadOptSpec {
  /** Accepted spellings, e.g. ['-e', '--env']. */
  aliases: string[];
  /** Commander-style camelCase key merged into the parsed options. */
  key: string;
  /** 'bool' takes no value; 'value' takes one; 'repeat' collects repeated values. */
  flag: 'bool' | 'value' | 'repeat';
}

const AUTH_LEAD_OPTS: LeadOptSpec[] = [
  { aliases: ['--api-key'], key: 'apiKey', flag: 'value' },
  { aliases: ['--base-url'], key: 'baseUrl', flag: 'value' },
  { aliases: ['--allow-untrusted-host'], key: 'allowUntrustedHost', flag: 'bool' },
  { aliases: ['--org'], key: 'org', flag: 'value' },
  { aliases: ['--json'], key: 'json', flag: 'bool' },
];

const EXEC_LEAD_OPTS: LeadOptSpec[] = [
  ...AUTH_LEAD_OPTS,
  { aliases: ['--timeout-ms'], key: 'timeoutMs', flag: 'value' },
];

const SPAWN_LEAD_OPTS: LeadOptSpec[] = [
  ...AUTH_LEAD_OPTS,
  { aliases: ['-q', '--quiet'], key: 'quiet', flag: 'bool' },
  { aliases: ['--cwd'], key: 'cwd', flag: 'value' },
  { aliases: ['-e', '--env'], key: 'env', flag: 'repeat' },
  { aliases: ['--stdin'], key: 'stdin', flag: 'bool' },
];

const SERVE_LEAD_OPTS: LeadOptSpec[] = [
  ...SPAWN_LEAD_OPTS,
  { aliases: ['--port'], key: 'port', flag: 'value' },
  { aliases: ['--timeout-ms'], key: 'timeoutMs', flag: 'value' },
];

/**
 * `exec`/`spawn` run under `.passThroughOptions()`: everything after
 * `<sandboxId>` arrives in the variadic `<command...>` untouched, so a flag
 * like `uname -a` or `node -e …` reaches the sandbox instead of being eaten
 * as a CLI option. CLI options still parse when placed *before* the sandbox
 * id; this helper additionally accepts them between the id and the command —
 * parse leading known options, stop at the first non-option word or `--`.
 */
export function takeLeadingOptions(
  argv: string[],
  specs: LeadOptSpec[],
): { command: string[]; inline: Record<string, string | string[] | true> } {
  const byAlias = new Map<string, LeadOptSpec>();
  for (const spec of specs) for (const alias of spec.aliases) byAlias.set(alias, spec);
  const inline: Record<string, string | string[] | true> = {};
  let i = 0;
  for (; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') {
      i++;
      break;
    }
    if (!token.startsWith('-') || token === '-') break;
    const eq = token.indexOf('=');
    const flag = eq === -1 ? token : token.slice(0, eq);
    let spec = byAlias.get(flag);
    // Attached short-option value, e.g. `-eFOO=bar` (commander accepts the
    // same form before the sandbox id).
    let attached: string | undefined;
    if (!spec && !flag.startsWith('--') && flag.length > 2) {
      const shortSpec = byAlias.get(flag.slice(0, 2));
      if (shortSpec && shortSpec.flag !== 'bool') {
        spec = shortSpec;
        attached = flag.slice(2);
        if (attached.startsWith('=')) attached = attached.slice(1);
        if (eq !== -1) attached += token.slice(eq);
      }
    }
    if (!spec) {
      throw new Error(
        `unknown option '${flag}' — pass CLI options before the command, or use -- to separate them`,
      );
    }
    if (spec.flag === 'bool') {
      if (eq !== -1) throw new Error(`option '${flag}' takes no value`);
      inline[spec.key] = true;
    } else {
      const value = attached ?? (eq !== -1 ? token.slice(eq + 1) : argv[++i]);
      if (value === undefined) throw new Error(`option '${flag}' requires a value`);
      if (spec.flag === 'repeat') {
        ((inline[spec.key] ??= []) as string[]).push(value);
      } else {
        inline[spec.key] = value;
      }
    }
  }
  return { command: argv.slice(i), inline };
}

function mergeLeadOpts<T>(opts: T, inline: Record<string, string | string[] | true>): T {
  const merged = { ...opts } as Record<string, unknown>;
  for (const [key, value] of Object.entries(inline)) {
    if (Array.isArray(value)) {
      merged[key] = [...((merged[key] as string[] | undefined) ?? []), ...value];
    } else {
      merged[key] = value;
    }
  }
  return merged as T;
}

// ─── Output modes and current-instance resolution ────────────────────────────

type QuietOpts = CommonOpts & { quiet?: boolean; verbose?: boolean };

/** `--quiet` and `--json` together is a usage error. */
function checkQuietJson(opts: QuietOpts): void {
  if (opts.quiet && opts.json) throw new Error('--quiet and --json cannot be combined');
}

/** --quiet prints only `quietLine(data)`; otherwise the --json/human path. */
function emitResult<T>(
  opts: QuietOpts,
  data: T,
  quietLine: (d: T) => string,
  render: (d: T) => void,
): void {
  if (opts.quiet) {
    console.log(quietLine(data));
    return;
  }
  output(opts, data, render);
}

const NO_INSTANCE_HINT =
  'No instance given. Pass an ID, run `compute instances use <id>`, or set COMPUTE_INSTANCE.';

interface ResolvedSandbox {
  id: string;
  /** Clears the stored pick when the API proves it stale (404), and says so. */
  clearStale: (error: unknown) => void;
}

/**
 * Resolves the instance a command runs on: explicit UUID > COMPUTE_INSTANCE >
 * this directory's stored pick. When the pick was implicit a dim line names
 * it on stderr so a human sees which box the command hit (silent in
 * --json/--quiet so scripts stay clean).
 */
function resolveSandbox(argId: string | undefined, opts: QuietOpts): ResolvedSandbox {
  const r = resolveInstanceId(argId, opts);
  if (!r) throw new Error(NO_INSTANCE_HINT);
  if (r.source !== 'argument' && !opts.json && !opts.quiet) {
    console.error(
      pc.dim(
        `instance ${shortId(r.id)} (${r.source === 'env' ? 'COMPUTE_INSTANCE' : `current for ${r.dir}`})`,
      ),
    );
  }
  const org = orgKey(opts);
  return {
    id: r.id,
    clearStale: (error) => {
      if (
        r.source === 'file' &&
        error instanceof ActionsApiError &&
        error.status === 404 &&
        readFileCurrent(org) === r.id
      ) {
        clearCurrentInstance(org);
        console.error(pc.dim(`cleared stale current instance ${shortId(r.id)}`));
      }
    },
  };
}

/** The positional-id rule: only a UUID may occupy the `[sandboxId]` slot. */
function requireUuidOrImplicit(argId: string | undefined, opts: QuietOpts): ResolvedSandbox {
  if (argId !== undefined && !isUuid(argId)) {
    throw new Error(`"${argId}" is not a sandbox ID — expected a UUID.`);
  }
  return resolveSandbox(argId, opts);
}

/**
 * `[resourceOrSandboxId] [resourceId]` commands (logs/wait/kill/stdin/
 * close-stdin/snapshot-delete): one positional is the resource on the
 * implicit instance — UUID-shaped or not; two positionals are always
 * `<sandboxId> <resourceId>`.
 */
function resolveTwoArgTarget(
  argId: string | undefined,
  resourceId: string | undefined,
  opts: QuietOpts,
  label: string,
): { resolved: ResolvedSandbox; resource: string } {
  if (resourceId === undefined) {
    if (argId === undefined) throw new Error(`missing ${label}`);
    return { resolved: resolveSandbox(undefined, opts), resource: argId };
  }
  if (argId !== undefined && !isUuid(argId)) {
    throw new Error(`"${argId}" is not a sandbox ID — expected a UUID.`);
  }
  return { resolved: resolveSandbox(argId, opts), resource: resourceId };
}

// ─── create/run shared flags ─────────────────────────────────────────────────

/** The create options `create` and `run` share — declared once. */
function addCreateFlags(c: Command): Command {
  return c
    .option('--order <providers>', 'provider order, comma-separated (e.g. "market,blaxel,vercel")')
    .option('--size <size>', 'platform size: small (1 vCPU/2 GB), medium, large, xlarge (8/16 GB); default medium')
    .option('--label <label>', 'label for the sandbox')
    .option('--image <image>', 'container image to boot')
    .option('--snapshot-id <id>', 'provider snapshot to resume')
    .option('--cpus <n>', 'CPU cores (raw resources — mutually exclusive with --size)')
    .option('--memory-mb <n>', 'memory in MB (raw resources)')
    .option('--disk-mb <n>', 'ephemeral disk in MB (raw resources)')
    .option('--max-price <usd/unit>', 'max price for a market fill (e.g. 0.12/hour); makes the create a limit order')
    .option('--max-price-per <unit>', 'unit for a bare --max-price usd (second, minute, or hour)')
    .option('--market', 'place the create on the compute market (order type "market")')
    .option('--order-type <type>', 'explicit market order type: market or limit')
    .option('--timeout-ms <ms>', 'sandbox timeout in ms (provider minimums apply, e.g. blaxel ≥5m)')
    .option('--secret <name>', 'vault secret name to inject (repeatable)', (v, a: string[]) => a.concat(v), [] as string[]);
}

interface CreateFlagOpts {
  order?: string; label?: string; image?: string; snapshotId?: string;
  size?: string; cpus?: string; memoryMb?: string; diskMb?: string; timeoutMs?: string;
  maxPrice?: string; maxPricePer?: string; market?: boolean; orderType?: string;
  secret?: string[];
}

/** The POST /api/v1/sandboxes body `create` and `run` share. */
function buildCreateBody(opts: CreateFlagOpts): Record<string, unknown> {
  const resources: Record<string, number> = {};
  if (opts.cpus) resources.cpus = Number(opts.cpus);
  if (opts.memoryMb) resources.memoryMb = Number(opts.memoryMb);
  if (opts.diskMb) resources.ephemeralDiskMb = Number(opts.diskMb);
  const body: Record<string, unknown> = {};
  if (opts.order) body.providerOrder = opts.order.split(',').map((s) => s.trim());
  if (opts.size) body.size = opts.size;
  if (opts.label) body.label = opts.label;
  if (opts.image) body.image = opts.image;
  if (opts.snapshotId) body.snapshotId = opts.snapshotId;
  if (opts.timeoutMs) body.timeoutMs = Number(opts.timeoutMs);
  if (opts.secret && opts.secret.length > 0) body.secrets = opts.secret;
  if (Object.keys(resources).length > 0) body.resources = resources;
  const maxPrice = parseMaxPrice(opts.maxPrice, opts.maxPricePer);
  if (maxPrice) body.maxPrice = { usd: maxPrice.usd, per: maxPrice.per };
  if (opts.orderType && opts.market) {
    throw new Error('--market and --order-type are mutually exclusive.');
  }
  if (opts.orderType) body.orderType = opts.orderType;
  if (opts.market) body.orderType = 'market';
  return body;
}

/** `1h` / `30m` / `90s` — compact timeout text for the detach summary. */
function fmtTimeout(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

/** Mirrors DEFAULT_SANDBOX_TIMEOUT_MS in benchmarks-platform lib/sandboxes/acquire.ts. */
const PLATFORM_DEFAULT_TIMEOUT_MS = 30 * 60_000;

export function registerSandboxesCommands(program: Command): void {
  const cmd = program
    .command('instances')
    .alias('sandboxes')
    .alias('sbx')
    .description('Create and drive compute instances through the platform')
    .enablePositionalOptions()
    .configureOutput({ outputError: usageErrorOutput });

  addCreateFlags(
    cmd
      .command('create')
      .description('Place a sandbox (provider order walks 1,2,3; "market" bids first)'),
  )
    .option('--no-use', 'do not mark the new instance as this directory\'s current instance')
    .option('-q, --quiet', 'print only the new instance ID')
    .option('--verbose', 'print the full instance details')
    .option('--api-key <key>', 'platform API key (or COMPUTE_API_KEY)')
    .option('--base-url <url>', 'platform base URL')
    .option('--allow-untrusted-host', 'allow non-computesdk.com base URLs')
    .option('--json', 'print the raw response')
    .action(async (opts: QuietOpts & CreateFlagOpts & { use?: boolean }) => {
      try {
        checkQuietJson(opts);
        const c = await client(opts);
        const res = await c.post<{ sandbox: SandboxDetail }>('/api/v1/sandboxes', buildCreateBody(opts));
        // Commander stores --no-use as `use: false`.
        if (opts.use !== false) {
          setCurrentInstance(res.sandbox.id, orgKey(opts));
          if (!opts.json && !opts.quiet) {
            console.error(pc.dim(`instance ${shortId(res.sandbox.id)} (current for ${dirKey()})`));
          }
        }
        emitResult(opts, res.sandbox, (s) => s.id, (s) => printSandbox(s, opts.verbose));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('quote')
    .description('Quote a sandbox create: placement, rate, caps and credits — creates nothing')
    .option('--size <size>', 'platform size (or raw resource flags; default medium)')
    .option('--cpus <n>', 'CPU cores')
    .option('--memory-mb <n>', 'memory in MB')
    .option('--disk-mb <n>', 'ephemeral disk in MB')
    .option('--region <region>', 'pin the placement region')
    .option('--timeout-ms <ms>', 'sandbox timeout in ms (provider minimums apply, e.g. blaxel ≥5m)')
    .option('--order-type <type>', 'market order type: market or limit')
    .option('--market', 'quote a market order (fills at the live price, protection-bounded)')
    .option('--max-price <usd/unit>', 'max price for a market fill (e.g. 0.12/hour)')
    .option('--max-price-per <unit>', 'unit for a bare --max-price usd (second, minute, or hour)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (opts: CommonOpts & {
      size?: string; cpus?: string; memoryMb?: string; diskMb?: string;
      region?: string; timeoutMs?: string; orderType?: string; market?: boolean;
      maxPrice?: string; maxPricePer?: string;
    }) => {
      try {
        const c = await client(opts);
        const params: Record<string, string | undefined> = {
          size: opts.size,
          cpus: opts.cpus,
          memoryMb: opts.memoryMb,
          ephemeralDiskMb: opts.diskMb,
          region: opts.region,
          timeoutMs: opts.timeoutMs,
          orderType: opts.market ? 'market' : opts.orderType,
        };
        if (opts.orderType && opts.market) {
          throw new Error('--market and --order-type are mutually exclusive.');
        }
        const maxPrice = parseMaxPrice(opts.maxPrice, opts.maxPricePer);
        if (maxPrice) {
          params.maxPriceUsd = String(maxPrice.usd);
          params.maxPricePer = maxPrice.per;
        }
        const res = await c.get<{ quote: SandboxQuoteWire }>(
          '/api/v1/sandboxes/quote',
          params,
        );
        output(opts, res.quote, (quote) => printQuote(quote, opts.timeoutMs));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('list')
    .description('List sandboxes')
    .option('--status <status>', 'creating | running | destroyed')
    .option('--limit <n>', 'page size')
    .option('--cursor <cursor>', 'page cursor from a previous response')
    .option('-q, --quiet', 'print only instance IDs, one per line')
    .option('--verbose', 'print the full instance details')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (opts: QuietOpts & { status?: string; limit?: string; cursor?: string }) => {
      try {
        checkQuietJson(opts);
        const c = await client(opts);
        const res = await c.get<{ sandboxes: SandboxSummary[]; nextCursor: string | null }>(
          '/api/v1/sandboxes',
          { status: opts.status, limit: opts.limit, cursor: opts.cursor },
        );
        emitResult(
          opts,
          res,
          (page) => page.sandboxes.map((s) => s.id).join('\n'),
          (page) => {
            page.sandboxes.forEach((s) => printSandbox(s, opts.verbose));
            if (page.nextCursor) console.log(pc.dim(`nextCursor: ${page.nextCursor}`));
          },
        );
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('get [sandboxId]')
    .description('Show one sandbox (includes the BYOK attach descriptor)')
    .option('--verbose', 'print the full instance details')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, opts: QuietOpts) => {
      try {
        checkQuietJson(opts);
        const resolved = requireUuidOrImplicit(argId, opts);
        const c = await client(opts);
        const res = await c.get<{ sandbox: SandboxDetail }>(`/api/v1/sandboxes/${resolved.id}`);
        output(opts, res.sandbox, (s) => printSandbox(s, opts.verbose));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('use [sandboxId]')
    .description('Show or set this directory\'s current instance (COMPUTE_INSTANCE always wins)')
    .option('--clear', 'forget this directory\'s current instance')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, opts: QuietOpts & { clear?: boolean }) => {
      try {
        const org = orgKey(opts);
        if (opts.clear) {
          const prev = clearCurrentInstance(org);
          output(opts, { cleared: prev ?? null }, () =>
            console.log(
              prev
                ? `forgot ${shortId(prev)} (was current for ${dirKey()})`
                : 'nothing to forget',
            ),
          );
          return;
        }
        if (argId === undefined) {
          const r = resolveInstanceId(undefined, opts);
          output(opts, { id: r?.id ?? null, source: r?.source ?? null }, () => {
            if (!r) console.log(NO_INSTANCE_HINT);
            else {
              const where =
                r.source === 'env' ? 'COMPUTE_INSTANCE' : `current for ${r.dir}`;
              console.log(`instance ${shortId(r.id)} (${where})`);
            }
          });
          return;
        }
        if (!isUuid(argId)) {
          throw new Error(`"${argId}" is not a sandbox ID — expected a UUID.`);
        }
        const c = await client(opts);
        const res = await c.get<{ sandbox: SandboxDetail }>(`/api/v1/sandboxes/${argId}`);
        if (res.sandbox.status === 'destroyed') {
          throw new Error(`instance ${shortId(argId)} is destroyed — pick a running instance`);
        }
        setCurrentInstance(argId, org);
        output(opts, { id: argId, dir: dirKey() }, () =>
          console.log(`instance ${shortId(argId)} (current for ${dirKey()})`),
        );
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('destroy [sandboxId]')
    .description('Destroy a sandbox (verified teardown + cost settle)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, opts: QuietOpts) => {
      try {
        const resolved = requireUuidOrImplicit(argId, opts);
        const c = await client(opts);
        const res = await c.del<{ sandbox: SandboxSummary }>(`/api/v1/sandboxes/${resolved.id}`)
          .catch((e) => { resolved.clearStale(e); throw e; });
        // Never leave a dead instance as this directory's current pick.
        const org = orgKey(opts);
        if (readFileCurrent(org) === resolved.id) {
          clearCurrentInstance(org);
          if (!opts.json) {
            console.error(pc.dim(`cleared current instance ${shortId(resolved.id)}`));
          }
        }
        output(opts, res.sandbox, printSandbox);
      } catch (e) {
        fail(e, opts);
      }
    });

  addCreateFlags(
    cmd
      .command('run [command...]')
      .description(
        'Create an instance, run a command on it, and tear it down. ' +
          '`run -- <cmd>` waits and destroys; `--keep` waits and keeps; `-d` returns immediately.',
      ),
  )
    .option('--keep', 'keep the instance after the command exits (it becomes this directory\'s current instance)')
    .option('-d, --detach', 'start the command and return immediately (instance becomes current)')
    .option('--yes', 'non-interactive: Ctrl-C destroys without asking')
    .option('-q, --quiet', 'with --detach, print only the instance ID')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .passThroughOptions()
    .action(async (rawCommand: string[], rawOpts: QuietOpts & CreateFlagOpts & { keep?: boolean; detach?: boolean; yes?: boolean }) => {
      let opts = rawOpts;
      try {
        checkQuietJson(opts);
        if (opts.keep && opts.detach) throw new Error('--keep and --detach are mutually exclusive.');
        const lead = takeLeadingOptions(rawCommand, EXEC_LEAD_OPTS);
        opts = mergeLeadOpts(rawOpts, lead.inline);
        const command = lead.command;
        if (command.length === 0) throw new Error('missing command to run');
        await runInstanceCommand(command, opts);
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('serve [sandboxId] [command...]')
    .description('Start a server, wait for its port to listen publicly, and print the URL')
    .option('--port <n>', 'the TCP port the server listens on (required)')
    .option('--cwd <dir>', 'working directory')
    .option('-e, --env <key=value>', 'environment variable (repeatable)', (v, a: string[]) => a.concat(v), [] as string[])
    .option('--timeout-ms <ms>', 'give up waiting for the port after this (default 120000)')
    .option('-q, --quiet', 'print only the URL')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .passThroughOptions()
    .action(async (argId: string | undefined, rawCommand: string[], rawOpts: QuietOpts & { port: string; cwd?: string; env?: string[]; timeoutMs?: string }) => {
      let opts = rawOpts;
      try {
        checkQuietJson(opts);
        if (argId !== undefined && !isUuid(argId)) {
          rawCommand.unshift(argId);
          argId = undefined;
        }
        const lead = takeLeadingOptions(rawCommand, SERVE_LEAD_OPTS);
        opts = mergeLeadOpts(rawOpts, lead.inline);
        const command = lead.command;
        if (command.length === 0) throw new Error('missing command to serve');
        if (opts.port === undefined) throw new Error('--port is required');
        const port = Number(opts.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error('--port must be an integer between 1 and 65535');
        }
        const resolved = resolveSandbox(argId, opts);
        await serveInstanceCommand(resolved.id, command, port, opts);
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('exec [sandboxId] [command...]')
    .description('Run a one-shot command and print its result (options before the command; -- also works)')
    .option('--timeout-ms <ms>', 'command timeout in ms')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .passThroughOptions()
    .action(async (argId: string | undefined, rawCommand: string[], rawOpts: CommonOpts & { timeoutMs?: string }) => {
      let opts = rawOpts;
      try {
        // A non-UUID first positional is the first word of the command, not
        // an ID — `exec ls -la` works on the implicit instance.
        if (argId !== undefined && !isUuid(argId)) {
          rawCommand.unshift(argId);
          argId = undefined;
        }
        const lead = takeLeadingOptions(rawCommand, EXEC_LEAD_OPTS);
        opts = mergeLeadOpts(rawOpts, lead.inline);
        const command = lead.command;
        if (command.length === 0) throw new Error('missing command to run');
        const resolved = resolveSandbox(argId, opts);
        const c = await client(opts);
        const res = await c.post<{ commandId: string } & CommandResult>(
          `/api/v1/sandboxes/${resolved.id}/commands`,
          {
            command: command.map(shellQuote).join(' '),
            ...(opts.timeoutMs ? { timeoutMs: Number(opts.timeoutMs) } : {}),
          },
        ).catch((e) => { resolved.clearStale(e); throw e; });
        output(opts, res, (r) => {
          process.stdout.write(r.stdout);
          if (r.stderr) process.stderr.write(r.stderr);
          if (!r.stdout) console.log(`exit ${r.exitCode} (${r.durationMs}ms)`);
        });
        // exitCode, not exit(): a piped stdout flushes before the CLI exits.
        if (res.exitCode !== 0) process.exitCode = res.exitCode;
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('spawn [sandboxId] [command...]')
    .description('Start a detached process that outlives this request (options before the command; -- also works)')
    .option('--cwd <dir>', 'working directory')
    .option('-e, --env <key=value>', 'environment variable (repeatable)', (v, a: string[]) => a.concat(v), [] as string[])
    .option('--stdin', 'keep the process\'s stdin pipe open for `stdin`/`close-stdin`')
    .option('-q, --quiet', 'print only the job ID')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .passThroughOptions()
    .action(async (argId: string | undefined, rawCommand: string[], rawOpts: QuietOpts & { cwd?: string; env?: string[]; stdin?: boolean }) => {
      let opts = rawOpts;
      try {
        if (argId !== undefined && !isUuid(argId)) {
          rawCommand.unshift(argId);
          argId = undefined;
        }
        const lead = takeLeadingOptions(rawCommand, SPAWN_LEAD_OPTS);
        opts = mergeLeadOpts(rawOpts, lead.inline);
        checkQuietJson(opts);
        const command = lead.command;
        if (command.length === 0) throw new Error('missing command to spawn');
        const resolved = resolveSandbox(argId, opts);
        const c = await client(opts);
        const res = await c.post<{ process: SandboxProcess }>(
          `/api/v1/sandboxes/${resolved.id}/processes`,
          {
            command: command.map(shellQuote).join(' '),
            ...(opts.cwd ? { cwd: opts.cwd } : {}),
            ...(opts.env && opts.env.length > 0 ? { env: parseInputs(opts.env) } : {}),
            ...(opts.stdin ? { stdin: true } : {}),
          },
        ).catch((e) => { resolved.clearStale(e); throw e; });
        emitResult(opts, res.process, (p) => p.jobId, printProcess);
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('ps [sandboxId]')
    .description('List the sandbox\'s tracked processes')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, opts: QuietOpts) => {
      try {
        const resolved = requireUuidOrImplicit(argId, opts);
        const c = await client(opts);
        const res = await c.get<{ processes: SandboxProcess[] }>(
          `/api/v1/sandboxes/${resolved.id}/processes`,
        );
        output(opts, res.processes, (list) => list.forEach(printProcess));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('logs [jobOrSandboxId] [jobId]')
    .description('Show a process\'s buffered output (--follow streams until exit)')
    .option('-f, --follow', 'stream output until the process exits')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, jobId: string | undefined, opts: QuietOpts & { follow?: boolean }) => {
      try {
        // `logs <jobId>` — a non-UUID first positional is the job, not the instance.
        const { resolved, resource: job } = resolveTwoArgTarget(argId, jobId, opts, 'jobId');
        const c = await client(opts);
        if (opts.follow) {
          await followProcess(c, resolved.id, job);
          return;
        }
        const res = await c.get<{ process: SandboxProcessStatus }>(
          `/api/v1/sandboxes/${resolved.id}/processes/${job}`,
        );
        output(opts, res.process, (p) => {
          if (p.stdout) process.stdout.write(p.stdout);
          if (p.stderr) process.stderr.write(p.stderr);
          if (!p.stdout && !p.stderr) printProcess(p);
        });
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('wait [jobOrSandboxId] [jobId]')
    .description('Block until a process exits')
    .option('--timeout-ms <ms>', 'bound the wait (job keeps running on timeout)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, jobId: string | undefined, opts: QuietOpts & { timeoutMs?: string }) => {
      try {
        const { resolved, resource: job } = resolveTwoArgTarget(argId, jobId, opts, 'jobId');
        const c = await client(opts);
        const res = await c.post<{ process: SandboxProcessStatus }>(
          `/api/v1/sandboxes/${resolved.id}/processes/${job}/wait`,
          opts.timeoutMs ? { timeoutMs: Number(opts.timeoutMs) } : {},
        );
        output(opts, res.process, printProcess);
        if (res.process.status === 'exited') {
          // A null exit code (signal-terminated) is still a failure, not 0.
          process.exitCode = res.process.exitCode ?? 128;
        }
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('kill [jobOrSandboxId] [jobId]')
    .description('Signal a process (default SIGTERM)')
    .option('--signal <signal>', 'signal name or number, e.g. SIGKILL or 9')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, jobId: string | undefined, opts: QuietOpts & { signal?: string }) => {
      try {
        const { resolved, resource: job } = resolveTwoArgTarget(argId, jobId, opts, 'jobId');
        const c = await client(opts);
        const res = await c.post<{ process: SandboxProcessStatus }>(
          `/api/v1/sandboxes/${resolved.id}/processes/${job}/kill`,
          opts.signal ? { signal: opts.signal } : {},
        );
        output(opts, res.process, printProcess);
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('stdin [jobOrSandboxId] [jobId]')
    .description('Write to a process\'s stdin pipe (spawn with --stdin; --data, --file, or piped)')
    .option('--data <text>', 'data to write')
    .option('--file <local>', 'read data from a local file')
    .option('--base64', 'base64-encode the input before sending (binary-safe)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, jobId: string | undefined, opts: QuietOpts & { data?: string; file?: string; base64?: boolean }) => {
      try {
        const { resolved, resource: job } = resolveTwoArgTarget(argId, jobId, opts, 'jobId');
        let data = opts.data;
        if (data === undefined && opts.file) {
          const { readFile } = await import('node:fs/promises');
          data = opts.base64
            ? (await readFile(opts.file)).toString('base64')
            : await readFile(opts.file, 'utf8');
        }
        if (data === undefined && !process.stdin.isTTY) {
          // Buffer raw bytes — decoding as utf8 first would corrupt binary
          // input before --base64 could encode it.
          const piped = await new Promise<Buffer>((resolve) => {
            const chunks: Buffer[] = [];
            process.stdin.on('data', (chunk) => chunks.push(chunk));
            process.stdin.on('end', () => resolve(Buffer.concat(chunks)));
          });
          data = opts.base64 ? piped.toString('base64') : piped.toString('utf8');
        }
        if (data === undefined || data === '') {
          console.error(pc.red('Pass --data, --file, or pipe stdin'));
          process.exit(1);
        }
        if (opts.base64 && opts.data !== undefined) {
          data = Buffer.from(data).toString('base64');
        }
        const c = await client(opts);
        const res = await c.post<{ ok: boolean }>(
          `/api/v1/sandboxes/${resolved.id}/processes/${job}/stdin`,
          { data, ...(opts.base64 ? { encoding: 'base64' } : {}) },
        );
        output(opts, res, () => console.log(`wrote ${data.length} chars to ${job}`));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('close-stdin [jobOrSandboxId] [jobId]')
    .description('Close a process\'s stdin pipe')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, jobId: string | undefined, opts: QuietOpts) => {
      try {
        const { resolved, resource: job } = resolveTwoArgTarget(argId, jobId, opts, 'jobId');
        const c = await client(opts);
        const res = await c.post<{ ok: boolean }>(
          `/api/v1/sandboxes/${resolved.id}/processes/${job}/close-stdin`,
          {},
        );
        output(opts, res, () => console.log(`closed stdin on ${job}`));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('ls [pathOrSandboxId] [path]')
    .description('List a directory (or stat a path) inside the sandbox')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, path: string | undefined, opts: QuietOpts) => {
      try {
        // `ls /app` — a non-UUID first positional is the path.
        let resolved: ResolvedSandbox;
        let p: string;
        if (argId !== undefined && !isUuid(argId)) {
          if (path !== undefined) throw new Error(`"${argId}" is not a sandbox ID — expected a UUID.`);
          resolved = resolveSandbox(undefined, opts);
          p = argId;
        } else {
          resolved = resolveSandbox(argId, opts);
          p = path ?? '/';
        }
        const c = await client(opts);
        const res = await c.get<PathView>(`/api/v1/sandboxes/${resolved.id}/files`, {
          path: p,
        });
        output(opts, res, (view) => {
          if (view.type === 'directory') {
            for (const e of view.entries) {
              console.log(`${e.type === 'directory' ? pc.blue('d') : ' '} ${e.name}${e.size !== undefined ? `  ${pc.dim(String(e.size))}` : ''}`);
            }
          } else {
            console.log(`${view.path}  file  ${view.content.length} chars`);
          }
        });
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('cat [pathOrSandboxId] [path]')
    .description('Print a file\'s contents')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, path: string | undefined, opts: QuietOpts) => {
      try {
        let resolved: ResolvedSandbox;
        let p: string;
        if (argId !== undefined && !isUuid(argId)) {
          if (path !== undefined) throw new Error(`"${argId}" is not a sandbox ID — expected a UUID.`);
          resolved = resolveSandbox(undefined, opts);
          p = argId;
        } else {
          resolved = resolveSandbox(argId, opts);
          if (path === undefined) throw new Error('missing path');
          p = path;
        }
        const c = await client(opts);
        const res = await c.get<PathView>(`/api/v1/sandboxes/${resolved.id}/files`, { path: p });
        output(opts, res, (view) => {
          if (view.type !== 'file') {
            console.error(pc.red(`${view.path} is a directory`));
            process.exit(1);
          }
          process.stdout.write(view.content);
          if (!view.content.endsWith('\n')) process.stdout.write('\n');
        });
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('write [pathOrSandboxId] [path]')
    .description('Write a file inside the sandbox (--content or --file <local>, else stdin)')
    .option('--content <text>', 'file contents')
    .option('--file <local>', 'read contents from a local file')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, path: string | undefined, opts: QuietOpts & { content?: string; file?: string }) => {
      try {
        let resolved: ResolvedSandbox;
        let p: string;
        if (argId !== undefined && !isUuid(argId)) {
          if (path !== undefined) throw new Error(`"${argId}" is not a sandbox ID — expected a UUID.`);
          resolved = resolveSandbox(undefined, opts);
          p = argId;
        } else {
          resolved = resolveSandbox(argId, opts);
          if (path === undefined) throw new Error('missing path');
          p = path;
        }
        let content = opts.content;
        if (content === undefined && opts.file) {
          const { readFile } = await import('node:fs/promises');
          content = await readFile(opts.file, 'utf8');
        }
        if (content === undefined && !process.stdin.isTTY) {
          content = await new Promise<string>((resolve) => {
            let data = '';
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', (chunk) => (data += chunk));
            process.stdin.on('end', () => resolve(data));
          });
        }
        if (content === undefined) {
          console.error(pc.red('Pass --content, --file, or pipe stdin'));
          process.exit(1);
        }
        const c = await client(opts);
        const res = await c.post<{ path: string; type: string }>(
          `/api/v1/sandboxes/${resolved.id}/files`,
          { path: p, content },
        );
        output(opts, res, (r) => console.log(`wrote ${r.path}`));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('mkdir [pathOrSandboxId] [path]')
    .description('Create a directory (parents included)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, path: string | undefined, opts: QuietOpts) => {
      try {
        let resolved: ResolvedSandbox;
        let p: string;
        if (argId !== undefined && !isUuid(argId)) {
          if (path !== undefined) throw new Error(`"${argId}" is not a sandbox ID — expected a UUID.`);
          resolved = resolveSandbox(undefined, opts);
          p = argId;
        } else {
          resolved = resolveSandbox(argId, opts);
          if (path === undefined) throw new Error('missing path');
          p = path;
        }
        const c = await client(opts);
        const res = await c.post<{ path: string }>(`/api/v1/sandboxes/${resolved.id}/files`, {
          path: p,
          mkdir: true,
        });
        output(opts, res, (r) => console.log(`created ${r.path}`));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('rm [pathOrSandboxId] [path]')
    .description('Remove a file or directory inside the sandbox')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, path: string | undefined, opts: QuietOpts) => {
      try {
        let resolved: ResolvedSandbox;
        let p: string;
        if (argId !== undefined && !isUuid(argId)) {
          if (path !== undefined) throw new Error(`"${argId}" is not a sandbox ID — expected a UUID.`);
          resolved = resolveSandbox(undefined, opts);
          p = argId;
        } else {
          resolved = resolveSandbox(argId, opts);
          if (path === undefined) throw new Error('missing path');
          p = path;
        }
        const c = await client(opts);
        const res = await c.del<{ path: string; removed: boolean }>(
          `/api/v1/sandboxes/${resolved.id}/files?path=${encodeURIComponent(p)}`,
        );
        output(opts, res, (r) => console.log(`removed ${r.path}`));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('url [sandboxId]')
    .description('Resolve the provider\'s public URL for a port')
    .requiredOption('--port <n>', 'port the service listens on')
    .option('--protocol <protocol>', 'protocol (default provider-chosen)')
    .option('-q, --quiet', 'print only the URL (the default)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, opts: QuietOpts & { port: string; protocol?: string }) => {
      try {
        checkQuietJson(opts);
        const resolved = requireUuidOrImplicit(argId, opts);
        const c = await client(opts);
        const res = await c.get<{ url: string }>(`/api/v1/sandboxes/${resolved.id}/urls`, {
          port: opts.port,
          protocol: opts.protocol,
        });
        emitResult(opts, res, (r) => safeTerm(r.url), (r) => console.log(safeTerm(r.url)));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('snapshots [sandboxId]')
    .description('List the sandbox\'s snapshots')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, opts: QuietOpts) => {
      try {
        const resolved = requireUuidOrImplicit(argId, opts);
        const c = await client(opts);
        const res = await c.get<{ snapshots: SandboxSnapshot[] }>(
          `/api/v1/sandboxes/${resolved.id}/snapshots`,
        );
        output(opts, res.snapshots, (list) => list.forEach(printSnapshot));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('snapshot [sandboxId]')
    .description('Snapshot a running sandbox through its provider')
    .option('--label <label>', 'label for the snapshot')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, opts: QuietOpts & { label?: string }) => {
      try {
        const resolved = requireUuidOrImplicit(argId, opts);
        const c = await client(opts);
        const res = await c.post<{ snapshot: SandboxSnapshot }>(
          `/api/v1/sandboxes/${resolved.id}/snapshots`,
          opts.label ? { label: opts.label } : {},
        );
        output(opts, res.snapshot, printSnapshot);
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('snapshot-delete [snapOrSandboxId] [snapshotId]')
    .description('Delete a snapshot\'s provider artifact')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (argId: string | undefined, snapshotId: string | undefined, opts: QuietOpts) => {
      try {
        const { resolved, resource: snap } = resolveTwoArgTarget(argId, snapshotId, opts, 'snapshotId');
        const c = await client(opts);
        const res = await c.del<{ ok: boolean }>(
          `/api/v1/sandboxes/${resolved.id}/snapshots/${snap}`,
        );
        output(opts, res, () => console.log(`deleted snapshot ${snapshotId}`));
      } catch (e) {
        fail(e, opts);
      }
    });

  // One-off org override on every subcommand — sent as X-Org-Slug.
  for (const sub of cmd.commands) {
    sub.option('--org <slug>', 'organization slug for this command (or $COMPUTE_ORG)');
  }

  // Registered after the --org pass so `settings`/`settings set` declare
  // their own full option set (the loop above only covers direct children).
  registerSettingsCommands(cmd, 'sandboxes', (sub) =>
    sub
      .option('--api-key <key>', 'platform API key (or COMPUTE_API_KEY)')
      .option('--base-url <url>', 'platform base URL')
      .option('--org <slug>', 'organization slug for this command (or $COMPUTE_ORG)')
      .option('--allow-untrusted-host', 'allow non-computesdk.com base URLs')
      .option('--json', 'print the raw response'),
    { client, fail, output, usageErrorOutput },
  );
}

/** Streams a process's daemon-buffered output to the console until `exit`. */
async function followProcess(
  c: ActionsClient,
  sandboxId: string,
  jobId: string,
): Promise<void> {
  let exitCode = 0;
  for await (const { event, data } of c.sseNamed(
    `/api/v1/sandboxes/${sandboxId}/processes/${jobId}`,
  )) {
    const payload = data as Record<string, unknown>;
    if (event === 'stdout') process.stdout.write(String(payload.chunk ?? ''));
    else if (event === 'stderr') process.stderr.write(String(payload.chunk ?? ''));
    else if (event === 'exit') {
      // A null exit code means a signal killed the process — still a failure.
      exitCode = typeof payload.exitCode === 'number' ? payload.exitCode : 128;
      return finish();
    } else if (event === 'error') {
      console.error(pc.red(`Error: ${String(payload.error ?? 'stream error')}`));
      return finish(1);
    }
  }
  // The stream ended without an `exit` event — the process may still be
  // running; reporting success would be wrong either way.
  console.error(pc.yellow('stream ended before the process exited'));
  return finish(2);

  function finish(code?: number): void {
    if (code !== undefined) exitCode = code;
    if (exitCode !== 0) process.exitCode = exitCode;
  }
}

// ─── run ─────────────────────────────────────────────────────────────────────

/** The `-d`/`Ctrl-C d` summary — everything needed to re-attach later. */
function printDetachSummary(sandboxId: string, jobId: string, timeoutText: string): void {
  console.log(`instance ${shortId(sandboxId)}  job ${jobId}  (running; ${timeoutText})`);
  console.log(`  follow:   compute instances logs ${jobId}`);
  console.log(`  wait:     compute instances wait ${jobId}`);
  console.log(`  destroy:  compute instances destroy ${shortId(sandboxId)}`);
}

/** The timeout text for the detach summary: requested, else the platform default. */
function runTimeoutText(opts: { timeoutMs?: string }): string {
  return opts.timeoutMs
    ? `instance timeout: ${fmtTimeout(Number(opts.timeoutMs))}`
    : `instance timeout: ${fmtTimeout(PLATFORM_DEFAULT_TIMEOUT_MS)} (platform default)`;
}

/**
 * `compute instances run` — create, spawn, stream via repeated `wait` calls
 * (each returns the cumulative buffers; we print only the delta), then destroy
 * in a `finally`. `--keep` skips the destroy, `-d` skips the wait too; both
 * leave the instance as this directory's current one.
 */
async function runInstanceCommand(
  command: string[],
  opts: QuietOpts & CreateFlagOpts & { keep?: boolean; detach?: boolean; yes?: boolean },
): Promise<void> {
  const c = await client(opts);
  const created = await c.post<{ sandbox: SandboxDetail }>('/api/v1/sandboxes', buildCreateBody(opts));
  const sandbox = created.sandbox;
  const org = orgKey(opts);
  // Before anything else: the ID on stderr, so a `kill -9` leaves a handle.
  console.error(pc.dim(`instance ${sandbox.id}`));

  const spawned = await c.post<{ process: SandboxProcess }>(
    `/api/v1/sandboxes/${sandbox.id}/processes`,
    { command: command.map(shellQuote).join(' ') },
  ).catch(async (e) => {
    try { await c.del(`/api/v1/sandboxes/${sandbox.id}`); } catch { /* best effort */ }
    throw e;
  });
  const jobId = spawned.process.jobId;

  if (opts.detach) {
    setCurrentInstance(sandbox.id, org);
    if (opts.quiet) console.log(sandbox.id);
    else printDetachSummary(sandbox.id, jobId, runTimeoutText(opts));
    return;
  }

  let exitCode: number | null = null;
  let destroyRequested = false;
  let detachRequested = false;
  let prompting = false;
  let printedOut = 0;
  let printedErr = 0;

  const flush = (p: SandboxProcessStatus) => {
    if (prompting) return; // Ctrl-C prompt owns the terminal right now
    if (p.stdout.length > printedOut) {
      process.stdout.write(p.stdout.slice(printedOut));
      printedOut = p.stdout.length;
    }
    if (p.stderr.length > printedErr) {
      process.stderr.write(p.stderr.slice(printedErr));
      printedErr = p.stderr.length;
    }
  };

  const onSignal = () => {
    if (!process.stdin.isTTY || opts.yes || prompting) {
      // Non-TTY, --yes, or a 2nd Ctrl-C mid-prompt: destroy outright
      // (a mid-prompt Ctrl-C counts as N — keep waiting — unless readline
      // already closed, in which case fall through to destroy below).
      if (prompting) return;
      destroyRequested = true;
      return;
    }
    prompting = true;
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`Destroy instance ${shortId(sandbox.id)}? [y/N/d] `, (answer) => {
      rl.close();
      prompting = false;
      const a = answer.trim().toLowerCase();
      if (a === 'y') destroyRequested = true;
      else if (a === 'd') detachRequested = true;
      // N/Enter: keep waiting.
    });
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    const deadline = opts.timeoutMs ? Date.now() + Number(opts.timeoutMs) : undefined;
    // Repeated waits, streaming the cumulative buffers' new tail each round.
    // ~55s per call stays under the route's wall-clock cap.
    while (exitCode === null && !destroyRequested && !detachRequested) {
      const remaining = deadline === undefined ? 55_000 : Math.max(1, deadline - Date.now());
      const res = await c.post<{ process: SandboxProcessStatus }>(
        `/api/v1/sandboxes/${sandbox.id}/processes/${jobId}/wait`,
        { timeoutMs: Math.min(55_000, remaining) },
      );
      flush(res.process);
      if (res.process.status === 'exited') {
        exitCode = res.process.exitCode ?? 128;
      } else if (deadline !== undefined && Date.now() >= deadline) {
        destroyRequested = true;
      }
    }
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (detachRequested) {
      setCurrentInstance(sandbox.id, org);
      printDetachSummary(sandbox.id, jobId, runTimeoutText(opts));
    } else if (opts.keep && exitCode !== null) {
      // --keep only keeps a run that reached an exit; a wait error or a
      // destroy request falls through to deletion so a failed run can't
      // leave a running instance behind.
      setCurrentInstance(sandbox.id, org);
      if (opts.quiet) console.log(sandbox.id);
      else {
        console.error(pc.dim(`kept instance ${shortId(sandbox.id)} (current for ${dirKey()})`));
        console.log(sandbox.id);
      }
    } else {
      try {
        await c.del(`/api/v1/sandboxes/${sandbox.id}`);
      } catch (e) {
        console.error(
          pc.red(`destroy failed for ${sandbox.id}: ${e instanceof Error ? e.message : String(e)}`),
        );
        if (exitCode === null || exitCode === 0) exitCode = 1;
      }
      const orgNow = orgKey(opts);
      if (readFileCurrent(orgNow) === sandbox.id) clearCurrentInstance(orgNow);
    }
  }

  process.exitCode = detachRequested ? 0 : (exitCode ?? (destroyRequested ? 130 : 1));
}

// ─── serve ───────────────────────────────────────────────────────────────────

interface PortsResponse {
  ports: { port: number; address: string; public: boolean }[];
  waited?: boolean;
  found?: boolean;
}

/** Wait-cap per `/ports?wait=` call — the route caps at 60s. */
const SERVE_POLL_MS = 30_000;
const SERVE_DEFAULT_WAIT_MS = 120_000;

/**
 * `compute instances serve` — start a server process and wait until its port
 * listens on a public address, then print the provider URL.
 *
 * Failure modes per spec: a loopback-only bind fails with the bind hint; the
 * process exiting early prints its exit code and last log lines.
 */
async function serveInstanceCommand(
  id: string,
  command: string[],
  port: number,
  opts: QuietOpts & { cwd?: string; env?: string[]; timeoutMs?: string },
): Promise<void> {
  const c = await client(opts);
  const spawned = await c.post<{ process: SandboxProcess }>(
    `/api/v1/sandboxes/${id}/processes`,
    {
      command: command.map(shellQuote).join(' '),
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.env?.length ? { env: parseInputs(opts.env) } : {}),
    },
  );
  const jobId = spawned.process.jobId;

  const jobStatus = () =>
    c.get<{ process: SandboxProcessStatus }>(`/api/v1/sandboxes/${id}/processes/${jobId}`);
  const reportExit = (proc: SandboxProcessStatus): void => {
    if (!opts.json) {
      const logs = `${proc.stdout}${proc.stderr}`.trimEnd().split('\n');
      if (logs.length > 0 && logs[0] !== '') {
        console.error(pc.dim('--- last log lines ---'));
        for (const line of logs.slice(-50)) console.error(safeTerm(line));
      }
    }
    fail(new Error(`The server exited (code ${proc.exitCode ?? '?'}) before port ${port} listened.`), opts);
  };

  const waitMs = opts.timeoutMs ? Number(opts.timeoutMs) : SERVE_DEFAULT_WAIT_MS;
  const deadline = Date.now() + waitMs;
  let entry: PortsResponse['ports'][number] | undefined;
  let remaining = waitMs;
  while (!entry && remaining > 0) {
    const res = await c.get<PortsResponse>(
      `/api/v1/sandboxes/${id}/ports?wait=${port}&timeoutMs=${Math.min(SERVE_POLL_MS, remaining)}`,
    );
    entry = res.ports.find((p) => p.port === port);
    if (entry) break;
    // Not listening — did the server die?
    const proc = await jobStatus();
    if (proc.process.status === 'exited') {
      reportExit(proc.process);
      return; // fail() stubs process.exit in tests — don't keep polling.
    }
    remaining = deadline - Date.now();
  }

  if (entry) {
    // A listener doesn't prove our server bound the port — when another
    // process already owns it our job dies silently. Check before printing.
    const proc = await jobStatus();
    if (proc.process.status === 'exited') {
      reportExit(proc.process);
      return;
    }
  } else {
    if (!opts.json) printServeJobFooter(id, jobId);
    fail(new Error(`Port ${port} never listened within ${fmtTimeout(waitMs)}.`), opts);
    return;
  }

  if (!entry.public) {
    if (!opts.json) printServeJobFooter(id, jobId);
    fail(new Error(
      `Port ${port} is listening on ${safeTerm(entry.address)} only. ` +
      `Bind to 0.0.0.0 (e.g. --host 0.0.0.0) so it can be reached.`),
      opts,
    );
    return;
  }

  const { url } = await c.get<{ url: string }>(`/api/v1/sandboxes/${id}/urls?port=${port}`);
  if (opts.quiet) {
    console.log(safeTerm(url));
    return;
  }
  // --json emits the raw field; only terminal output is sanitized.
  output(opts, { url }, () => {
    console.log(safeTerm(url));
    printServeJobFooter(id, jobId);
  });
}

function printServeJobFooter(sandboxId: string, jobId: string): void {
  // Always name the instance: the implicit instance may be a different box.
  console.error(pc.dim(`  job ${jobId}`));
  console.error(pc.dim(`  logs:   compute instances logs ${sandboxId} ${jobId}`));
  console.error(pc.dim(`  kill:   compute instances kill ${sandboxId} ${jobId}`));
}


