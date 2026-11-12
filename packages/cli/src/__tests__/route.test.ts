import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const get = vi.fn(async (_path: string, _params?: unknown): Promise<unknown> => ({}));
const fakeClient = { get, patch: vi.fn(), post: vi.fn(), del: vi.fn() };

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

const { registerSandboxesCommands } = await import('../sandboxes.js');

function build(): Command {
  const program = new Command().enablePositionalOptions().exitOverride();
  registerSandboxesCommands(program);
  return program;
}

async function run(args: string[]): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await build().parseAsync(['sandboxes', ...args], { from: 'user' });
    return log.mock.calls.map((c) => String(c[0])).join('\n');
  } finally {
    log.mockRestore();
  }
}

const base = { orderType: 'limit', creditBalanceUsd: 25 };

beforeEach(() => {
  get.mockReset();
});

describe('compute sandboxes route', () => {
  it('a managed placement is billed from credit, with the hold and balance', async () => {
    get.mockResolvedValue({
      quote: {
        ...base,
        ok: true,
        providerOrder: ['managed/daytona', 'tensorlake'],
        placement: { source: 'house', provider: 'daytona', region: null, size: 'medium', box: { provider: 'daytona', sizeName: 'medium' } },
        rate: { usd: 0.10584, per: 'hour' },
        requiredHoldUsd: 0.05,
      },
    });
    const out = await run(['route']);
    expect(get).toHaveBeenCalledWith('/api/v1/sandboxes/quote', expect.anything());
    expect(out).toContain('daytona · managed · medium');
    expect(out).toContain('from your ComputeSDK credit');
    expect(out).toContain('balance $25.00');
    expect(out).toContain('daytona (managed) → tensorlake (BYOK)');
    expect(out).not.toMatch(/order type|cap|protection|cheapest|reference|market/i);
  });

  it('a BYOK placement is billed by the provider', async () => {
    get.mockResolvedValue({
      quote: {
        ...base,
        ok: true,
        providerOrder: ['tensorlake', 'managed/daytona'],
        placement: { source: 'own-key', provider: 'tensorlake', region: null, size: 'medium', box: { provider: 'tensorlake', sizeName: null } },
        rate: { usd: 0.1, per: 'hour' },
      },
    });
    const out = await run(['route']);
    expect(out).toContain('tensorlake · BYOK · medium');
    expect(out).toContain('billed by tensorlake to your account');
  });

  it('shows a hold only when the quote returns one', async () => {
    get.mockResolvedValue({
      quote: {
        ...base,
        ok: true,
        providerOrder: ['market'],
        placement: { source: 'market', provider: 'blaxel', region: null, size: 'medium', box: { provider: 'blaxel', sizeName: 'medium' } },
        rate: { usd: 0.2, per: 'hour' },
        estimatedCostUsd: 0.35,
      },
    });
    const out = await run(['route']);
    expect(out).not.toContain('held');
    expect(out).toMatch(/Estimate\s+\$0\.35/);
  });

  it('says why nothing can place', async () => {
    get.mockResolvedValue({
      quote: { ...base, ok: false, reason: 'insufficient_credits', providerOrder: ['managed/daytona'], requiredHoldUsd: 3, topUpPath: '/acme/settings/billing' },
    });
    const out = await run(['route']);
    expect(out).toContain('not enough ComputeSDK credit for the hold');
  });

  it('--provider narrows the router for this quote', async () => {
    get.mockResolvedValue({ quote: { ...base, ok: false, reason: 'no_provider_configured', providerOrder: [] } });
    await run(['route', '--provider', 'daytona, e2b']);
    expect(get).toHaveBeenCalledWith('/api/v1/sandboxes/quote', expect.objectContaining({ only: 'daytona,e2b' }));
  });

  it('keeps quote as a hidden alias', async () => {
    get.mockResolvedValue({ quote: { ...base, ok: false, reason: 'no_provider_configured', providerOrder: [] } });
    await run(['quote']);
    expect(get).toHaveBeenCalledWith('/api/v1/sandboxes/quote', expect.anything());
    const sandboxes = build().commands.find((c) => c.name() === 'sandboxes' || c.aliases().includes('sandboxes'))!;
    expect(sandboxes.helpInformation()).toContain('route');
    expect(sandboxes.helpInformation()).not.toMatch(/\bquote\b/);
  });
});
