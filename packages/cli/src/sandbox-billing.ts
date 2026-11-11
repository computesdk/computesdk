/**
 * `compute instances costs` — the org's sandbox spend
 * (`GET /api/v1/sandboxes/costs`).
 */

import type { Command } from 'commander';
import type { ActionsClient } from './actions-client.js';
import type { CommonOpts } from './actions.js';
import { formatMoney } from './rate-display.js';

/** Injected by `sandboxes.ts`, matching the settings commands. */
export interface BillingDeps {
  client: (opts: CommonOpts) => Promise<ActionsClient>;
  output: <T>(opts: CommonOpts, data: T, render: (data: T) => void) => void;
  fail: (error: unknown, opts?: CommonOpts) => never;
}

// Wire shape mirrors benchmarks-platform lib/sandboxes/router.ts (`OrgSandboxCosts`).

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
}
