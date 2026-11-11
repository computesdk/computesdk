import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import type { CiRun, CiWorkflow } from '../actions-client.js';

const { fetchMock, question } = vi.hoisted(() => ({
  fetchMock: vi.fn<[URL | string, RequestInit | undefined], Promise<Response>>(),
  question: vi.fn(async (_q: string) => ''),
}));

// The commands build their client through actions.ts's module-local
// `client()`, so swap in a real ActionsClient on a recorded fetch: the tests
// see the exact URL, method and body each command sends.
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

const { registerActionsCommands } = await import('../actions.js');
const { formatRunDays, parseDayCursor, resolveWorkflowPaths } = await import('../actions-runs.js');

class Exit extends Error {
  constructor(public code: number | undefined) {
    super(`exit ${code}`);
  }
}

function program(): Command {
  const p = new Command().enablePositionalOptions().passThroughOptions().exitOverride();
  registerActionsCommands(p);
  return p;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function run(id: string, extra: Partial<CiRun> = {}): CiRun {
  return {
    id,
    repoFullName: 'acme/widgets',
    ref: 'main',
    branchReason: 'default',
    headSha: 'abcdef1234567890',
    event: 'push',
    prNumber: null,
    runNumber: 7,
    title: `run ${id}`,
    workflowPath: '.github/workflows/ci.yml',
    workflowName: 'CI',
    conclusion: 'passed',
    startedAt: '2026-09-21T12:00:00.000Z',
    durationMs: 1000,
    supersededByRunId: null,
    concurrencyGroup: null,
    cancellationReason: null,
    archivedAt: null,
    jobs: [],
    logTail: [],
    ...extra,
  };
}

const WORKFLOWS: Partial<CiWorkflow>[] = [
  { id: 'w1', repoFullName: 'acme/widgets', name: 'CI', path: '.github/workflows/ci.yml' },
  { id: 'w2', repoFullName: 'acme/gadgets', name: 'CI', path: '.github/workflows/ci.yml' },
  { id: 'w3', repoFullName: 'acme/widgets', name: 'Nightly', path: '.github/workflows/nightly.yml' },
];

const RUN_1 = '11111111-1111-4111-8111-111111111111';
const RUN_2 = '22222222-2222-4222-8222-222222222222';
const MISSING = '00000000-0000-4000-8000-000000000000';

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
    await program().parseAsync(['actions', ...args], { from: 'user' });
    return 0;
  } catch (e) {
    if (e instanceof Exit) return e.code ?? 0;
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

describe('compute actions runs (list)', () => {
  it('lists the org\'s runs without a repo argument', async () => {
    fetchMock.mockResolvedValueOnce(json({ runs: [run(RUN_1), run(RUN_2)] }));
    expect(await cli('runs', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'GET', url: '/api/v1/actions/runs', body: undefined }]);
    expect(JSON.parse(stdout).map((r: CiRun) => r.id)).toEqual([RUN_1, RUN_2]);
  });

  it('keeps the repo argument with --status and --branch', async () => {
    fetchMock.mockResolvedValueOnce(json({ runs: [] }));
    expect(await cli('runs', 'acme/widgets', '--status', 'failed', '--branch', 'main', 'dev')).toBe(0);
    expect(requests()[0].url).toBe('/api/v1/actions/runs?repo=acme%2Fwidgets&status=failed&branch=main&branch=dev');
    expect(stdout).toContain('No runs found.');
  });

  it('maps --event, --search, --archived and --reliability to the v1 query', async () => {
    fetchMock.mockResolvedValueOnce(json({ runs: [] }));
    expect(
      await cli('runs', '--event', 'pull_request', 'push', '--search', 'Archived', '--archived', '--reliability', '--json'),
    ).toBe(0);
    expect(requests()[0].url).toBe(
      '/api/v1/actions/runs?event=pull_request&event=push&q=Archived&archived=only&reliability=1',
    );
  });

  it('marks archived runs in the human list', async () => {
    fetchMock.mockResolvedValueOnce(json({ runs: [run(RUN_1, { archivedAt: '2026-09-22T00:00:00.000Z' })] }));
    expect(await cli('runs', '--archived')).toBe(0);
    expect(stdout).toContain(RUN_1);
    expect(stdout).toContain('archived');
  });

  it('resolves --workflow names to paths through the full workflow catalog', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflows: WORKFLOWS })).mockResolvedValueOnce(json({ runs: [] }));
    expect(await cli('runs', 'acme/widgets', '--workflow', 'CI', 'nightly.yml', '--json')).toBe(0);
    expect(requests().map((r) => r.url)).toEqual([
      '/api/v1/actions/workflows?repo=acme%2Fwidgets&include=all',
      '/api/v1/actions/runs?repo=acme%2Fwidgets&workflow=.github%2Fworkflows%2Fci.yml&workflow=.github%2Fworkflows%2Fnightly.yml',
    ]);
  });

  it('sends a workflow path as is, without reading the catalog', async () => {
    fetchMock.mockResolvedValueOnce(json({ runs: [] }));
    expect(await cli('runs', '--workflow', '.github/workflows/new.yml', '--json')).toBe(0);
    expect(requests().map((r) => r.url)).toEqual(['/api/v1/actions/runs?workflow=.github%2Fworkflows%2Fnew.yml']);
  });

  it('fails with workflow_not_found for an unknown workflow name', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflows: WORKFLOWS }));
    expect(await cli('runs', '--workflow', 'Deploy', '--json')).toBe(1);
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'workflow_not_found' });
    expect(JSON.parse(stderr).error.message).toContain('Nightly');
    expect(requests()).toHaveLength(1);
  });

  it('passes the server\'s 400 for an unknown event through, naming the allowed events', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: 'event must be one of push, pull_request, schedule, workflow_dispatch', code: 'bad_request' }, 400),
    );
    expect(await cli('runs', '--event', 'bogus', '--json')).toBe(1);
    expect(stdout).toBe('');
    expect(JSON.parse(stderr).error).toMatchObject({
      code: 'bad_request',
      httpStatus: 400,
      message: expect.stringContaining('push, pull_request, schedule, workflow_dispatch'),
    });
  });
});

