import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import type { CiApiRepo, CiBranch } from '../actions-client.js';

const { fetchMock, question } = vi.hoisted(() => ({
  fetchMock: vi.fn<[URL | string, RequestInit | undefined], Promise<Response>>(),
  question: vi.fn(async (_q: string) => ''),
}));

// Same harness as actions-runs.test.ts: a real ActionsClient on a recorded
// fetch, so each case sees the exact URL, method and body a command sends.
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
const { formatRepoRow, formatBranchRow, formatIn } = await import('../actions-repos.js');

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

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const NOW = Date.parse('2026-09-21T12:00:00.000Z');
const REPO_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '11111111-1111-4111-8111-111111111111';

function repo(extra: Partial<CiApiRepo> = {}): CiApiRepo {
  return {
    repoId: REPO_ID,
    fullName: 'acme/widgets',
    defaultBranch: 'main',
    enabled: true,
    private: false,
    forkPullRequests: false,
    authType: 'github_app',
    cloneUrl: null,
    githubInstallationId: 7,
    workflowPaths: ['.github/workflows/ci.yml', '.github/workflows/nightly.yml'],
    disabledWorkflowCount: 0,
    lastPolledAt: '2026-09-21T11:59:00.000Z',
    lastPollError: null,
    pollIntervalSeconds: 180,
    pollSchedule: 'scheduled',
    nextPollDueAt: '2026-09-21T12:02:00.000Z',
    lastPollErrorAt: null,
    lastPollSucceededAt: '2026-09-21T11:59:00.000Z',
    lastChangeAt: null,
    runs: { total: 5, lastRunState: 'passed', lastRunQueuedAt: '2026-09-21T09:00:00.000Z' },
    ...extra,
  };
}

const MAIN: CiBranch = {
  ref: 'refs/heads/main',
  prNumber: null,
  watched: true,
  runCount: 3,
  latestRunId: RUN_ID,
  lastRunAt: '2026-09-21T10:00:00.000Z',
};
const PR: CiBranch = {
  ref: 'refs/pull/482/head',
  prNumber: 482,
  watched: true,
  runCount: 1,
  latestRunId: RUN_ID,
  lastRunAt: '2026-09-20T12:00:00.000Z',
};
const OLD: CiBranch = {
  ref: 'refs/heads/old',
  prNumber: null,
  watched: false,
  runCount: 0,
  latestRunId: '',
  lastRunAt: '2026-09-01T12:00:00.000Z',
};

