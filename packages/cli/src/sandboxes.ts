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

import { Command } from 'commander';
import pc from 'picocolors';
import type { ActionsClient } from './actions-client.js';
import {
  client,
  fail,
  output,
  parseInputs,
  safeTerm,
  usageErrorOutput,
  type CommonOpts,
} from './actions.js';
import { formatMoney, formatRateAllUnits, formatUsdPer, rateAllUnits } from './rate-display.js';

/**
 * `--max-price <usd>/<unit>` → the body's `maxPrice` / the quote's
 * maxPriceUsd+maxPricePer params. The unit is required — either inside the
 * value (`0.12/hour`) or via `--max-price-per` — so a bare `--max-price
 * 0.12` never silently defaults to per-second pricing.
 */
function parseMaxPrice(
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
      '--max-price needs a unit — write it as <usd>/<unit> (e.g. --max-price 0.12/hour) or pass --max-price-per hour.',
    );
  }
  return { usd, per: unit };
}

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

function printSandbox(s: SandboxSummary): void {
  const attach = 'attach' in s ? (s as SandboxDetail).attach : undefined;
  console.log(`${pc.cyan(s.id)}  ${s.status}  ${s.provider ?? '—'}  ${s.providerSandboxId ?? '—'}`);
  console.log(`  label: ${s.label ?? '—'}   commands: ${s.commandCount}   created: ${s.createdAt}`);
  if (s.image !== undefined) {
    console.log(`  image: ${s.image ?? '—'}${s.requestedImage !== null && s.requestedImage !== s.image ? `  ${pc.dim(`(requested: ${s.requestedImage})`)}` : ''}`);
  }
  if (s.destroyError) console.log(`  destroyError: ${pc.red(s.destroyError)}`);
  if (s.placement) {
    const p = s.placement;
    const box = p.box
      ? ` / ${p.box.sizeName ?? 'custom'}${p.box.resources ? ` (${p.box.resources.cpus ?? '?'} vCPU / ${p.box.resources.memoryMb ?? '?'} MB)` : ''}`
      : '';
    console.log(
      `  provider: ${p.box?.provider ?? s.provider ?? '—'}${box}` +
        `   size: ${p.size ?? '—'}   order: ${p.orderType ?? '—'}   rate: ${formatUsdPer(p.rate)}` +
        `${p.maxPrice ? `   max price: ${formatUsdPer(p.maxPrice)}` : ''}`,
    );
  }
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
  { aliases: ['--cwd'], key: 'cwd', flag: 'value' },
  { aliases: ['-e', '--env'], key: 'env', flag: 'repeat' },
  { aliases: ['--stdin'], key: 'stdin', flag: 'bool' },
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

export function registerSandboxesCommands(program: Command): void {
  const cmd = program
    .command('instances')
    .alias('sandboxes')
    .alias('sbx')
    .description('Create and drive compute instances through the platform')
    .enablePositionalOptions()
    .configureOutput({ outputError: usageErrorOutput });

  cmd
    .command('create')
    .description('Place a sandbox (provider order walks 1,2,3; "market" bids first)')
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
    .option('--secret <name>', 'vault secret name to inject (repeatable)', (v, a: string[]) => a.concat(v), [] as string[])
    .option('--api-key <key>', 'platform API key (or COMPUTE_API_KEY)')
    .option('--base-url <url>', 'platform base URL')
    .option('--allow-untrusted-host', 'allow non-computesdk.com base URLs')
    .option('--json', 'print the raw response')
    .action(async (opts: CommonOpts & {
      order?: string; label?: string; image?: string; snapshotId?: string;
      size?: string; cpus?: string; memoryMb?: string; diskMb?: string; timeoutMs?: string;
      maxPrice?: string; maxPricePer?: string; market?: boolean; orderType?: string;
      secret?: string[];
    }) => {
      try {
        const c = await client(opts);
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
        const res = await c.post<{ sandbox: SandboxDetail }>('/api/v1/sandboxes', body);
        output(opts, res.sandbox, printSandbox);
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
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (opts: CommonOpts & { status?: string; limit?: string; cursor?: string }) => {
      try {
        const c = await client(opts);
        const res = await c.get<{ sandboxes: SandboxSummary[]; nextCursor: string | null }>(
          '/api/v1/sandboxes',
          { status: opts.status, limit: opts.limit, cursor: opts.cursor },
        );
        output(opts, res, (page) => {
          page.sandboxes.forEach(printSandbox);
          if (page.nextCursor) console.log(pc.dim(`nextCursor: ${page.nextCursor}`));
        });
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('get <sandboxId>')
    .description('Show one sandbox (includes the BYOK attach descriptor)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.get<{ sandbox: SandboxDetail }>(`/api/v1/sandboxes/${sandboxId}`);
        output(opts, res.sandbox, printSandbox);
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('destroy <sandboxId>')
    .description('Destroy a sandbox (verified teardown + cost settle)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.del<{ sandbox: SandboxSummary }>(`/api/v1/sandboxes/${sandboxId}`);
        output(opts, res.sandbox, printSandbox);
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('exec <sandboxId> <command...>')
    .description('Run a one-shot command and print its result (options before the command; -- also works)')
    .option('--timeout-ms <ms>', 'command timeout in ms')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .passThroughOptions()
    .action(async (sandboxId: string, rawCommand: string[], rawOpts: CommonOpts & { timeoutMs?: string }) => {
      let opts = rawOpts;
      try {
        const lead = takeLeadingOptions(rawCommand, EXEC_LEAD_OPTS);
        opts = mergeLeadOpts(rawOpts, lead.inline);
        const command = lead.command;
        if (command.length === 0) throw new Error('missing command to run');
        const c = await client(opts);
        const res = await c.post<{ commandId: string } & CommandResult>(
          `/api/v1/sandboxes/${sandboxId}/commands`,
          {
            command: command.map(shellQuote).join(' '),
            ...(opts.timeoutMs ? { timeoutMs: Number(opts.timeoutMs) } : {}),
          },
        );
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
    .command('spawn <sandboxId> <command...>')
    .description('Start a detached process that outlives this request (options before the command; -- also works)')
    .option('--cwd <dir>', 'working directory')
    .option('-e, --env <key=value>', 'environment variable (repeatable)', (v, a: string[]) => a.concat(v), [] as string[])
    .option('--stdin', 'keep the process\'s stdin pipe open for `stdin`/`close-stdin`')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .passThroughOptions()
    .action(async (sandboxId: string, rawCommand: string[], rawOpts: CommonOpts & { cwd?: string; env?: string[]; stdin?: boolean }) => {
      let opts = rawOpts;
      try {
        const lead = takeLeadingOptions(rawCommand, SPAWN_LEAD_OPTS);
        opts = mergeLeadOpts(rawOpts, lead.inline);
        const command = lead.command;
        if (command.length === 0) throw new Error('missing command to spawn');
        const c = await client(opts);
        const res = await c.post<{ process: SandboxProcess }>(
          `/api/v1/sandboxes/${sandboxId}/processes`,
          {
            command: command.map(shellQuote).join(' '),
            ...(opts.cwd ? { cwd: opts.cwd } : {}),
            ...(opts.env && opts.env.length > 0 ? { env: parseInputs(opts.env) } : {}),
            ...(opts.stdin ? { stdin: true } : {}),
          },
        );
        output(opts, res.process, printProcess);
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('ps <sandboxId>')
    .description('List the sandbox\'s tracked processes')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.get<{ processes: SandboxProcess[] }>(
          `/api/v1/sandboxes/${sandboxId}/processes`,
        );
        output(opts, res.processes, (list) => list.forEach(printProcess));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('logs <sandboxId> <jobId>')
    .description('Show a process\'s buffered output (--follow streams until exit)')
    .option('-f, --follow', 'stream output until the process exits')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, jobId: string, opts: CommonOpts & { follow?: boolean }) => {
      try {
        const c = await client(opts);
        if (opts.follow) {
          await followProcess(c, sandboxId, jobId);
          return;
        }
        const res = await c.get<{ process: SandboxProcessStatus }>(
          `/api/v1/sandboxes/${sandboxId}/processes/${jobId}`,
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
    .command('wait <sandboxId> <jobId>')
    .description('Block until a process exits')
    .option('--timeout-ms <ms>', 'bound the wait (job keeps running on timeout)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, jobId: string, opts: CommonOpts & { timeoutMs?: string }) => {
      try {
        const c = await client(opts);
        const res = await c.post<{ process: SandboxProcessStatus }>(
          `/api/v1/sandboxes/${sandboxId}/processes/${jobId}/wait`,
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
    .command('kill <sandboxId> <jobId>')
    .description('Signal a process (default SIGTERM)')
    .option('--signal <signal>', 'signal name or number, e.g. SIGKILL or 9')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, jobId: string, opts: CommonOpts & { signal?: string }) => {
      try {
        const c = await client(opts);
        const res = await c.post<{ process: SandboxProcessStatus }>(
          `/api/v1/sandboxes/${sandboxId}/processes/${jobId}/kill`,
          opts.signal ? { signal: opts.signal } : {},
        );
        output(opts, res.process, printProcess);
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('stdin <sandboxId> <jobId>')
    .description('Write to a process\'s stdin pipe (spawn with --stdin; --data, --file, or piped)')
    .option('--data <text>', 'data to write')
    .option('--file <local>', 'read data from a local file')
    .option('--base64', 'base64-encode the input before sending (binary-safe)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, jobId: string, opts: CommonOpts & { data?: string; file?: string; base64?: boolean }) => {
      try {
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
          `/api/v1/sandboxes/${sandboxId}/processes/${jobId}/stdin`,
          { data, ...(opts.base64 ? { encoding: 'base64' } : {}) },
        );
        output(opts, res, () => console.log(`wrote ${data.length} chars to ${jobId}`));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('close-stdin <sandboxId> <jobId>')
    .description('Close a process\'s stdin pipe')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, jobId: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.post<{ ok: boolean }>(
          `/api/v1/sandboxes/${sandboxId}/processes/${jobId}/close-stdin`,
          {},
        );
        output(opts, res, () => console.log(`closed stdin on ${jobId}`));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('ls <sandboxId> [path]')
    .description('List a directory (or stat a path) inside the sandbox')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, path: string | undefined, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.get<PathView>(`/api/v1/sandboxes/${sandboxId}/files`, {
          path: path ?? '/',
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
    .command('cat <sandboxId> <path>')
    .description('Print a file\'s contents')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, path: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.get<PathView>(`/api/v1/sandboxes/${sandboxId}/files`, { path });
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
    .command('write <sandboxId> <path>')
    .description('Write a file inside the sandbox (--content or --file <local>, else stdin)')
    .option('--content <text>', 'file contents')
    .option('--file <local>', 'read contents from a local file')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, path: string, opts: CommonOpts & { content?: string; file?: string }) => {
      try {
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
          `/api/v1/sandboxes/${sandboxId}/files`,
          { path, content },
        );
        output(opts, res, (r) => console.log(`wrote ${r.path}`));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('mkdir <sandboxId> <path>')
    .description('Create a directory (parents included)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, path: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.post<{ path: string }>(`/api/v1/sandboxes/${sandboxId}/files`, {
          path,
          mkdir: true,
        });
        output(opts, res, (r) => console.log(`created ${r.path}`));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('rm <sandboxId> <path>')
    .description('Remove a file or directory inside the sandbox')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, path: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.del<{ path: string; removed: boolean }>(
          `/api/v1/sandboxes/${sandboxId}/files?path=${encodeURIComponent(path)}`,
        );
        output(opts, res, (r) => console.log(`removed ${r.path}`));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('url <sandboxId>')
    .description('Resolve the provider\'s public URL for a port')
    .requiredOption('--port <n>', 'port the service listens on')
    .option('--protocol <protocol>', 'protocol (default provider-chosen)')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, opts: CommonOpts & { port: string; protocol?: string }) => {
      try {
        const c = await client(opts);
        const res = await c.get<{ url: string }>(`/api/v1/sandboxes/${sandboxId}/urls`, {
          port: opts.port,
          protocol: opts.protocol,
        });
        output(opts, res, (r) => console.log(safeTerm(r.url)));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('snapshots <sandboxId>')
    .description('List the sandbox\'s snapshots')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.get<{ snapshots: SandboxSnapshot[] }>(
          `/api/v1/sandboxes/${sandboxId}/snapshots`,
        );
        output(opts, res.snapshots, (list) => list.forEach(printSnapshot));
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('snapshot <sandboxId>')
    .description('Snapshot a running sandbox through its provider')
    .option('--label <label>', 'label for the snapshot')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, opts: CommonOpts & { label?: string }) => {
      try {
        const c = await client(opts);
        const res = await c.post<{ snapshot: SandboxSnapshot }>(
          `/api/v1/sandboxes/${sandboxId}/snapshots`,
          opts.label ? { label: opts.label } : {},
        );
        output(opts, res.snapshot, printSnapshot);
      } catch (e) {
        fail(e, opts);
      }
    });

  cmd
    .command('snapshot-delete <sandboxId> <snapshotId>')
    .description('Delete a snapshot\'s provider artifact')
    .option('--api-key <key>').option('--base-url <url>').option('--allow-untrusted-host')
    .option('--json', 'print the raw response')
    .action(async (sandboxId: string, snapshotId: string, opts: CommonOpts) => {
      try {
        const c = await client(opts);
        const res = await c.del<{ ok: boolean }>(
          `/api/v1/sandboxes/${sandboxId}/snapshots/${snapshotId}`,
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
