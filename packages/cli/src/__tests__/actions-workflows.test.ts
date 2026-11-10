import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import type { CiRefOnlyWorkflow, CiWorkflowListItem } from '../actions-client.js';

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

const { registerActionsCommands, dispatchBody } = await import('../actions.js');
const { formatWorkflowRow, formatRefOnlyRow, formatWorkflowInputs, matchRefOnly, resolveControlTarget } = await import(
  '../actions-workflows.js'
);

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

const NOW = Date.parse('2026-09-21T12:00:00.000Z');

function workflow(id: string, extra: Partial<CiWorkflowListItem> = {}): CiWorkflowListItem {
  return {
    id,
    repoFullName: 'acme/widgets',
    name: 'CI',
    path: '.github/workflows/ci.yml',
    dispatchable: true,
    refs: ['main'],
    inputs: [],
    schedules: [],
    enabled: true,
    repoEnabled: true,
    userDisabledAt: null,
    providerOrder: null,
    snapshotCap: null,
    lastRun: null,
    ...extra,
  };
}

const CI = workflow('w1');
const NIGHTLY = workflow('w2', {
  name: 'Nightly',
  path: '.github/workflows/nightly.yml',
  enabled: false,
  userDisabledAt: '2026-09-20T00:00:00.000Z',
  providerOrder: ['vercel'],
  snapshotCap: 3,
});
const LEGACY = workflow('w3', {
  repoFullName: 'acme/legacy',
  name: 'Build',
  path: '.github/workflows/build.yml',
  enabled: false,
  repoEnabled: false,
});
const REF_ONLY: CiRefOnlyWorkflow = {
  name: 'Ref only',
  path: '.github/workflows/ref-only.yml',
  dispatchable: true,
  inputs: [{ name: 'target', description: '', type: 'string', required: true, default: '' }],
};

const CONTROLS = {
  repoFullName: 'acme/widgets',
  path: '.github/workflows/nightly.yml',
  enabled: true,
  userDisabledAt: null,
  providerOrder: null,
  snapshotCap: null,
};

const RUN_ID = '11111111-1111-4111-8111-111111111111';

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

describe('compute actions workflows (list)', () => {
  it('GETs the runnable list and prints the v1 body with --json', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflows: [CI] }));
    expect(await cli('workflows', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'GET', url: '/api/v1/actions/workflows', body: undefined }]);
    expect(JSON.parse(stdout)).toEqual({ workflows: [CI] });
  });

  it('--all asks for include=all, narrowed to the repo argument', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflows: [CI, NIGHTLY] }));
    expect(await cli('workflows', 'acme/widgets', '--all', '--json')).toBe(0);
    expect(requests()[0].url).toBe('/api/v1/actions/workflows?repo=acme%2Fwidgets&include=all');
    expect(JSON.parse(stdout).workflows.map((w: CiWorkflowListItem) => w.id)).toEqual(['w1', 'w2']);
  });

  it('--ref lists the ref-only files and keeps refOnly in --json', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflows: [CI], refOnly: [REF_ONLY] }));
    expect(await cli('workflows', 'local/fixture', '--ref', 'feature-ref', '--json')).toBe(0);
    expect(requests()[0].url).toBe('/api/v1/actions/workflows?repo=local%2Ffixture&ref=feature-ref');
    expect(JSON.parse(stdout)).toEqual({ workflows: [CI], refOnly: [REF_ONLY] });
  });

  it('refuses --ref without a repo, sending nothing', async () => {
    expect(await cli('workflows', '--ref', 'feature-ref', '--json')).toBe(1);
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'invalid_argument', message: expect.stringContaining('repo') });
    expect(requests()).toEqual([]);
  });

  it('human output shows each state, the controls and the ref-only rows with their inputs', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflows: [CI, NIGHTLY, LEGACY], refOnly: [REF_ONLY] }));
    expect(await cli('workflows', 'acme/widgets', '--all', '--ref', 'feature-ref')).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines[0]).toContain('enabled');
    expect(lines[0]).toContain('.github/workflows/ci.yml (CI)');
    expect(lines[0]).toContain('order: inherits');
    expect(lines[0]).toContain('snapshots: dynamic');
    expect(lines[1]).toContain('disabled (user)');
    expect(lines[1]).toContain('order: vercel');
    expect(lines[1]).toContain('snapshots: 3');
    expect(lines[2]).toContain('repo disabled');
    expect(stdout).toContain('only on feature-ref');
    const refRow = lines.find((l) => l.includes('ref-only.yml'));
    expect(refRow).toContain('ref-only');
    expect(refRow).toContain('target* (required)');
  });

  it('prints a clear line for an empty list', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflows: [] }));
    expect(await cli('workflows')).toBe(0);
    expect(stdout).toContain('No workflows found.');
  });

  it('renders a server error with its status', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Ref "nope" does not exist on the repository', code: 'bad_request' }, 400));
    expect(await cli('workflows', 'local/fixture', '--ref', 'nope')).toBe(1);
    expect(stderr).toContain('Error (400): Ref "nope" does not exist on the repository');
  });
});

