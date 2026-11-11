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

const { registerByokCommands, parseRateArgs, keyBody } = await import('../byok.js');

class Exit extends Error {
  constructor(public code: number | undefined) {
    super(`exit ${code}`);
  }
}

function program(): Command {
  const p = new Command().enablePositionalOptions().exitOverride();
  registerByokCommands(p);
  return p;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const rate = (perHour: number) => ({
  usd: perHour,
  per: 'hour' as const,
  rateUsd: { perSecond: perHour / 3600, perMinute: perHour / 60, perHour },
});

const KEY = {
  provider: 'blaxel',
  keyHint: '…abcd',
  lastCheckedAt: '2026-11-11T17:00:00.000Z',
  status: 'connected' as const,
  statusDetail: null,
  actCapable: false,
  credential: 'key' as const,
  fields: [],
};

const BLAXEL = { provider: 'blaxel', regions: [], key: KEY, rate: rate(0.1), customRate: null, platformRate: rate(0.1) };
const BEAM = {
  provider: 'beam',
  regions: ['us-east'],
  key: { ...KEY, provider: 'beam', keyHint: null, status: 'unconfigured' as const },
  rate: rate(0.05),
  customRate: rate(0.05),
  platformRate: rate(0.2),
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
    await program().parseAsync(['byok', ...args], { from: 'user' });
    return 0;
  } catch (e) {
    if (e instanceof Exit) return e.code ?? 0;
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

describe('compute byok list', () => {
  it('GETs /api/v1/providers, bare or as list', async () => {
    fetchMock.mockResolvedValue(json({ providers: [BLAXEL, BEAM] }));
    expect(await cli('--json')).toBe(0);
    expect(await cli('list', '--json')).toBe(0);
    expect(requests().map((r) => r.url)).toEqual(['/api/v1/providers', '/api/v1/providers']);
  });

  it('shows key state and which rate costs report at, never a key', async () => {
    fetchMock.mockResolvedValueOnce(json({ providers: [BLAXEL, BEAM] }));
    expect(await cli('list')).toBe(0);
    const lines = stdout.split('\n');
    expect(lines.find((l) => l.includes('blaxel'))).toMatch(/connected.*…abcd.*\$0\.1\/hr.*platform/);
    expect(lines.find((l) => l.includes('beam'))).toMatch(/no key.*\$0\.05\/hr.*custom/);
  });
});

describe('compute byok keys', () => {
  it('configure PUTs the key to the providers route and --verify tests it there', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ key: { ...KEY, status: 'unconfigured' } }))
      .mockResolvedValueOnce(json({ key: KEY, verified: true }));
    expect(await cli('configure', 'blaxel', '--field', 'apiKey=k', 'workspace=w', '--verify', '--json')).toBe(0);
    expect(requests()).toEqual([
      { method: 'PUT', url: '/api/v1/providers/blaxel/key', body: { fields: { apiKey: 'k', workspace: 'w' } } },
      { method: 'POST', url: '/api/v1/providers/blaxel/verify', body: {} },
    ]);
  });

  it('verify exits 1 when the test fails', async () => {
    fetchMock.mockResolvedValueOnce(json({ key: { ...KEY, status: 'error', statusDetail: 'bad key' }, verified: false }));
    await cli('verify', 'blaxel');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    expect(stdout).toContain('not verified');
  });

  it('remove needs -y off a terminal, then DELETEs the key', async () => {
    expect(await cli('remove', 'blaxel', '--json')).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json({ provider: 'blaxel', deleted: true }));
    expect(await cli('rm', 'blaxel', '-y', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'DELETE', url: '/api/v1/providers/blaxel/key', body: undefined }]);
  });

  it('keyBody takes --key or --field, not both', () => {
    expect(keyBody({ key: 'k' })).toEqual({ key: 'k' });
    expect(() => keyBody({ key: 'k', field: ['a=b'] })).toThrow(/either/);
    expect(() => keyBody({})).toThrow(/--key/);
  });
});

describe('compute byok rate', () => {
  it('set PUTs usd and per (hour by default) and says billing is unchanged', async () => {
    fetchMock.mockResolvedValueOnce(json({ provider: BEAM }));
    expect(await cli('rate', 'set', 'beam', '0.05')).toBe(0);
    expect(requests()).toEqual([{ method: 'PUT', url: '/api/v1/providers/beam/rate', body: { usd: 0.05, per: 'hour' } }]);
    expect(stdout).toContain('billing is unchanged');
  });

  it('clear DELETEs the custom rate', async () => {
    fetchMock.mockResolvedValueOnce(json({ provider: { ...BEAM, customRate: null, rate: rate(0.2) } }));
    expect(await cli('rate', 'clear', 'beam')).toBe(0);
    expect(requests()).toEqual([{ method: 'DELETE', url: '/api/v1/providers/beam/rate', body: undefined }]);
    expect(stdout).toContain('platform rate');
  });

  it('parseRateArgs refuses what the route would', () => {
    expect(parseRateArgs('0.5', 'minute')).toEqual({ usd: 0.5, per: 'minute' });
    expect(() => parseRateArgs('-1', undefined)).toThrow();
    expect(() => parseRateArgs('2000', undefined)).toThrow();
    expect(() => parseRateArgs('1', 'day')).toThrow(/--per/);
  });
});