describe('compute actions runs --day', () => {
  const cursor = { startedAt: '2026-09-21T10:00:00.123456Z', id: RUN_1 };

  it('prints one page with its nextCursor', async () => {
    fetchMock.mockResolvedValueOnce(json({ runs: [run(RUN_1)], nextCursor: cursor }));
    expect(await cli('runs', '--day', '2026-09-21', '--time-zone', 'UTC', '--status', 'passed', '--json')).toBe(0);
    expect(requests()[0].url).toBe('/api/v1/actions/runs/day/2026-09-21?status=passed&timeZone=UTC');
    expect(JSON.parse(stdout)).toEqual({ runs: [run(RUN_1)], nextCursor: cursor });
  });

  it('--all follows nextCursor and merges every page', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ runs: [run(RUN_1)], nextCursor: cursor }))
      .mockResolvedValueOnce(json({ runs: [run(RUN_2)], nextCursor: null }));
    expect(await cli('runs', 'acme/widgets', '--day', '2026-09-21', '--all', '--json')).toBe(0);
    expect(requests().map((r) => r.url)).toEqual([
      '/api/v1/actions/runs/day/2026-09-21?repo=acme%2Fwidgets',
      `/api/v1/actions/runs/day/2026-09-21?repo=acme%2Fwidgets&cursorStartedAt=${encodeURIComponent(cursor.startedAt)}&cursorId=${RUN_1}`,
    ]);
    expect(JSON.parse(stdout)).toEqual({ runs: [run(RUN_1), run(RUN_2)], nextCursor: null });
  });

  it('--cursor resumes from a printed cursor', async () => {
    fetchMock.mockResolvedValueOnce(json({ runs: [], nextCursor: null }));
    expect(await cli('runs', '--day', '2026-09-21', '--cursor', `${cursor.startedAt},${cursor.id}`, '--json')).toBe(0);
    expect(requests()[0].url).toBe(
      `/api/v1/actions/runs/day/2026-09-21?cursorStartedAt=${encodeURIComponent(cursor.startedAt)}&cursorId=${RUN_1}`,
    );
  });

  it('human output names the cursor for the next page', async () => {
    fetchMock.mockResolvedValueOnce(json({ runs: [run(RUN_1)], nextCursor: cursor }));
    expect(await cli('runs', '--day', '2026-09-21')).toBe(0);
    expect(stdout).toContain(RUN_1);
    expect(stdout).toContain(`--cursor ${cursor.startedAt},${cursor.id}`);
  });

  it('refuses --all, --time-zone and --cursor without --day', async () => {
    for (const flags of [['--all'], ['--time-zone', 'UTC'], ['--cursor', `${cursor.startedAt},${cursor.id}`]]) {
      stderr = '';
      expect(await cli('runs', ...flags, '--json')).toBe(1);
      expect(JSON.parse(stderr).error).toMatchObject({ code: 'invalid_argument', message: expect.stringContaining('--day') });
    }
    expect(requests()).toEqual([]);
  });

  it('parseDayCursor reads startedAt,id and rejects anything else', () => {
    expect(parseDayCursor(`${cursor.startedAt},${cursor.id}`)).toEqual(cursor);
    expect(() => parseDayCursor('nope')).toThrow('--cursor');
  });
});

describe('compute actions runs days', () => {
  it('GETs run-days with the same filters and prints {days}', async () => {
    const days = [{ day: '2026-09-21', count: 3 }, { day: '2026-09-20', count: 1 }];
    fetchMock.mockResolvedValueOnce(json({ days }));
    expect(await cli('runs', 'days', '--status', 'passed', '--archived', '--time-zone', 'Europe/Berlin', '--json')).toBe(0);
    expect(requests()[0].url).toBe('/api/v1/actions/run-days?status=passed&archived=only&timeZone=Europe%2FBerlin');
    expect(JSON.parse(stdout)).toEqual({ days });
  });

  it('takes a repo and prints one line per day', async () => {
    fetchMock.mockResolvedValueOnce(json({ days: [{ day: '2026-09-21', count: 1 }] }));
    expect(await cli('runs', 'days', 'acme/widgets')).toBe(0);
    expect(requests()[0].url).toBe('/api/v1/actions/run-days?repo=acme%2Fwidgets');
    expect(stdout).toContain('2026-09-21  1 run');
  });

  it('formatRunDays pluralizes and reports an empty index', () => {
    expect(formatRunDays([{ day: '2026-09-21', count: 2 }])).toBe('2026-09-21  2 runs');
    expect(formatRunDays([])).toBe('No runs found.');
  });
});