describe('workflow formatting', () => {
  it('formatWorkflowRow shows the latest run as relative time and snapshots off for 0', () => {
    const row = formatWorkflowRow(
      workflow('w1', {
        snapshotCap: 0,
        providerOrder: ['vercel', 'beam'],
        lastRun: { id: RUN_ID, conclusion: 'passed', queuedAt: '2026-09-21T09:00:00.000Z' },
      }),
      NOW,
    );
    expect(row).toContain('order: vercel,beam');
    expect(row).toContain('snapshots: off');
    expect(row).toContain('last: passed 3h ago');
  });

  it('formatWorkflowRow says when a workflow never ran', () => {
    expect(formatWorkflowRow(CI, NOW)).toContain('last: never');
  });

  it('formatWorkflowInputs marks required inputs and shows defaults', () => {
    expect(
      formatWorkflowInputs([
        { name: 'target', description: '', type: 'string', required: true, default: '' },
        { name: 'suite', description: '', type: 'string', required: false, default: 'dax' },
      ]),
    ).toBe('target* (required), suite default=dax');
    expect(formatWorkflowInputs([])).toBe('');
  });

  it('formatRefOnlyRow points a push-only file at --manual', () => {
    expect(formatRefOnlyRow({ ...REF_ONLY, dispatchable: false, inputs: [] })).toContain('--manual');
  });
});

