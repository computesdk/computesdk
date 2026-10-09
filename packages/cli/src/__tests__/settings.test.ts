import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const get = vi.fn(async (_path: string): Promise<unknown> => ({}));
const patch = vi.fn(async (_path: string, _body: unknown): Promise<unknown> => ({}));
const fakeClient = { get, patch, post: vi.fn(), del: vi.fn() };

vi.mock('../actions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../actions.js')>();
  return { ...actual, client: vi.fn(async () => fakeClient) };
});

// Commands registered inside actions.ts call its module-local `client()`,
// which module mocks can't intercept — so stub the pieces `client()` builds
// on: auth resolution and the ActionsClient constructor.
vi.mock('../actions-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../actions-client.js')>();
  return {
    ...actual,
    resolveActionsAuth: vi.fn(async () => ({
      apiKey: 'test',
      baseUrl: 'https://platform.computesdk.com',
      orgSlug: null,
    })),
    ActionsClient: vi.fn(function ActionsClient() {
      return fakeClient;
    }),
  };
});

const { registerSandboxesCommands } = await import('../sandboxes.js');
const { registerActionsCommands } = await import('../actions.js');

function buildSandboxes(): Command {
  const program = new Command().enablePositionalOptions().exitOverride();
  registerSandboxesCommands(program);
  return program;
}
function buildActions(): Command {
  const program = new Command().exitOverride();
  registerActionsCommands(program);
  return program;
}

const SANDBOX_SETTINGS = {
  providerOrder: ['market', 'blaxel'],
  actionsProviderOrder: ['blaxel', 'vercel'],
  marketCap: null,
  actionsMarketCap: { usd: 0.4, per: 'hour' },
  marketOrderType: null,
  actionsMarketOrderType: 'limit',
  marketCaps: { small: { usd: 0.1, per: 'hour' }, medium: null, large: null, xlarge: null },
  referencePrices: { small: null, medium: { usd: 0.12, per: 'hour' }, large: null, xlarge: null },
  providerResources: { blaxel: { cpus: 4, memoryMb: 8192 } },
  warmPool: { blaxel: 2 },
};

const ACTIONS_SETTINGS = {
  providerOrder: ['blaxel'],
  providerResources: {},
  warmPool: { blaxel: 1 },
  snapshotPool: {},
  marketCap: { usd: 0.4, per: 'hour' },
  marketCaps: { small: null, medium: null, large: null, xlarge: null },
  marketOrderType: 'limit',
  referencePrices: { small: null, medium: null, large: null, xlarge: null },
};

function captureStdout(fn: () => Promise<unknown>): Promise<string> {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return fn().then(
    () => {
      const out = [...write.mock.calls, ...log.mock.calls].map((c) => String(c[0])).join('');
      write.mockRestore();
      log.mockRestore();
      return out;
    },
    (err) => {
      write.mockRestore();
      log.mockRestore();
      throw err;
    },
  );
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  get.mockImplementation(async () => SANDBOX_SETTINGS);
  patch.mockImplementation(async () => SANDBOX_SETTINGS);
});

describe('compute sandboxes settings', () => {
  it('GETs the settings and prints the resolved view', async () => {
    const out = await captureStdout(() =>
      buildSandboxes().parseAsync(['sandboxes', 'settings'], { from: 'user' }),
    );
    expect(get).toHaveBeenCalledWith('/api/v1/sandboxes/settings');
    expect(out).toContain('order type: inherit');
    expect(out).toContain('Actions: limit');
    expect(out).toContain('inherits Actions: $0.4/hour');
    expect(out).toContain('reference $0.12/hour');
    expect(out).toContain('market, blaxel');
    expect(out).toContain('blaxel  4 vCPU / 8192 MB');
    expect(out).toContain('blaxel  2');
  });

  it('--json prints the raw response', async () => {
    const out = await captureStdout(() =>
      buildSandboxes().parseAsync(['sandboxes', 'settings', '--json'], { from: 'user' }),
    );
    expect(JSON.parse(out)).toEqual(SANDBOX_SETTINGS);
  });
});

