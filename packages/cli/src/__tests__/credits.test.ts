import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const get = vi.fn(async (_path: string, _params?: unknown): Promise<unknown> => ({}));
const post = vi.fn(async (_path: string, _body?: unknown): Promise<unknown> => ({}));
const fakeClient = { get, post, patch: vi.fn(), del: vi.fn() };

vi.mock('../actions-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../actions-client.js')>();
  return {
    ...actual,
    resolveActionsAuth: vi.fn(async () => ({ apiKey: 'test', baseUrl: 'https://platform.computesdk.com', orgSlug: null })),
    ActionsClient: vi.fn(function ActionsClient() {
      return fakeClient;
    }),
  };
});

const { registerCreditsCommands } = await import('../credits.js');
const { inheritParentOptions } = await import('../option-inheritance.js');

async function run(args: string[]): Promise<string> {
  const program = inheritParentOptions(new Command().exitOverride());
  registerCreditsCommands(program);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await program.parseAsync(args, { from: 'user' });
    return log.mock.calls.map((c) => String(c[0])).join('\n');
  } finally {
    log.mockRestore();
  }
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('compute credits', () => {
  it('flags before the subcommand reach it (compute credits --org team-b topup 50)', async () => {
    const { resolveActionsAuth } = await import('../actions-client.js');
    const auth = vi.mocked(resolveActionsAuth);
    post.mockResolvedValue({ url: 'https://checkout.stripe.com/x', amountMicroUsd: 50_000_000 });
    auth.mockClear();
    await run(['credits', '--org', 'team-b', 'topup', '50']);
    expect(JSON.stringify(auth.mock.calls[0])).toContain('team-b');
    get.mockResolvedValue({ entries: [], nextCursor: null });
    auth.mockClear();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await run(['credits', '--org', 'team-b', '--json', 'ledger']);
      expect(JSON.stringify(auth.mock.calls[0])).toContain('team-b');
      // --json given before the subcommand still switches the output to JSON.
      expect(JSON.parse(write.mock.calls.map((c) => String(c[0])).join(''))).toEqual({ entries: [], nextCursor: null });
    } finally {
      write.mockRestore();
    }
  });

  it('the subcommand\'s own flag wins over the parent\'s', async () => {
    const { resolveActionsAuth } = await import('../actions-client.js');
    const auth = vi.mocked(resolveActionsAuth);
    post.mockResolvedValue({ url: 'https://checkout.stripe.com/x', amountMicroUsd: 50_000_000 });
    auth.mockClear();
    await run(['credits', '--org', 'team-a', 'topup', '50', '--org', 'team-b']);
    const call = JSON.stringify(auth.mock.calls[0]);
    expect(call).toContain('team-b');
    expect(call).not.toContain('team-a');
  });

  it('shows the balance and what running sandboxes hold', async () => {
    get.mockResolvedValue({ balanceMicroUsd: 24_940_000, heldMicroUsd: 50_000, holds: [{ id: 'h', microUsd: 50_000, runId: null, jobId: null, createdAt: '' }] });
    const out = await run(['credits']);
    expect(get).toHaveBeenCalledWith('/api/v1/billing/balance');
    expect(out).toContain('available  $24.94');
    expect(out).toContain('1 running sandbox or job');
  });

  it('ledger pages through /billing/ledger', async () => {
    get.mockResolvedValue({ entries: [], nextCursor: null });
    const out = await run(['credits', 'ledger', '--limit', '5']);
    expect(get).toHaveBeenCalledWith('/api/v1/billing/ledger', { limit: '5', cursor: undefined });
    expect(out).toContain('compute credits topup');
  });

  it('topup shows the credit after the top-up fee', async () => {
    post.mockResolvedValue({ url: 'https://checkout.stripe.com/x', amountMicroUsd: 100_000_000, creditMicroUsd: 90_000_000, feeBps: 1000 });
    const out = await run(['credits', 'topup', '100']);
    expect(post).toHaveBeenCalledWith('/api/v1/billing/topups', { amountUsd: 100 });
    expect(out).toContain('Pay $100.00 for $90.00 of credit (10% top-up fee) at:');
    expect(out).toContain('https://checkout.stripe.com/x');
  });

  it('topup without a fee just shows the amount', async () => {
    post.mockResolvedValue({ url: 'https://checkout.stripe.com/y', amountMicroUsd: 50_000_000 });
    const out = await run(['credits', 'topup', '$50']);
    expect(out).toContain('Pay $50.00 at:');
  });
});
