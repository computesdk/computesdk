import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

const { fetchMock, question } = vi.hoisted(() => ({
  fetchMock: vi.fn<[URL | string, RequestInit | undefined], Promise<Response>>(),
  question: vi.fn(async (_q: string) => ''),
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

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question, close: () => undefined }),
}));

const { registerSandboxesCommands } = await import('../sandboxes.js');
const { parseRateArg } = await import('../sandbox-billing.js');

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

const RATES = {
  rates: [
    {
      provider: 'beam',
      usd: 0.5,
      per: 'hour',
      rateUsd: { perSecond: 0.5 / 3600, perMinute: 0.5 / 60, perHour: 0.5 },
      source: 'organization',
      fallback: { usd: 0.3, per: 'hour', source: 'builtin' },
    },
    {
      provider: 'blaxel',
      usd: 0.0001,
      per: 'second',
      rateUsd: { perSecond: 0.0001, perMinute: 0.006, perHour: 0.36 },
      source: 'platform',
      fallback: null,
    },
  ],
};

const RATES_AFTER_RM = {
  rates: [
    {
      provider: 'beam',
      usd: 0.3,
      per: 'hour',
      rateUsd: { perSecond: 0.3 / 3600, perMinute: 0.005, perHour: 0.3 },
      source: 'builtin',
      fallback: null,
    },
    RATES.rates[1],
  ],
};

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

function setTTY(value: boolean | undefined) {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

beforeEach(() => {
  fetchMock.mockReset();
  question.mockReset();
  stdout = '';
  stderr = '';
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => ((stdout += String(s)), true));
  vi.spyOn(process.stderr, 'write').mockImplementation((s) => ((stderr += String(s)), true));
  vi.spyOn(console, 'log').mockImplementation((...a) => void (stdout += a.join(' ') + '\n'));
  vi.spyOn(console, 'error').mockImplementation((...a) => void (stderr += a.join(' ') + '\n'));
  vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw new Exit(code === undefined || code === null ? undefined : Number(code));
  });
  setTTY(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  setTTY(undefined);
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

describe('compute instances rates', () => {
  it('GETs the rate table; --json prints the API body', async () => {
    fetchMock.mockResolvedValueOnce(json(RATES));
    expect(await cli('rates', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'GET', url: '/api/v1/sandboxes/rates', body: undefined }]);
    expect(JSON.parse(stdout)).toEqual(RATES);
  });

  it('prints provider, rate, per, source and fallback columns', async () => {
    fetchMock.mockResolvedValueOnce(json(RATES));
    expect(await cli('rates')).toBe(0);
    const lines = stdout.split('\n');
    const header = lines.find((l) => l.startsWith('PROVIDER'));
    for (const col of ['RATE', 'PER', 'SOURCE', 'FALLBACK']) expect(header).toContain(col);
    expect(lines.find((l) => l.startsWith('beam'))).toMatch(/beam\s+\$0\.5\s+hour\s+organization\s+\$0\.3\/hour \(builtin\)/);
    expect(lines.find((l) => l.startsWith('blaxel'))).toMatch(/blaxel\s+\$0\.0001\s+second\s+platform\s+—/);
  });

  it('a 403 (sandboxes not enabled) exits 1 with the server message', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Sandboxes are not enabled for this organization' }, 403));
    expect(await cli('rates')).toBe(1);
    expect(stderr).toContain('Sandboxes are not enabled for this organization');
  });
});