const POLLED = {
  fullName: 'local/fixture',
  repoId: REPO_ID,
  polled: true,
  error: null,
  createdRunIds: [RUN_ID],
  repo: repo({ fullName: 'local/fixture', authType: 'token' }),
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
  process.exitCode = undefined;
  try {
    await program().parseAsync(['actions', ...args], { from: 'user' });
    return Number(process.exitCode ?? 0);
  } catch (e) {
    if (e instanceof Exit) return e.code ?? 0;
    throw e;
  } finally {
    process.exitCode = undefined;
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

describe('compute actions repos (list)', () => {
  it('GETs /repos and prints the v1 body with --json', async () => {
    const body = { repos: [repo()] };
    fetchMock.mockResolvedValueOnce(json(body));
    expect(await cli('repos', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'GET', url: '/api/v1/actions/repos', body: undefined }]);
    expect(JSON.parse(stdout)).toEqual(body);
  });

  it('human rows show the run count, the last run and the next poll', async () => {
    fetchMock.mockResolvedValueOnce(json({ repos: [repo({ nextPollDueAt: new Date(Date.now() + 120_000).toISOString() })] }));
    expect(await cli('repos')).toBe(0);
    expect(stdout).toContain('acme/widgets');
    expect(stdout).toContain('5 runs');
    expect(stdout).toContain('last passed');
    expect(stdout).toContain('next poll in');
  });

  it('formatRepoRow: aggregates, poll schedule and fork PRs', () => {
    const row = formatRepoRow(repo({ forkPullRequests: true }), NOW);
    expect(row).toContain('github-app · main · 2 workflows · 5 runs · last passed 3h ago · next poll in 2m');
    expect(row).toContain('fork PRs on');
    expect(formatRepoRow(repo({ runs: { total: 1, lastRunState: null, lastRunQueuedAt: null } }), NOW)).toContain('· 1 run ·');
    expect(formatRepoRow(repo({ pollSchedule: 'never', nextPollDueAt: null }), NOW)).toContain('not polled yet');
    expect(formatRepoRow(repo({ nextPollDueAt: '2026-09-21T11:00:00.000Z' }), NOW)).toContain('poll due');
    const disabled = formatRepoRow(repo({ enabled: false, pollSchedule: 'disabled', nextPollDueAt: null }), NOW);
    expect(disabled).toContain('disabled');
    expect(disabled).not.toContain('poll');
    expect(formatRepoRow(repo({ lastPollError: 'connection refused' }), NOW)).toContain('poll error: connection refused');
  });

  it('formatRepoRow tolerates a platform without run aggregates', () => {
    const older: Partial<CiApiRepo> = repo();
    delete older.runs;
    delete older.pollSchedule;
    delete older.nextPollDueAt;
    const row = formatRepoRow(older as CiApiRepo, NOW);
    expect(row).toContain('2 workflows');
    expect(row).not.toContain('runs');
  });

  it('formatIn reads a future time as a countdown', () => {
    expect(formatIn('2026-09-21T12:00:25.000Z', NOW)).toBe('in 25s');
    expect(formatIn('2026-09-21T12:02:00.000Z', NOW)).toBe('in 2m');
    expect(formatIn('2026-09-21T14:00:00.000Z', NOW)).toBe('in 2h');
  });
});

describe('compute actions branches', () => {
  it('GETs /repos/branches for the repo and prints the v1 body with --json', async () => {
    const body = { repo: 'acme/widgets', defaultBranch: 'main', branches: [MAIN, PR, OLD] };
    fetchMock.mockResolvedValueOnce(json(body));
    expect(await cli('branches', 'acme/widgets', '--json')).toBe(0);
    expect(requests()).toEqual([
      { method: 'GET', url: '/api/v1/actions/repos/branches?repo=acme%2Fwidgets', body: undefined },
    ]);
    expect(JSON.parse(stdout)).toEqual(body);
  });

  it('--search, --archived and --repo-id map to q, archived=1 and repoId', async () => {
    fetchMock.mockResolvedValueOnce(json({ repo: 'acme/widgets', defaultBranch: 'main', branches: [PR] }));
    expect(await cli('branches', 'acme/widgets', '--search', '482', '--archived', '--repo-id', REPO_ID, '--json')).toBe(0);
    expect(requests()[0].url).toBe(
      `/api/v1/actions/repos/branches?repo=acme%2Fwidgets&repoId=${REPO_ID}&q=482&archived=1`,
    );
  });

  it('human output marks the default branch, PRs and history-only refs', async () => {
    fetchMock.mockResolvedValueOnce(json({ repo: 'acme/widgets', defaultBranch: 'main', branches: [MAIN, PR, OLD] }));
    expect(await cli('branches', 'acme/widgets')).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines[0]).toContain('acme/widgets');
    expect(lines[0]).toContain('default: main');
    expect(lines[1]).toContain('refs/heads/main');
    expect(lines[1]).toContain('3 runs');
    expect(stdout).toContain('PR #482');
    expect(lines.find((l) => l.includes('refs/heads/old'))).toContain('history only');
  });

  it('formatBranchRow shows the latest run and its age', () => {
    const row = formatBranchRow(MAIN, NOW);
    expect(row).toContain('watched');
    expect(row).toContain('last 2h ago');
    expect(row).toContain(RUN_ID);
    expect(formatBranchRow(OLD, NOW)).toContain('0 runs');
  });

  it('prints a clear line when nothing matches', async () => {
    fetchMock.mockResolvedValueOnce(json({ repo: 'acme/widgets', defaultBranch: 'main', branches: [] }));
    expect(await cli('branches', 'acme/widgets', '--search', 'zzz')).toBe(0);
    expect(stdout).toContain('No branches found.');
  });

  it('a repo the org lacks exits 1 with the 404', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Repository not found', code: 'not_found' }, 404));
    expect(await cli('branches', 'nope/nope')).toBe(1);
    expect(stderr).toContain('Error (404): Repository not found');
  });
});