describe('compute actions runs archive / unarchive', () => {
  const archivedAt = '2026-09-22T08:00:00.000Z';

  it('refuses without -y when stdin is not a TTY, with a hint and no request', async () => {
    expect(await cli('runs', 'archive', RUN_1)).toBe(1);
    expect(stderr).toContain('Pass -y to confirm');
    expect(requests()).toEqual([]);
  });

  it('refuses without -y under --json with a confirmation_required envelope', async () => {
    expect(await cli('runs', 'unarchive', RUN_1, '--json')).toBe(1);
    expect(stdout).toBe('');
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'confirmation_required', message: expect.stringContaining('-y') });
    expect(requests()).toEqual([]);
  });

  it('-y archives every id and --json prints the API result', async () => {
    fetchMock.mockResolvedValueOnce(json({ archived: 2, archivedAt }));
    expect(await cli('runs', 'archive', RUN_1, RUN_2, '-y', '--json')).toBe(0);
    expect(requests()).toEqual([
      { method: 'POST', url: '/api/v1/actions/runs/archive', body: { runIds: [RUN_1, RUN_2], archived: true } },
    ]);
    expect(JSON.parse(stdout)).toEqual({ archived: 2, archivedAt });
  });

  it('--yes unarchives and prints a human summary', async () => {
    fetchMock.mockResolvedValueOnce(json({ archived: 1, archivedAt: null }));
    expect(await cli('runs', 'unarchive', RUN_1, '--yes')).toBe(0);
    expect(requests()[0].body).toEqual({ runIds: [RUN_1], archived: false });
    expect(stdout).toContain('unarchived 1 run');
  });

  it('prompts on a TTY and archives on "y"', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('y');
    fetchMock.mockResolvedValueOnce(json({ archived: 1, archivedAt }));
    expect(await cli('runs', 'archive', RUN_1)).toBe(0);
    expect(question).toHaveBeenCalledWith(expect.stringContaining('Archive 1 run'));
    expect(requests()).toHaveLength(1);
    expect(stdout).toContain('archived 1 run');
  });

  it('a TTY answer other than y sends nothing and exits 1', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('');
    expect(await cli('runs', 'archive', RUN_1, RUN_2)).toBe(1);
    expect(question).toHaveBeenCalledWith(expect.stringContaining('Archive 2 runs'));
    expect(requests()).toEqual([]);
    expect(stderr).toContain('nothing was changed');
  });

  it('prints the ids the server could not find and exits 1', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: 'One or more runs could not be archived', code: 'bad_request', details: { notFound: [MISSING] } }, 400),
    );
    expect(await cli('runs', 'archive', RUN_1, MISSING, '-y')).toBe(1);
    expect(stderr).toContain('One or more runs could not be archived');
    expect(stderr).toContain(`not found: ${MISSING}`);
  });

  it('--json keeps the notFound ids in the error envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: 'One or more runs could not be archived', details: { notFound: [MISSING] } }, 400),
    );
    expect(await cli('runs', 'archive', MISSING, '-y', '--json')).toBe(1);
    expect(JSON.parse(stderr).error).toMatchObject({ httpStatus: 400, details: { notFound: [MISSING] } });
  });

  it('renders a 403 for a member', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Owner or admin access required', code: 'forbidden' }, 403));
    expect(await cli('runs', 'archive', RUN_1, '-y')).toBe(1);
    expect(stderr).toContain('Error (403): Owner or admin access required');
  });

  it('requires at least one run id', async () => {
    await expect(program().parseAsync(['actions', 'runs', 'archive', '-y'], { from: 'user' })).rejects.toThrow(
      /missing required argument/,
    );
  });
});

describe('resolveWorkflowPaths', () => {
  const catalog = WORKFLOWS as CiWorkflow[];

  it('matches by path, name, file name or id and drops duplicates', () => {
    expect(resolveWorkflowPaths(catalog, ['CI'])).toEqual(['.github/workflows/ci.yml']);
    expect(resolveWorkflowPaths(catalog, ['w3', 'ci.yml', '.github/workflows/ci.yml'])).toEqual([
      '.github/workflows/nightly.yml',
      '.github/workflows/ci.yml',
    ]);
  });

  it('throws workflow_not_found listing the choices', () => {
    expect(() => resolveWorkflowPaths(catalog, ['Deploy'])).toThrow(/No workflow "Deploy".*Nightly/);
  });
});
