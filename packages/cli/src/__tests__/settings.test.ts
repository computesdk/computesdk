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
const { inheritParentOptions } = await import('../option-inheritance.js');
const { registerActionsCommands } = await import('../actions.js');

function buildSandboxes(): Command {
  const program = inheritParentOptions(new Command().enablePositionalOptions().exitOverride());
  registerSandboxesCommands(program);
  return program;
}
function buildActions(): Command {
  const program = new Command().exitOverride();
  registerActionsCommands(program);
  return program;
}

const SANDBOX_SETTINGS = {
  providerOrder: ['tensorlake', 'blaxel'],
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

const ROUTING = {
  strategy: 'computesdk',
  routing: 'default',
  size: 'medium',
  managed: ['daytona', 'e2b'],
  available: ['daytona', 'e2b'],
  byok: { mode: 'first', order: ['tensorlake', 'blaxel'] },
};

/** GET answers the router for `/routing` and `settings` for everything else. */
function mockGets(settings: unknown, routing: unknown = ROUTING): void {
  get.mockImplementation(async (path: string) => (path.endsWith('/routing') ? routing : settings));
}

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
  mockGets(SANDBOX_SETTINGS);
  patch.mockImplementation(async () => SANDBOX_SETTINGS);
});

describe('compute sandboxes settings', () => {
  it('shows managed routing first, then BYOK, then sizes and pools', async () => {
    const out = await captureStdout(() =>
      buildSandboxes().parseAsync(['sandboxes', 'settings'], { from: 'user' }),
    );
    expect(get).toHaveBeenCalledWith('/api/v1/sandboxes/routing');
    expect(get).toHaveBeenCalledWith('/api/v1/sandboxes/settings');
    expect(out).toMatch(/Routing\s+ComputeSDK \(recommended\)/);
    expect(out).toContain('daytona → e2b');
    expect(out).toMatch(/BYOK\s+first/);
    expect(out).toContain('tensorlake → blaxel');
    expect(out.indexOf('Routing')).toBeLessThan(out.indexOf('BYOK'));
    expect(out).toContain('blaxel  4 vCPU / 8192 MB');
    expect(out).toContain('blaxel  2');
    expect(out).not.toMatch(/order type|general cap|per-size caps|market/);
  });

  it('shows a custom managed order and hides the BYOK order when BYOK is off', async () => {
    mockGets(SANDBOX_SETTINGS, { ...ROUTING, strategy: 'custom', routing: ['e2b'], managed: ['e2b'], byok: { mode: 'off', order: ['tensorlake'] } });
    const out = await captureStdout(() =>
      buildSandboxes().parseAsync(['sandboxes', 'settings'], { from: 'user' }),
    );
    expect(out).toMatch(/Routing\s+Custom/);
    expect(out).toMatch(/Order\s+e2b/);
    expect(out).toMatch(/BYOK\s+off/);
    expect(out).not.toContain('BYOK order');
  });

  it('shows cheapest with the size it is priced at', async () => {
    mockGets(SANDBOX_SETTINGS, { ...ROUTING, strategy: 'cheapest', managed: ['e2b', 'daytona'] });
    const out = await captureStdout(() =>
      buildSandboxes().parseAsync(['sandboxes', 'settings'], { from: 'user' }),
    );
    expect(out).toMatch(/Routing\s+Cheapest/);
    expect(out).toContain('e2b → daytona  (priced at medium)');
  });

  it('reads an older server without strategy from routing', async () => {
    mockGets(SANDBOX_SETTINGS, { routing: ['e2b'], managed: ['e2b'], available: ['e2b'], byok: { mode: 'off', order: [] } });
    const out = await captureStdout(() =>
      buildSandboxes().parseAsync(['sandboxes', 'settings'], { from: 'user' }),
    );
    expect(out).toMatch(/Routing\s+Custom/);
  });

  it('marks an inherited Sandboxes BYOK order with the order placement uses', async () => {
    mockGets(SANDBOX_SETTINGS, { ...ROUTING, byok: { mode: 'first', order: ['blaxel'], inherits: true } });
    const out = await captureStdout(() =>
      buildSandboxes().parseAsync(['sandboxes', 'settings'], { from: 'user' }),
    );
    expect(out).toContain('blaxel  (inherited from the Actions router)');
  });

  it('--json prints the router and the settings', async () => {
    const out = await captureStdout(() =>
      buildSandboxes().parseAsync(['sandboxes', 'settings', '--json'], { from: 'user' }),
    );
    expect(JSON.parse(out)).toEqual({ routing: ROUTING, settings: SANDBOX_SETTINGS });
  });
});

