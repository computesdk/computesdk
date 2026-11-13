/**
 * `compute credits` — the org's prepaid credit, which managed accounts bill
 * from: balance, ledger and top-ups over `/api/v1/billing/*`. These lived
 * under `compute market`; credit is every org's now, so they have their own
 * top-level home (`compute market credits|ledger|topup` stay, hidden).
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { client, fail, output, usageErrorOutput, type CommonOpts } from './actions.js';
import {
  formatCredits,
  formatLedgerRow,
  parseTopupAmount,
  type MarketCreditBalance,
  type MarketLedgerEntry,
} from './market.js';
import { formatMoney } from './rate-display.js';

const MICRO_USD = 1_000_000;

/** POST /api/v1/billing/topups. `creditMicroUsd`/`feeBps` arrive from platforms with the top-up fee. */
interface TopupCheckout {
  url: string | null;
  amountMicroUsd: number;
  creditMicroUsd?: number;
  feeBps?: number;
}

export function registerCreditsCommands(program: Command): void {
  const common = (cmd: Command) =>
    cmd
      .option('--api-key <key>', 'API key (default: $COMPUTE_API_KEY)')
      .option('--base-url <url>', 'API base URL (default: https://platform.computesdk.com)')
      .option('--org <slug>', 'organization slug for this command (or $COMPUTE_ORG)')
      .option('--allow-untrusted-host', 'send an explicit --api-key/env key to a non-computesdk, non-localhost --base-url (stored login credentials are never sent)')
      .option('--json', 'print machine-readable JSON');

  const credits = common(
    program
      .command('credits')
      .description('Your prepaid credit — managed accounts bill from it: balance, ledger, top-ups')
      .configureOutput({ outputError: usageErrorOutput }),
  ).action(async (opts: CommonOpts) => {
    try {
      const balance = await (await client(opts)).get<MarketCreditBalance>('/api/v1/billing/balance');
      output(opts, balance, (b) => console.log(formatCredits(b)));
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    credits
      .command('ledger')
      .description('Credit history, newest first: top-ups, grants, holds, charges, refunds')
      .option('--limit <n>', 'entries per page (max 200, default 50)')
      .option('--cursor <cursor>', 'continue from a previous page'),
  ).action(async (opts: CommonOpts & { limit?: string; cursor?: string }) => {
    try {
      const page = await (await client(opts)).get<{ entries: MarketLedgerEntry[]; nextCursor: string | null }>(
        '/api/v1/billing/ledger',
        { limit: opts.limit, cursor: opts.cursor },
      );
      output(opts, page, (p) => {
        if (p.entries.length === 0) {
          console.log('No credit activity yet — add credit with `compute credits topup <usd>`.');
          return;
        }
        for (const entry of p.entries) console.log(formatLedgerRow(entry));
        if (p.nextCursor) console.log(pc.dim(`more: --cursor ${p.nextCursor}`));
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    credits
      .command('topup')
      .description('Add credit — prints a Stripe checkout link to pay in your browser (owner/admin)')
      .argument('<usd>', 'amount to pay in USD (e.g. 50)'),
  ).action(async (amount: string, opts: CommonOpts) => {
    try {
      const result = await (await client(opts)).post<TopupCheckout>('/api/v1/billing/topups', {
        amountUsd: parseTopupAmount(amount),
      });
      output(opts, result, (r) => {
        const pay = formatMoney(r.amountMicroUsd / MICRO_USD);
        if (r.creditMicroUsd !== undefined && r.feeBps !== undefined && r.feeBps > 0) {
          console.log(`Pay ${pay} for ${formatMoney(r.creditMicroUsd / MICRO_USD)} of credit (${r.feeBps / 100}% top-up fee) at:`);
        } else {
          console.log(`Pay ${pay} at:`);
        }
        console.log(r.url ?? pc.dim('(no checkout link returned)'));
      });
    } catch (e) {
      fail(e, opts);
    }
  });
}