describe('compute actions workflows enable / disable / set', () => {
  it('refuses without -y when stdin is not a TTY, with a hint and no request', async () => {
    expect(await cli('workflows', 'disable', 'acme/widgets', 'ci.yml')).toBe(1);
    expect(stderr).toContain('Pass -y to confirm');
    expect(requests()).toEqual([]);
  });

  it('refuses without -y under --json with a confirmation_required envelope', async () => {
    expect(await cli('workflows', 'enable', 'acme/widgets', 'ci.yml', '--json')).toBe(1);
    expect(stdout).toBe('');
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'confirmation_required' });
    expect(requests()).toEqual([]);
  });

  it('disable -y resolves the workflow against include=all and PATCHes repo + path', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ workflows: [CI, NIGHTLY] }))
      .mockResolvedValueOnce(json({ ...CONTROLS, path: CI.path, enabled: false, userDisabledAt: '2026-09-21T12:00:00.000Z' }));
    expect(await cli('workflows', 'disable', 'acme/widgets', '.github/workflows/ci.yml', '-y', '--json')).toBe(0);
    expect(requests()).toEqual([
      { method: 'GET', url: '/api/v1/actions/workflows?repo=acme%2Fwidgets&include=all', body: undefined },
      {
        method: 'PATCH',
        url: '/api/v1/actions/workflows',
        body: { repoFullName: 'acme/widgets', path: '.github/workflows/ci.yml', enabled: false },
      },
    ]);
    expect(JSON.parse(stdout)).toMatchObject({ enabled: false, path: '.github/workflows/ci.yml' });
  });

  it('enable --yes finds a disabled workflow by name and prints a human summary', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflows: [CI, NIGHTLY] })).mockResolvedValueOnce(json(CONTROLS));
    expect(await cli('workflows', 'enable', 'acme/widgets', 'Nightly', '--yes')).toBe(0);
    expect(requests()[1].body).toEqual({ repoFullName: 'acme/widgets', path: '.github/workflows/nightly.yml', enabled: true });
    expect(stdout).toContain('enabled  acme/widgets  .github/workflows/nightly.yml');
  });

  it('set --inherit-order --dynamic-snapshots sends nulls', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflows: [NIGHTLY] })).mockResolvedValueOnce(json(CONTROLS));
    expect(
      await cli('workflows', 'set', 'acme/widgets', 'nightly.yml', '--inherit-order', '--dynamic-snapshots', '-y', '--json'),
    ).toBe(0);
    expect(requests()[1]).toEqual({
      method: 'PATCH',
      url: '/api/v1/actions/workflows',
      body: { repoFullName: 'acme/widgets', path: '.github/workflows/nightly.yml', providerOrder: null, snapshotCap: null },
    });
    expect(JSON.parse(stdout)).toEqual(CONTROLS);
  });

  it('set --order a,b --snapshot-cap 3 sends the array and the number', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ workflows: [NIGHTLY] }))
      .mockResolvedValueOnce(json({ ...CONTROLS, providerOrder: ['vercel', 'beam'], snapshotCap: 3 }));
    expect(await cli('workflows', 'set', 'acme/widgets', 'w2', '--order', 'vercel, beam', '--snapshot-cap', '3', '-y')).toBe(0);
    expect(requests()[1].body).toEqual({
      repoFullName: 'acme/widgets',
      path: '.github/workflows/nightly.yml',
      providerOrder: ['vercel', 'beam'],
      snapshotCap: 3,
    });
    expect(stdout).toContain('order: vercel,beam');
    expect(stdout).toContain('snapshots: 3');
  });

  it('set refuses missing, conflicting or malformed controls before any request', async () => {
    const cases: [string[], string][] = [
      [[], 'Nothing to change'],
      [['--order', 'vercel', '--inherit-order'], '--inherit-order'],
      [['--snapshot-cap', '2', '--dynamic-snapshots'], '--dynamic-snapshots'],
      [['--snapshot-cap', 'many'], '--snapshot-cap'],
      [['--snapshot-cap', '1.5'], '--snapshot-cap'],
      [['--order', ' , '], '--order'],
    ];
    for (const [flags, message] of cases) {
      stderr = '';
      expect(await cli('workflows', 'set', 'acme/widgets', 'ci.yml', ...flags, '-y', '--json')).toBe(1);
      expect(JSON.parse(stderr).error).toMatchObject({ code: 'invalid_argument', message: expect.stringContaining(message) });
    }
    expect(requests()).toEqual([]);
  });

  it('fails with workflow_not_found listing the repo\'s workflows', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflows: [CI, NIGHTLY] }));
    expect(await cli('workflows', 'disable', 'acme/widgets', 'deploy.yml', '-y', '--json')).toBe(1);
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'workflow_not_found', message: expect.stringContaining('nightly.yml') });
    expect(requests()).toHaveLength(1);
  });

  it('renders a 403 for a member', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ workflows: [CI] }))
      .mockResolvedValueOnce(json({ error: 'Owner or admin access required', code: 'forbidden' }, 403));
    expect(await cli('workflows', 'disable', 'acme/widgets', 'CI', '-y')).toBe(1);
    expect(stderr).toContain('Error (403): Owner or admin access required');
  });

  it('prompts on a TTY and writes on "y"', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('y');
    fetchMock.mockResolvedValueOnce(json({ workflows: [CI] })).mockResolvedValueOnce(json({ ...CONTROLS, enabled: false }));
    expect(await cli('workflows', 'disable', 'acme/widgets', 'CI')).toBe(0);
    expect(question).toHaveBeenCalledWith(expect.stringContaining('Disable workflow "CI" in acme/widgets?'));
    expect(requests()).toHaveLength(2);
  });

  it('a TTY answer other than y sends nothing and exits 1', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('n');
    expect(await cli('workflows', 'enable', 'acme/widgets', 'CI')).toBe(1);
    expect(requests()).toEqual([]);
    expect(stderr).toContain('nothing was changed');
  });

  it('resolveControlTarget refuses a name two workflow files share', () => {
    const twin = workflow('w9', { path: '.github/workflows/ci-2.yml' });
    expect(() => resolveControlTarget([CI, twin], 'acme/widgets', 'CI')).toThrow(/matches 2 workflows/);
    expect(resolveControlTarget([CI, twin], 'acme/widgets', 'ci-2.yml')).toBe('.github/workflows/ci-2.yml');
  });
});