describe('compute sandboxes settings set', () => {
  it.each(['2xlarge', '3xlarge'])('accepts a %s price cap', async (size) => {
    await buildSandboxes().parseAsync(
      ['sandboxes', 'settings', 'set', '--cap', `${size}=1.28/hour`],
      { from: 'user' },
    );
    expect(patch).toHaveBeenCalledWith('/api/v1/sandboxes/settings', {
      marketCaps: { [size]: { usd: 1.28, per: 'hour' } },
    });
  });

  it('sends --routing, --byok and --byok-order to the router', async () => {
    await buildSandboxes().parseAsync(
      ['sandboxes', 'settings', 'set', '--routing', 'default', '--byok', 'first', '--byok-order', 'tensorlake,blaxel'],
      { from: 'user' },
    );
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/api/v1/sandboxes/routing', {
      routing: 'default',
      byok: 'first',
      byokOrder: ['tensorlake', 'blaxel'],
    });
  });

  it('flags before set reach it (settings --org team-b set …)', async () => {
    const { resolveActionsAuth } = await import('../actions-client.js');
    const { client } = await import('../actions.js');
    vi.mocked(resolveActionsAuth).mockClear();
    vi.mocked(client).mockClear();
    await buildSandboxes().parseAsync(['sandboxes', 'settings', '--org', 'team-b', 'set', '--byok', 'only'], { from: 'user' });
    // Whichever layer built the client, it was asked for team-b.
    const calls = JSON.stringify([...vi.mocked(resolveActionsAuth).mock.calls, ...vi.mocked(client).mock.calls]);
    expect(calls).toContain('team-b');
    expect(patch).toHaveBeenCalledWith('/api/v1/sandboxes/routing', { byok: 'only' });
  });

  it.each(['computesdk', 'cheapest'])('--routing %s picks a strategy', async (strategy) => {
    await buildSandboxes().parseAsync(['sandboxes', 'settings', 'set', '--routing', strategy], { from: 'user' });
    expect(patch).toHaveBeenLastCalledWith('/api/v1/sandboxes/routing', { routing: strategy });
  });

  it('--routing takes a managed order', async () => {
    await buildSandboxes().parseAsync(
      ['sandboxes', 'settings', 'set', '--routing', 'daytona, e2b'],
      { from: 'user' },
    );
    expect(patch).toHaveBeenCalledWith('/api/v1/sandboxes/routing', { routing: ['daytona', 'e2b'] });
  });

  it('--byok-order inherit, and the old --order, write the BYOK order', async () => {
    await buildSandboxes().parseAsync(['sandboxes', 'settings', 'set', '--byok-order', 'inherit'], { from: 'user' });
    expect(patch).toHaveBeenLastCalledWith('/api/v1/sandboxes/routing', { byokOrder: [] });
    await buildSandboxes().parseAsync(['sandboxes', 'settings', 'set', '--order', 'blaxel'], { from: 'user' });
    expect(patch).toHaveBeenLastCalledWith('/api/v1/sandboxes/routing', { byokOrder: ['blaxel'] });
  });

  it('rejects an unknown --byok mode', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await buildSandboxes().parseAsync(['sandboxes', 'settings', 'set', '--byok', 'sometimes'], { from: 'user' });
    } catch {
      /* noop */
    } finally {
      exit.mockRestore();
      err.mockRestore();
    }
    expect(patch).not.toHaveBeenCalled();
  });

  it('keeps the unreleased price flags working but out of help', async () => {
    await buildSandboxes().parseAsync(['sandboxes', 'settings', 'set', '--general-cap', 'none'], { from: 'user' });
    expect(patch).toHaveBeenCalledWith('/api/v1/sandboxes/settings', { marketCap: null });
    const program = buildSandboxes();
    const set = program.commands.find((c) => c.name() === 'sandboxes' || c.aliases().includes('sandboxes'))!
      .commands.find((c) => c.name() === 'settings')!
      .commands.find((c) => c.name() === 'set')!;
    const help = set.helpInformation();
    expect(help).toContain('--routing');
    expect(help).toContain('--byok-order');
    expect(help).not.toMatch(/--cap|--general-cap|--order-type|market/);
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
  it('GETs the Actions router and settings', async () => {
    mockGets(ACTIONS_SETTINGS);
    const out = await captureStdout(() =>
      buildActions().parseAsync(['actions', 'settings'], { from: 'user' }),
    );
    expect(get).toHaveBeenCalledWith('/api/v1/actions/routing');
    expect(get).toHaveBeenCalledWith('/api/v1/actions/settings');
    expect(out).toContain('ComputeSDK (recommended)');
    expect(out).toContain('warm pool');
    expect(out).toContain('snapshot pool');
  });

  it('settings set changes the Actions router', async () => {
    await buildActions().parseAsync(['actions', 'settings', 'set', '--byok', 'only'], { from: 'user' });
    expect(patch).toHaveBeenCalledWith('/api/v1/actions/routing', { byok: 'only' });
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

describe('review fixes', () => {
  it('rejects an --order that names no providers', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await buildSandboxes().parseAsync(
        ['sandboxes', 'settings', 'set', '--order', ','],
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

describe('compute sandboxes settings set --resources / --warm-pool', () => {
  async function rejects(args: string[]): Promise<string> {
    let errText = '';
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    const err = vi.spyOn(console, 'error').mockImplementation((...a) => void (errText += a.join(' ')));
    try {
      await buildSandboxes().parseAsync(['sandboxes', 'settings', 'set', ...args], { from: 'user' });
    } catch {
      /* exit */
    } finally {
      expect(exit).toHaveBeenCalledWith(1);
      exit.mockRestore();
      err.mockRestore();
    }
    expect(patch).not.toHaveBeenCalled();
    return errText;
  }

  it('builds providerResources from repeatable --resources, none clearing', async () => {
    await buildSandboxes().parseAsync(
      ['sandboxes', 'settings', 'set', '--resources', 'archil=large', '--resources', 'e2b=none'],
      { from: 'user' },
    );
    expect(patch).toHaveBeenCalledWith('/api/v1/sandboxes/settings', {
      providerResources: { archil: 'large', e2b: null },
    });
  });

  it('builds warmPool from repeatable --warm-pool with provider[:region] keys', async () => {
    await buildSandboxes().parseAsync(
      ['sandboxes', 'settings', 'set', '--warm-pool', 'archil:us-east=3', '--warm-pool', 'blaxel=0'],
      { from: 'user' },
    );
    expect(patch).toHaveBeenCalledWith('/api/v1/sandboxes/settings', {
      warmPool: { 'archil:us-east': 3, blaxel: 0 },
    });
  });

  it('sends sizes and pools together in one PATCH', async () => {
    await buildSandboxes().parseAsync(
      ['sandboxes', 'settings', 'set', '--resources', 'blaxel=small', '--warm-pool', 'blaxel=1'],
      { from: 'user' },
    );
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/api/v1/sandboxes/settings', {
      providerResources: { blaxel: 'small' },
      warmPool: { blaxel: 1 },
    });
  });

  it('refuses to mix routing and sizes/pools, so nothing half-applies', async () => {
    expect(await rejects(['--resources', 'blaxel=small', '--order', 'blaxel'])).toMatch(/separate commands/);
    expect(await rejects(['--routing', 'e2b', '--warm-pool', 'blaxel=1'])).toMatch(/separate commands/);
  });

  it('rejects a warm pool above 16', async () => {
    expect(await rejects(['--warm-pool', 'blaxel=17'])).toMatch(/0\.\.16/);
  });

  it('rejects a warm pool without =n, or with a non-integer', async () => {
    expect(await rejects(['--warm-pool', 'blaxel'])).toMatch(/--warm-pool/);
    expect(await rejects(['--warm-pool', 'blaxel=1.5'])).toMatch(/--warm-pool/);
    expect(await rejects(['--warm-pool', '=2'])).toMatch(/--warm-pool/);
  });

  it('rejects --resources without a preset', async () => {
    expect(await rejects(['--resources', 'blaxel'])).toMatch(/--resources/);
    expect(await rejects(['--resources', 'blaxel='])).toMatch(/--resources/);
    expect(await rejects(['--resources', '=small'])).toMatch(/--resources/);
  });

  it('settings render has a resources row and a warm-pool row', async () => {
    mockGets({
      ...SANDBOX_SETTINGS,
      providerResources: { blaxel: { memoryMb: 2048 }, archil: { cpus: 4, memoryMb: 8192 }, e2b: { cpus: 2, memoryMb: 4096 } },
      providerResourcePresets: { blaxel: null, archil: 'large' },
      warmPool: { blaxel: 1 },
    });
    const out = await captureStdout(() =>
      buildSandboxes().parseAsync(['sandboxes', 'settings'], { from: 'user' }),
    );
    expect(out).toContain('resources:');
    expect(out).toContain('blaxel  2048 MB');
    expect(out).not.toContain('? vCPU');
    expect(out).toContain('archil  large (4 vCPU / 8192 MB)');
    expect(out).toContain('e2b  2 vCPU / 4096 MB');
    expect(out).toMatch(/warm pool:\s*\n?\s*blaxel {2}1/);
  });
});

describe('compute actions settings set --resources / --warm-pool / --snapshot-pool', () => {
  async function rejects(args: string[], build: () => Command = buildActions, lane = 'actions'): Promise<string> {
    let errText = '';
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    const err = vi.spyOn(console, 'error').mockImplementation((...a) => void (errText += a.join(' ')));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errText += String(chunk);
      return true;
    });
    try {
      await build().parseAsync([lane, 'settings', 'set', ...args], { from: 'user' });
    } catch {
      /* exit */
    } finally {
      exit.mockRestore();
      err.mockRestore();
      stderr.mockRestore();
    }
    expect(patch).not.toHaveBeenCalled();
    return errText;
  }

  it('PATCHes sizes and both pools on the actions lane in one call', async () => {
    patch.mockImplementation(async () => ACTIONS_SETTINGS);
    await buildActions().parseAsync(
      [
        'actions', 'settings', 'set',
        '--resources', 'blaxel=large', '--resources', 'e2b=none',
        '--warm-pool', 'blaxel:us-pdx-1=2', '--warm-pool', 'e2b=0',
        '--snapshot-pool', 'blaxel=8',
      ],
      { from: 'user' },
    );
    expect(patch).toHaveBeenCalledWith('/api/v1/actions/settings', {
      providerResources: { blaxel: 'large', e2b: null },
      warmPool: { 'blaxel:us-pdx-1': 2, e2b: 0 },
      snapshotPool: { blaxel: 8 },
    });
  });

  it('rejects a snapshot pool above 32 and a malformed entry', async () => {
    expect(await rejects(['--snapshot-pool', 'blaxel=33'])).toMatch(/0\.\.32/);
    expect(await rejects(['--snapshot-pool', 'blaxel'])).toMatch(/--snapshot-pool/);
  });

  it('keeps --snapshot-pool off the sandboxes lane', async () => {
    expect(await rejects(['--snapshot-pool', 'blaxel=1'], buildSandboxes, 'sandboxes')).toMatch(/unknown option/);
  });

  it('names every actions flag when nothing is passed', async () => {
    expect(await rejects([])).toMatch(/--resources, --warm-pool, or --snapshot-pool/);
  });

  it('prints preset names and the snapshot summary', async () => {
    mockGets({
      ...ACTIONS_SETTINGS,
      providerOrder: [],
      defaultProviderOrder: ['vercel'],
      providerResources: { blaxel: { cpus: 4, memoryMb: 8192 } },
      providerResourcePresets: { blaxel: 'large' },
      snapshotPool: { blaxel: 4 },
      snapshotSummary: {
        workflows: [
          { repoFullName: 'ada/app', path: '.github/workflows/ci.yml', name: 'CI', snapshotCap: 3 },
          { repoFullName: 'ada/app', path: '.github/workflows/off.yml', name: 'Off', snapshotCap: 0 },
          { repoFullName: 'ada/app', path: '.github/workflows/dyn.yml', name: 'Dyn', snapshotCap: null },
        ],
        live: [{ repoFullName: 'ada/app', workflowPath: '.github/workflows/ci.yml', count: 2 }],
      },
    });
    const out = await captureStdout(() => buildActions().parseAsync(['actions', 'settings'], { from: 'user' }));
    expect(out).toContain('blaxel  large (4 vCPU / 8192 MB)');
    expect(out).toMatch(/snapshot pool:\s*\n?\s*blaxel {2}4/);
    expect(out).toContain('ada/app  .github/workflows/ci.yml  3');
    expect(out).toContain('ada/app  .github/workflows/off.yml  off');
    expect(out).not.toContain('dyn.yml');
    expect(out).toMatch(/live snapshots:\s*\n?\s*ada\/app {2}\.github\/workflows\/ci\.yml {2}2/);
  });

  it('strips terminal control sequences from workflow paths in the snapshot summary', async () => {
    const evil = '.github/workflows/\u001b]0;pwned\u0007ci.yml';
    mockGets({
      ...ACTIONS_SETTINGS,
      snapshotSummary: {
        workflows: [{ repoFullName: 'ada/app', path: evil, name: 'CI', snapshotCap: 3 }],
        live: [{ repoFullName: 'ada/app', workflowPath: evil, count: 1 }],
      },
    });
    const out = await captureStdout(() => buildActions().parseAsync(['actions', 'settings'], { from: 'user' }));
    expect(out).not.toContain('\u001b]0;');
    expect(out).not.toContain('\u0007');
  });
});