describe('compute sandboxes settings set', () => {
  it('PATCHes caps, order type and order together', async () => {
    await buildSandboxes().parseAsync(
      [
        'sandboxes', 'settings', 'set',
        '--cap', 'small=0.11/hour', '--cap', 'large=none',
        '--general-cap', '0.4/hour',
        '--order-type', 'market',
        '--order', 'market,blaxel',
      ],
      { from: 'user' },
    );
    expect(patch).toHaveBeenCalledWith('/api/v1/sandboxes/settings', {
      marketCaps: {
        small: { usd: 0.11, per: 'hour' },
        large: null,
      },
      marketCap: { usd: 0.4, per: 'hour' },
      marketOrderType: 'market',
      providerOrder: ['market', 'blaxel'],
    });
  });

  it('--order-type inherit and --order inherit send null/[]', async () => {
    await buildSandboxes().parseAsync(
      ['sandboxes', 'settings', 'set', '--order-type', 'inherit', '--order', 'inherit'],
      { from: 'user' },
    );
    expect(patch).toHaveBeenCalledWith('/api/v1/sandboxes/settings', {
      marketOrderType: null,
      providerOrder: [],
    });
  });

  it('--general-cap none sends marketCap: null', async () => {
    await buildSandboxes().parseAsync(
      ['sandboxes', 'settings', 'set', '--general-cap', 'none'],
      { from: 'user' },
    );
    expect(patch).toHaveBeenCalledWith('/api/v1/sandboxes/settings', { marketCap: null });
  });

  it('rejects a cap without a unit before calling the API', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await buildSandboxes().parseAsync(
        ['sandboxes', 'settings', 'set', '--cap', 'small=0.11'],
        { from: 'user' },
      );
    } catch {
      /* commander exitOverride may throw */
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
    expect(patch).not.toHaveBeenCalled();
  });

  it('rejects an unknown size', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await buildSandboxes().parseAsync(
        ['sandboxes', 'settings', 'set', '--cap', 'huge=0.11/hour'],
        { from: 'user' },
      );
    } catch {
      /* noop */
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
    expect(patch).not.toHaveBeenCalled();
  });

  it('refuses to PATCH with no flags', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await buildSandboxes().parseAsync(['sandboxes', 'settings', 'set'], { from: 'user' });
    } catch {
      /* noop */
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('compute actions settings', () => {
  it('GETs and prints actions settings', async () => {
    get.mockImplementation(async () => ACTIONS_SETTINGS);
    const out = await captureStdout(() =>
      buildActions().parseAsync(['actions', 'settings'], { from: 'user' }),
    );
    expect(get).toHaveBeenCalledWith('/api/v1/actions/settings');
    expect(out).toContain('order type: limit');
    expect(out).toContain('general cap: $0.4/hour');
    expect(out).toContain('warm pool');
    expect(out).toContain('snapshot pool');
  });

  it('settings set PATCHes the actions lane', async () => {
    patch.mockImplementation(async () => ACTIONS_SETTINGS);
    await buildActions().parseAsync(
      [
        'actions', 'settings', 'set',
        '--order-type', 'market',
        '--cap', 'medium=0.2/hour',
      ],
      { from: 'user' },
    );
    expect(patch).toHaveBeenCalledWith('/api/v1/actions/settings', {
      marketOrderType: 'market',
      marketCaps: { medium: { usd: 0.2, per: 'hour' } },
    });
  });

  it('rejects inherit on the actions lane', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await buildActions().parseAsync(
        ['actions', 'settings', 'set', '--order-type', 'inherit'],
        { from: 'user' },
      );
    } catch {
      /* noop */
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
    expect(patch).not.toHaveBeenCalled();
  });
});
