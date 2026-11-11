import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn<[URL | string, RequestInit | undefined], Promise<Response>>(),
}));

vi.mock('../actions-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../actions-client.js')>();
  return {
    ...actual,
    resolveActionsAuth: vi.fn(async () => ({ apiKey: 'test', baseUrl: 'https://platform.test', orgSlug: null })),
    ActionsClient: vi.fn(function ActionsClient(auth: ConstructorParameters<typeof actual.ActionsClient>[0]) {
      return new actual.ActionsClient(auth, fetchMock as unknown as typeof fetch);
    }),
  };
});

const { registerSandboxesCommands } = await import('../sandboxes.js');

class Exit extends Error {
  constructor(public code: number | undefined) {
    super(`exit ${code}`);
  }
}

function program(): Command {
  const p = new Command().enablePositionalOptions().exitOverride();
  registerSandboxesCommands(p);
  return p;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const COSTS = {
  currency: 'USD',
  running: { count: 1, costUsd: 0.02 },
  settled: { count: 3, costUsd: 1.2 },
  totalUsd: 1.22,
  byProvider: [
    { provider: 'blaxel', count: 3, costUsd: 1.02, running: { count: 1, costUsd: 0.02 }, settled: { count: 2, costUsd: 1 } },
    { provider: 'beam', count: 1, costUsd: 0.2, running: { count: 0, costUsd: 0 }, settled: { count: 1, costUsd: 0.2 } },
  ],
};

let stdout: string;
let stderr: string;
const requests = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    method: init?.method ?? 'GET',
    url: String(url).replace('https://platform.test', ''),
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  }));

async function cli(...args: string[]): Promise<number> {
  try {
    await program().parseAsync(['instances', ...args], { from: 'user' });
    return 0;
  } catch (e) {
    if (e instanceof Exit) return e.code ?? 0;
    // Commander usage errors under exitOverride.
    if (e && typeof e === 'object' && 'exitCode' in e) return Number((e as { exitCode: number }).exitCode);
    throw e;
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => ((stdout += String(s)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => ((stderr += String(s)), true));
  vi.spyOn(console, 'log').mockImplementation((...a) => void (stdout += a.join(' ') + '\n'));
  vi.spyOn(console, 'error').mockImplementation((...a) => void (stderr += a.join(' ') + '\n'));
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Exit(code === undefined || code === null ? undefined : Number(code));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('compute instances costs', () => {
  it('GETs the org costs and --json prints the API body', async () => {
    fetchMock.mockResolvedValueOnce(json(COSTS));
    expect(await cli('costs', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'GET', url: '/api/v1/sandboxes/costs', body: undefined }]);
    expect(JSON.parse(stdout)).toEqual(COSTS);
  });

  it('--customer-only sends customerOnly=true', async () => {
    fetchMock.mockResolvedValueOnce(json(COSTS));
    expect(await cli('costs', '--customer-only', '--json')).toBe(0);
    expect(requests()[0].url).toBe('/api/v1/sandboxes/costs?customerOnly=true');
  });

  it('prints a table with provider, running count, running cost, settled and total columns', async () => {
    fetchMock.mockResolvedValueOnce(json(COSTS));
    expect(await cli('costs')).toBe(0);
    const lines = stdout.split('\n');
    const header = lines.find((l) => l.startsWith('PROVIDER'));
    expect(header).toBeDefined();
    for (const col of ['RUNNING', 'RUNNING COST', 'SETTLED', 'TOTAL']) expect(header).toContain(col);
    const all = lines.find((l) => l.startsWith('all'));
    expect(all).toMatch(/all\s+4\s+1\s+\$0\.02\s+3 · \$1\.20\s+\$1\.22/);
    expect(lines.find((l) => l.startsWith('blaxel'))).toContain('$1.02');
    expect(lines.find((l) => l.startsWith('beam'))).toContain('$0.20');
    expect(lines.find((l) => l.startsWith('blaxel'))).toMatch(/blaxel\s+3\s+1\s+\$0\.02\s+2 · \$1\.00\s+\$1\.02/);
    expect(lines.find((l) => l.startsWith('beam'))).toMatch(/beam\s+1\s+0\s+\$0\.00\s+1 · \$0\.20\s+\$0\.20/);
  });

  it('shows — in provider split columns when the server omits them', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ ...COSTS, byProvider: [{ provider: 'blaxel', count: 3, costUsd: 1.02 }] }),
    );
    expect(await cli('costs')).toBe(0);
    const row = stdout.split('\n').find((l) => l.startsWith('blaxel'));
    expect(row).toMatch(/blaxel\s+3\s+—\s+—\s+—\s+\$1\.02/);
  });

  it('renders the error envelope and exits 1 on an API error', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Unauthorized', code: 'unauthorized' }, 401));
    expect(await cli('costs', '--json')).toBe(1);
    expect(JSON.parse(stderr).error).toMatchObject({ message: 'Unauthorized' });
  });
});

describe('compute instances --help', () => {
  it('lists costs and settings, and no rates', () => {
    const names = program().commands.find((c) => c.name() === 'instances')!.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['costs', 'settings']));
    expect(names).not.toContain('rates');
  });
});

describe('compute instances list', () => {
  const PAGE = { sandboxes: [], nextCursor: null };

  it('sends no filters by default', async () => {
    fetchMock.mockResolvedValueOnce(json(PAGE));
    expect(await cli('list', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'GET', url: '/api/v1/sandboxes', body: undefined }]);
  });

  it('--customer-only, --status active, --search, --sort and --direction reach the query', async () => {
    fetchMock.mockResolvedValueOnce(json(PAGE));
    expect(
      await cli('list', '--customer-only', '--status', 'active', '--search', 'e2b box', '--sort', 'cost', '--direction', 'asc', '--limit', '5', '--json'),
    ).toBe(0);
    const url = new URL(requests()[0].url, 'https://platform.test');
    expect(url.pathname).toBe('/api/v1/sandboxes');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'active',
      customerOnly: 'true',
      q: 'e2b box',
      sort: 'cost',
      direction: 'asc',
      limit: '5',
    });
  });

  it('passes a sorted page cursor back with the sort', async () => {
    fetchMock.mockResolvedValueOnce(json(PAGE));
    expect(await cli('list', '--sort', 'name', '--cursor', 's1.abc', '--json')).toBe(0);
    const url = new URL(requests()[0].url, 'https://platform.test');
    expect(Object.fromEntries(url.searchParams)).toEqual({ sort: 'name', cursor: 's1.abc' });
  });

  it('refuses an unknown --sort or --direction before calling the API', async () => {
    expect(await cli('list', '--sort', 'size', '--json')).toBe(1);
    expect(await cli('list', '--direction', 'up', '--json')).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stderr + stdout).toContain('--sort must be one of created, name, cost, runtime');
  });

  it('documents active in --status help', () => {
    const list = program().commands.find((c) => c.name() === 'instances')!.commands.find((c) => c.name() === 'list')!;
    expect(list.options.find((o) => o.long === '--status')?.description).toContain('active');
  });
});