describe('compute actions dispatch: ref-only fallback', () => {
  const dispatched = { runId: RUN_ID, created: true, headSha: 'abcdef1234567890' };
  const org = { organizationId: 'o1', name: 'Acme', slug: 'acme' };

  it('dispatches a file only the ref has by repo + path after a second, ref-scoped GET', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ workflows: [CI] }))
      .mockResolvedValueOnce(json({ workflows: [CI], refOnly: [REF_ONLY] }))
      .mockResolvedValueOnce(json(dispatched, 201))
      .mockResolvedValueOnce(json(org));
    expect(
      await cli('dispatch', 'local/fixture', '--workflow', '.github/workflows/ref-only.yml', '--ref', 'feature-ref', '--inputs', 'target=x', '--json'),
    ).toBe(0);
    expect(requests().slice(0, 3)).toEqual([
      { method: 'GET', url: '/api/v1/actions/workflows?repo=local%2Ffixture', body: undefined },
      { method: 'GET', url: '/api/v1/actions/workflows?repo=local%2Ffixture&ref=feature-ref', body: undefined },
      {
        method: 'POST',
        url: '/api/v1/actions/dispatch',
        body: {
          repoFullName: 'local/fixture',
          workflowPath: '.github/workflows/ref-only.yml',
          ref: 'feature-ref',
          inputs: { target: 'x' },
        },
      },
    ]);
    expect(JSON.parse(stdout)).toMatchObject({ runId: RUN_ID, created: true });
  });

  it('matches a ref-only file by name too', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ workflows: [] }))
      .mockResolvedValueOnce(json({ workflows: [], refOnly: [REF_ONLY] }))
      .mockResolvedValueOnce(json(dispatched, 201))
      .mockResolvedValueOnce(json(org));
    expect(await cli('dispatch', 'local/fixture', '--workflow', 'Ref only', '--ref', 'feature-ref', '--inputs', 'target=x', '--json')).toBe(0);
    expect(requests()[2].body).toMatchObject({ workflowPath: '.github/workflows/ref-only.yml' });
  });

  it('a miss on both lists is workflow_not_found naming the ref-only choices', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ workflows: [CI] }))
      .mockResolvedValueOnce(json({ workflows: [CI], refOnly: [REF_ONLY] }));
    expect(await cli('dispatch', 'local/fixture', '--workflow', 'nope.yml', '--ref', 'feature-ref', '--json')).toBe(1);
    const error = JSON.parse(stderr).error;
    expect(error.code).toBe('workflow_not_found');
    expect(error.message).toContain('.github/workflows/ci.yml (CI)');
    expect(error.message).toContain('only on feature-ref: .github/workflows/ref-only.yml (Ref only)');
    expect(requests()).toHaveLength(2);
  });

  it('without --ref a miss reads only the catalog', async () => {
    fetchMock.mockResolvedValueOnce(json({ workflows: [CI] }));
    expect(await cli('dispatch', 'local/fixture', '--workflow', 'nope.yml', '--json')).toBe(1);
    expect(JSON.parse(stderr).error.code).toBe('workflow_not_found');
    expect(requests()).toHaveLength(1);
  });

  it('a catalog match with --ref never reads the ref-only list', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ workflows: [CI] }))
      .mockResolvedValueOnce(json(dispatched, 201))
      .mockResolvedValueOnce(json(org));
    expect(await cli('dispatch', 'acme/widgets', '--workflow', 'CI', '--ref', 'dev', '--json')).toBe(0);
    expect(requests()[1]).toMatchObject({ method: 'POST', body: { workflowId: 'w1', ref: 'dev' } });
  });

  it('a push-only ref-only file needs --manual', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ workflows: [] }))
      .mockResolvedValueOnce(json({ workflows: [], refOnly: [{ ...REF_ONLY, dispatchable: false, inputs: [] }] }));
    expect(await cli('dispatch', 'local/fixture', '--workflow', REF_ONLY.path, '--ref', 'feature-ref', '--json')).toBe(1);
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'invalid_argument', message: expect.stringContaining('--manual') });
    expect(requests()).toHaveLength(2);
  });

  it('matchRefOnly matches path, then name', () => {
    expect(matchRefOnly([REF_ONLY], '.github/workflows/ref-only.yml')).toBe(REF_ONLY);
    expect(matchRefOnly([REF_ONLY], 'Ref only')).toBe(REF_ONLY);
    expect(matchRefOnly([REF_ONLY], 'ci.yml')).toBeUndefined();
  });

  it('dispatchBody applies the --manual rules to a path-addressed push-only target', () => {
    const target = { repoFullName: 'local/fixture', workflowPath: REF_ONLY.path, dispatchable: false };
    expect(() => dispatchBody(target, { ref: 'feature-ref' })).toThrow('--manual');
    expect(() => dispatchBody(target, { ref: 'feature-ref', manual: true, inputs: ['a=b'] })).toThrow('take no --inputs');
    expect(dispatchBody(target, { ref: 'feature-ref', manual: true })).toEqual({
      repoFullName: 'local/fixture',
      workflowPath: REF_ONLY.path,
      ref: 'feature-ref',
      inputs: {},
      manual: true,
    });
  });
});