describe('compute actions repos poll', () => {
  it('refuses without -y when stdin is not a TTY, with a hint and no request', async () => {
    expect(await cli('repos', 'poll', 'local/fixture')).toBe(1);
    expect(stderr).toContain('Pass -y to confirm');
    expect(requests()).toEqual([]);
  });

  it('-y POSTs /repos/poll and prints the v1 body with --json', async () => {
    fetchMock.mockResolvedValueOnce(json(POLLED));
    expect(await cli('repos', 'poll', 'local/fixture', '-y', '--json')).toBe(0);
    expect(requests()).toEqual([
      { method: 'POST', url: '/api/v1/actions/repos/poll', body: { fullName: 'local/fixture' } },
    ]);
    expect(JSON.parse(stdout)).toEqual(POLLED);
  });

  it('--repo-id names the row; human output counts the started runs', async () => {
    fetchMock.mockResolvedValueOnce(json(POLLED));
    expect(await cli('repos', 'poll', 'local/fixture', '--repo-id', REPO_ID, '--yes')).toBe(0);
    expect(requests()[0].body).toEqual({ fullName: 'local/fixture', repoId: REPO_ID });
    expect(stdout).toContain('polled  local/fixture  1 run started');
  });

  it('a 429 exits 1 with "retry after" and the time', async () => {
    const nextAllowedAt = new Date(Date.now() + 20_000).toISOString();
    fetchMock.mockResolvedValueOnce(
      json(
        {
          error: 'This repository was polled recently',
          code: 'rate_limited',
          hint: 'Retry after details.nextAllowedAt (the Retry-After header, in seconds).',
          details: { nextAllowedAt },
        },
        429,
        { 'retry-after': '20' },
      ),
    );
    expect(await cli('repos', 'poll', 'local/fixture', '-y')).toBe(1);
    expect(stderr).toContain('Error (429): This repository was polled recently; retry after');
    expect(stderr).toContain(nextAllowedAt);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a 429 under --json keeps the envelope, with the time in the message and details', async () => {
    const nextAllowedAt = new Date(Date.now() + 20_000).toISOString();
    fetchMock.mockResolvedValueOnce(
      json({ error: 'This repository was polled recently', code: 'rate_limited', details: { nextAllowedAt } }, 429),
    );
    expect(await cli('repos', 'poll', 'local/fixture', '-y', '--json')).toBe(1);
    expect(stdout).toBe('');
    const error = JSON.parse(stderr).error;
    expect(error).toMatchObject({ httpStatus: 429, details: { nextAllowedAt } });
    expect(error.message).toContain(`retry after ${nextAllowedAt}`);
  });

  it('a poll that failed against the remote prints the error and exits 1', async () => {
    fetchMock.mockResolvedValueOnce(json({ ...POLLED, error: 'connect ECONNREFUSED 127.0.0.1:3212', createdRunIds: [] }));
    expect(await cli('repos', 'poll', 'local/fixture', '-y')).toBe(1);
    expect(stdout).toContain('polled  local/fixture  0 runs started');
    expect(stdout).toContain('poll error: connect ECONNREFUSED 127.0.0.1:3212');
  });

  it('prompts on a TTY and polls on "y"', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('y');
    fetchMock.mockResolvedValueOnce(json(POLLED));
    expect(await cli('repos', 'poll', 'local/fixture')).toBe(0);
    expect(question).toHaveBeenCalledWith(expect.stringContaining('Poll local/fixture now?'));
    expect(requests()).toHaveLength(1);
  });
});

describe('compute actions repos set --fork-prs', () => {
  const patched = (forkPullRequests: boolean) => ({ fullName: 'acme/widgets', forkPullRequests, discovery: null });

  it('refuses without -y when stdin is not a TTY, with a hint and no request', async () => {
    expect(await cli('repos', 'set', 'acme/widgets', '--fork-prs', 'allow')).toBe(1);
    expect(stderr).toContain('Pass -y to confirm');
    expect(requests()).toEqual([]);
  });

  it('refuses without -y under --json with a confirmation_required envelope', async () => {
    expect(await cli('repos', 'set', 'acme/widgets', '--fork-prs', 'refuse', '--json')).toBe(1);
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'confirmation_required' });
    expect(requests()).toEqual([]);
  });

  it('allow -y PATCHes forkPullRequests:true and prints the v1 body with --json', async () => {
    fetchMock.mockResolvedValueOnce(json(patched(true)));
    expect(await cli('repos', 'set', 'acme/widgets', '--fork-prs', 'allow', '-y', '--json')).toBe(0);
    expect(requests()).toEqual([
      { method: 'PATCH', url: '/api/v1/actions/repos', body: { fullName: 'acme/widgets', forkPullRequests: true } },
    ]);
    expect(JSON.parse(stdout)).toEqual(patched(true));
  });

  it('refuse --repo-id sends false and the row id; human output says so', async () => {
    fetchMock.mockResolvedValueOnce(json(patched(false)));
    expect(await cli('repos', 'set', 'acme/widgets', '--fork-prs', 'refuse', '--repo-id', REPO_ID, '-y')).toBe(0);
    expect(requests()[0].body).toEqual({ fullName: 'acme/widgets', forkPullRequests: false, repoId: REPO_ID });
    expect(stdout).toContain('fork PRs refused  acme/widgets');
  });

  it('any other value exits 1 before confirming or calling the API', async () => {
    expect(await cli('repos', 'set', 'acme/widgets', '--fork-prs', 'maybe', '-y', '--json')).toBe(1);
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'invalid_argument', message: expect.stringContaining('allow') });
    expect(requests()).toEqual([]);
  });

  it('renders the 409 for a private repo', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: 'Fork pull requests are not available for private repositories', code: 'conflict' }, 409),
    );
    expect(await cli('repos', 'set', 'acme/private', '--fork-prs', 'allow', '-y')).toBe(1);
    expect(stderr).toContain('Error (409): Fork pull requests are not available for private repositories');
  });

  it('a TTY answer other than y sends nothing and exits 1', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('n');
    expect(await cli('repos', 'set', 'acme/widgets', '--fork-prs', 'allow')).toBe(1);
    expect(question).toHaveBeenCalledWith(expect.stringContaining('acme/widgets'));
    expect(requests()).toEqual([]);
    expect(stderr).toContain('nothing was changed');
  });
});
