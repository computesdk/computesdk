/** Read-only diagnostics using the same credentials and org routing as commands. */
import { Command } from 'commander';
import type { SandboxSummary } from '@computesdk/platform';
import { client, output, safeTerm, type CommonOpts } from './actions.js';
import { resolveInstanceId } from './current-instance.js';
import type { ActionsOrg } from './actions-client.js';
import type { MarketCreditBalance } from './market.js';

export interface ComputeStatus {
  authenticated: boolean;
  ready: boolean;
  organization: ActionsOrg | null;
  credits: { balanceUsd: number; heldUsd: number } | null;
  sandbox: { id: string; status: string; provider: string | null } | null;
  routing: { ready: boolean; reason?: string } | null;
  issues: string[];
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function getStatus(opts: CommonOpts): Promise<ComputeStatus> {
  const status: ComputeStatus = {
    authenticated: false, ready: false, organization: null, credits: null,
    sandbox: null, routing: null, issues: [],
  };
  try {
    const c = await client(opts);
    const selected = resolveInstanceId(undefined, opts);
    // Partial service failures should leave the other diagnostics visible.
    const [org, balance, route, sandbox] = await Promise.allSettled([
      c.org(),
      c.get<MarketCreditBalance>('/api/v1/billing/balance'),
      c.get<{ quote: { ok: boolean; reason?: string } }>('/api/v1/sandboxes/quote'),
      selected ? c.get<{ sandbox: SandboxSummary }>(`/api/v1/sandboxes/${selected.id}`) : Promise.resolve(null),
    ]);
    if (org.status === 'fulfilled') {
      status.authenticated = true;
      status.organization = org.value;
    } else status.issues.push(`Authentication / organization: ${message(org.reason)}`);
    if (balance.status === 'fulfilled') {
      status.credits = { balanceUsd: balance.value.balanceMicroUsd / 1e6, heldUsd: balance.value.heldMicroUsd / 1e6 };
    } else status.issues.push(`Credits: ${message(balance.reason)}`);
    if (route.status === 'fulfilled') {
      status.routing = { ready: route.value.quote.ok, ...(route.value.quote.reason ? { reason: route.value.quote.reason } : {}) };
    } else status.issues.push(`Routing: ${message(route.reason)}`);
    if (sandbox.status === 'fulfilled' && sandbox.value) {
      const s = sandbox.value.sandbox;
      status.sandbox = { id: s.id, status: s.status, provider: s.provider };
    } else if (sandbox.status === 'rejected') {
      status.sandbox = { id: selected!.id, status: 'unknown', provider: null };
      status.issues.push(`Selected sandbox: ${message(sandbox.reason)}`);
    }
    status.ready = status.authenticated && status.routing?.ready === true;
  } catch (error) {
    status.issues.push(message(error));
  }
  return status;
}

export function registerStatusCommand(program: Command): void {
  program.command('status')
    .description('Show authentication, effective organization, credits, selected sandbox and routing readiness')
    .option('--api-key <key>').option('--base-url <url>').option('--org <slug>')
    .option('--allow-untrusted-host')
    .option('--json', 'print machine-readable JSON')
    .option('--check', 'exit 1 unless authenticated and the default sandbox route is ready')
    .action(async (opts: CommonOpts & { check?: boolean }) => {
      const status = await getStatus(opts);
      output(opts, status, (s) => {
        console.log(`Authentication: ${s.authenticated ? 'verified' : 'not verified — run compute login'}`);
        console.log(`Organization: ${safeTerm(s.organization?.slug ?? 'unavailable')}`);
        console.log(`Credits: ${s.credits ? `$${s.credits.balanceUsd.toFixed(2)} ($${s.credits.heldUsd.toFixed(2)} held)` : 'unavailable'}`);
        console.log(`Sandbox: ${s.sandbox ? safeTerm(`${s.sandbox.id} · ${s.sandbox.status} · ${s.sandbox.provider ?? 'unknown provider'}`) : 'none selected — run compute new'}`);
        console.log(`Routing: ${s.routing ? s.routing.ready ? 'ready' : safeTerm(s.routing.reason ?? 'unavailable') : 'unavailable'}`);
        for (const issue of s.issues) console.log(safeTerm(issue));
      });
      if (opts.check && !status.ready) process.exitCode = 1;
    });
}