describe('compute instances rates set', () => {
  it('PUTs <provider> <usd>/<unit> without confirmation and prints the resolved rate', async () => {
    fetchMock.mockResolvedValueOnce(json(RATES));
    expect(await cli('rates', 'set', 'beam', '0.5/hour')).toBe(0);
    expect(requests()).toEqual([
      { method: 'PUT', url: '/api/v1/sandboxes/rates', body: { provider: 'beam', usd: 0.5, per: 'hour' } },
    ]);
    expect(question).not.toHaveBeenCalled();
    expect(stdout).toContain('beam');
    expect(stdout).toContain('$0.5/hr');
    expect(stdout).toContain('organization');
  });

  it('accepts --usd and --per', async () => {
    fetchMock.mockResolvedValueOnce(json(RATES));
    expect(await cli('rates', 'set', 'beam', '--usd', '0.5', '--per', 'hour', '--json')).toBe(0);
    expect(requests()[0].body).toEqual({ provider: 'beam', usd: 0.5, per: 'hour' });
    expect(JSON.parse(stdout)).toEqual(RATES);
  });

  it('allows a zero rate', async () => {
    fetchMock.mockResolvedValueOnce(json(RATES));
    expect(await cli('rates', 'set', 'beam', '0/second')).toBe(0);
    expect(requests()[0].body).toEqual({ provider: 'beam', usd: 0, per: 'second' });
  });

  it('rejects an unknown unit with a usage error and sends nothing', async () => {
    expect(await cli('rates', 'set', 'beam', '0.5/day')).toBe(1);
    expect(stderr).toMatch(/second, minute or hour/);
    expect(requests()).toEqual([]);
  });

  it('rejects a missing rate, a bare amount, and a rate given twice', async () => {
    expect(await cli('rates', 'set', 'beam')).toBe(1);
    expect(await cli('rates', 'set', 'beam', '0.5')).toBe(1);
    expect(await cli('rates', 'set', 'beam', '0.5/hour', '--usd', '0.4')).toBe(1);
    expect(requests()).toEqual([]);
  });

  it('a usage error under --json is an invalid_argument envelope', async () => {
    expect(await cli('rates', 'set', 'beam', 'abc/hour', '--json')).toBe(1);
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'invalid_argument' });
  });

  it('parseRateArg reads both forms', () => {
    expect(parseRateArg('1.25/minute', {})).toEqual({ usd: 1.25, per: 'minute' });
    expect(parseRateArg(undefined, { usd: '2', per: 'second' })).toEqual({ usd: 2, per: 'second' });
    expect(() => parseRateArg('-1/hour', {})).toThrow();
    expect(() => parseRateArg(undefined, { usd: '2' })).toThrow(/--per/);
  });
});

describe('compute instances rates rm', () => {
  it('refuses without -y when stdin is not a TTY, with a hint and no request', async () => {
    expect(await cli('rates', 'rm', 'beam')).toBe(1);
    expect(stderr).toContain('Pass -y to confirm');
    expect(requests()).toEqual([]);
  });

  it('refuses under --json with a confirmation_required envelope', async () => {
    expect(await cli('rates', 'rm', 'beam', '--json')).toBe(1);
    expect(stdout).toBe('');
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'confirmation_required', message: expect.stringContaining('-y') });
    expect(requests()).toEqual([]);
  });

  it('-y DELETEs the override and prints the rate it falls back to', async () => {
    fetchMock.mockResolvedValueOnce(json(RATES_AFTER_RM));
    expect(await cli('rates', 'rm', 'beam', '-y')).toBe(0);
    expect(requests()).toEqual([{ method: 'DELETE', url: '/api/v1/sandboxes/rates?provider=beam', body: undefined }]);
    expect(stdout).toContain('removed the beam rate override');
    expect(stdout).toContain('builtin');
  });

  it('--yes --json prints the API body', async () => {
    fetchMock.mockResolvedValueOnce(json(RATES_AFTER_RM));
    expect(await cli('rates', 'rm', 'beam', '--yes', '--json')).toBe(0);
    expect(JSON.parse(stdout)).toEqual(RATES_AFTER_RM);
  });

  it('prompts on a TTY and removes on "y"', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('y');
    fetchMock.mockResolvedValueOnce(json(RATES_AFTER_RM));
    expect(await cli('rates', 'rm', 'beam')).toBe(0);
    expect(question).toHaveBeenCalledWith(expect.stringContaining('Remove the beam rate override'));
    expect(requests()).toHaveLength(1);
  });

  it('a TTY answer other than y sends nothing and exits 1', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('n');
    expect(await cli('rates', 'rm', 'beam')).toBe(1);
    expect(requests()).toEqual([]);
    expect(stderr).toContain('nothing was changed');
  });

  it('a repeated remove exits 1 with the server not-found error', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'No rate override is set for that provider', code: 'not_found' }, 404));
    expect(await cli('rates', 'rm', 'beam', '-y')).toBe(1);
    expect(stderr).toContain('No rate override is set for that provider');
  });
});

describe('compute instances --help', () => {
  it('lists costs and rates', () => {
    const names = program().commands.find((c) => c.name() === 'instances')!.commands.map((c) => c.name());
    expect(names).toEqual(expect.arrayContaining(['costs', 'rates', 'settings']));
    const rates = program().commands.find((c) => c.name() === 'instances')!.commands.find((c) => c.name() === 'rates')!;
    expect(rates.commands.map((c) => c.name()).sort()).toEqual(['rm', 'set']);
  });
});
