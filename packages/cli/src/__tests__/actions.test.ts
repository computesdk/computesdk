import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatProviderRow,
  formatRunDetail,
  formatRunRow,
  formatVerifyResult,
  matchJob,
  matchWorkflow,
  parseInputs,
} from '../actions.js';
import {
  ActionsClient,
  encodeWatchCursor,
  readSseEvents,
  resolveActionsAuth,
  type CiProviderInfo,
  type CiProviderKeyResponse,
  type CiRun,
  type CiWorkflow,
} from '../actions-client.js';

const WORKFLOWS: CiWorkflow[] = [
  {
    id: 'w-1',
    repoFullName: 'acme/widgets',
    name: 'CI',
    path: '.github/workflows/ci.yml',
    dispatchable: true,
    refs: ['refs/heads/main'],
    inputs: [],
    schedules: [],
  },
  {
    id: 'w-2',
    repoFullName: 'acme/widgets',
    name: 'Nightly Bench',
    path: '.github/workflows/nightly.yml',
    dispatchable: true,
    refs: ['refs/heads/main'],
    inputs: [],
    schedules: [],
  },
];

const RUN: CiRun = {
  id: '8f1c6a3e-0b7d-4f2a-9c8e-1d2b3c4d5e6f',
  repoFullName: 'acme/widgets',
  ref: 'refs/heads/main',
  branchReason: 'default',
  headSha: 'abcdef1234567890',
  event: 'workflow_dispatch',
  prNumber: null,
  runNumber: 42,
  title: 'CI',
  workflowPath: '.github/workflows/ci.yml',
  workflowName: 'CI',
  conclusion: 'failed',
  startedAt: '2026-09-21T12:00:00.000Z',
  durationMs: 95_000,
  supersededByRunId: null,
  concurrencyGroup: null,
  cancellationReason: null,
  logTail: [],
  jobs: [
    {
      id: 'job-1',
      name: 'build',
      needs: [],
      workflowJobId: 'build',
      matrix: null,
      state: 'passed',
      provider: 'e2b',
      region: 'us-west-1',
      sandboxId: 'sb-1',
      placementAttempts: [
        { provider: 'vercel', region: 'iad', error: 'capacity exhausted' },
      ],
      durationMs: 60_000,
      steps: [
        { name: 'checkout', state: 'passed', durationMs: 1_500, exitCode: 0 },
      ],
    },
    {
      id: 'job-2',
      name: 'test',
      needs: ['build'],
      workflowJobId: 'test',
      matrix: { node: '20' },
      state: 'failed',
      provider: 'modal',
      region: null,
      sandboxId: 'sb-2',
      placementAttempts: [],
      durationMs: 35_000,
      steps: [],
    },
  ],
};

describe('parseInputs', () => {
  it('parses key=value pairs', () => {
    expect(parseInputs(['suite=dax', 'count=3'])).toEqual({
      suite: 'dax',
      count: '3',
    });
  });

  it('keeps = in values', () => {
    expect(parseInputs(['query=a=b'])).toEqual({ query: 'a=b' });
  });

  it('rejects entries without =', () => {
    expect(() => parseInputs(['nope'])).toThrow('key=value');
  });

  it('returns empty for undefined', () => {
    expect(parseInputs(undefined)).toEqual({});
  });
});

describe('matchWorkflow', () => {
  it('matches by path', () => {
    expect(matchWorkflow(WORKFLOWS, '.github/workflows/ci.yml')?.id).toBe('w-1');
  });

  it('matches by name', () => {
    expect(matchWorkflow(WORKFLOWS, 'Nightly Bench')?.id).toBe('w-2');
  });

  it('matches by id', () => {
    expect(matchWorkflow(WORKFLOWS, 'w-1')?.name).toBe('CI');
  });

  it('returns undefined for no match', () => {
    expect(matchWorkflow(WORKFLOWS, 'bogus')).toBeUndefined();
  });
});

describe('matchJob', () => {
  it('matches by id and name', () => {
    expect(matchJob(RUN.jobs, 'job-1')?.name).toBe('build');
    expect(matchJob(RUN.jobs, 'test')?.id).toBe('job-2');
  });
});

describe('formatDuration', () => {
  it('formats ms, s, m, h', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(5_000)).toBe('5s');
    expect(formatDuration(95_000)).toBe('1m35s');
    expect(formatDuration(3_900_000)).toBe('1h5m');
    expect(formatDuration(null)).toBe('-');
  });
});

describe('formatRunRow', () => {
  it('includes id, run number, workflow, conclusion, sha', () => {
    const row = formatRunRow(RUN);
    expect(row).toContain(RUN.id);
    expect(row).toContain('#42');
    expect(row).toContain('CI');
    expect(row).toContain('abcdef12');
  });
});

describe('formatRunDetail', () => {
  it('shows placement and placement attempts', () => {
    const detail = formatRunDetail(RUN, 'https://x/y');
    expect(detail).toContain('e2b:us-west-1');
    expect(detail).toContain('placement failed on vercel:iad: capacity exhausted');
    expect(detail).toContain('url: https://x/y');
  });
});

describe('formatProviderRow', () => {
  const base: CiProviderInfo = {
    provider: 'vercel',
    regions: ['iad1', 'sfo1'],
    credential: 'ambient',
    actCapable: true,
    usable: true,
    position: 1,
  };

  it('renders credential, act, regions, and order position', () => {
    const row = formatProviderRow(base);
    expect(row).toContain('vercel');
    expect(row).toContain('ambient');
    expect(row).toContain('act');
    expect(row).toContain('iad1,sfo1');
    expect(row).toContain('order #1');
  });

  it('marks unusable and unordered providers', () => {
    const row = formatProviderRow({
      ...base,
      provider: 'namespace',
      regions: [],
      credential: 'not-configured',
      actCapable: false,
      usable: false,
      position: null,
    });
    expect(row).toContain('namespace');
    expect(row).toContain('not-configured');
    expect(row).toContain('no-act');
    expect(row).toContain('no region choice');
    expect(row).toContain('not in provider order');
  });
});

describe('formatVerifyResult', () => {
  const record: CiProviderKeyResponse['key'] = {
    provider: 'tensorlake',
    keyHint: '…abcd',
    lastCheckedAt: null,
    status: 'connected',
    statusDetail: 'ok',
    actCapable: true,
    credential: 'key',
    fields: [],
  };

  it('marks a passing probe verified and act-capable', () => {
    const line = formatVerifyResult({ key: record, verified: true });
    expect(line).toContain('verified');
    expect(line).toContain('tensorlake');
    expect(line).toContain('act-capable');
  });

  it('marks a failed probe not verified', () => {
    const line = formatVerifyResult({
      key: { ...record, status: 'error', statusDetail: 'provider rejected the key', actCapable: false },
      verified: false,
    });
    expect(line).toContain('not verified');
    expect(line).toContain('provider rejected the key');
    expect(line).not.toContain('act-capable');
  });
});

describe('encodeWatchCursor', () => {
  it('encodes whole-job, step, and runner cursors', () => {
    const job = '8f1c6a3e-0b7d-4f2a-9c8e-1d2b3c4d5e6f';
    expect(encodeWatchCursor('j0', job, null, 0)).toBe(`j0:${job}:-:0`);
    expect(encodeWatchCursor('j0', job, 3, 2048)).toBe(`j0:${job}:3:2048`);
    expect(encodeWatchCursor('j0', job, 'runner', 12)).toBe(`j0:${job}:runner:12`);
  });
});

describe('readSseEvents', () => {
  it('parses data events and skips keepalives', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"a":1}\n\n: keepalive\n\ndata: {"b":'));
        controller.enqueue(encoder.encode('2}\n\n'));
        controller.close();
      },
    });
    const events: unknown[] = [];
    for await (const event of readSseEvents(stream)) events.push(event);
    expect(events).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('ActionsClient', () => {
  const okJson = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200 });

  it('sends bearer auth and query params', async () => {
    const seen: string[] = [];
    const c = new ActionsClient(
      { apiKey: 'bp_test', baseUrl: 'https://example.test' },
      async (input, init) => {
        expect((init?.headers as Record<string, string>).authorization).toBe(
          'Bearer bp_test',
        );
        seen.push(String(input));
        return okJson({ runs: [] });
      },
    );
    await c.get('/api/v1/actions/runs', {
      repo: 'acme/widgets',
      branch: ['main', 'dev'],
      status: undefined,
    });
    expect(seen[0]).toBe(
      'https://example.test/api/v1/actions/runs?repo=acme%2Fwidgets&branch=main&branch=dev',
    );
  });

  it('throws ActionsApiError with the server message', async () => {
    const c = new ActionsClient(
      { apiKey: 'k', baseUrl: 'https://example.test' },
      async () =>
        new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    );
    await expect(c.get('/api/v1/actions/runs/x')).rejects.toMatchObject({
      status: 404,
      message: 'Not found',
    });
  });
});

describe('resolveActionsAuth', () => {
  it('prefers the flag over the env var', () => {
    process.env.COMPUTE_API_KEY = 'env-key';
    expect(resolveActionsAuth({ apiKey: 'flag-key' }).apiKey).toBe('flag-key');
    expect(resolveActionsAuth({}).apiKey).toBe('env-key');
    delete process.env.COMPUTE_API_KEY;
  });

  it('accepts the legacy BENCHMARKS_PLATFORM_* env vars as fallback', () => {
    process.env.BENCHMARKS_PLATFORM_API_KEY = 'legacy-key';
    process.env.BENCHMARKS_PLATFORM_URL = 'https://staging.computesdk.com';
    const auth = resolveActionsAuth({});
    expect(auth.apiKey).toBe('legacy-key');
    expect(auth.baseUrl).toBe('https://staging.computesdk.com');
    delete process.env.BENCHMARKS_PLATFORM_API_KEY;
    delete process.env.BENCHMARKS_PLATFORM_URL;
  });

  it('empty new env vars fall through to the legacy aliases', () => {
    process.env.COMPUTE_API_KEY = '';
    process.env.COMPUTE_PLATFORM_URL = '';
    process.env.BENCHMARKS_PLATFORM_API_KEY = 'legacy-key';
    process.env.BENCHMARKS_PLATFORM_URL = 'https://staging.computesdk.com';
    const auth = resolveActionsAuth({});
    expect(auth.apiKey).toBe('legacy-key');
    expect(auth.baseUrl).toBe('https://staging.computesdk.com');
    delete process.env.COMPUTE_API_KEY;
    delete process.env.COMPUTE_PLATFORM_URL;
    delete process.env.BENCHMARKS_PLATFORM_API_KEY;
    delete process.env.BENCHMARKS_PLATFORM_URL;
  });

  it('strips a trailing slash from base-url', () => {
    expect(
      resolveActionsAuth({ apiKey: 'k', baseUrl: 'http://localhost:3000/' }).baseUrl,
    ).toBe('http://localhost:3000');
  });

  it('throws without a key', () => {
    delete process.env.COMPUTE_API_KEY;
    delete process.env.COMPUTE_PLATFORM_URL;
    delete process.env.BENCHMARKS_PLATFORM_API_KEY;
    delete process.env.BENCHMARKS_PLATFORM_URL;
    expect(() => resolveActionsAuth({})).toThrow('COMPUTE_API_KEY');
  });

  it('refuses to send the key to untrusted hosts', () => {
    expect(() =>
      resolveActionsAuth({ apiKey: 'k', baseUrl: 'https://evil.example.com' }),
    ).toThrow('--allow-untrusted-host');
    expect(
      resolveActionsAuth({ apiKey: 'k', baseUrl: 'https://evil.example.com', allowUntrustedHost: true })
        .baseUrl,
    ).toBe('https://evil.example.com');
    for (const ok of [
      'https://platform.computesdk.com',
      'https://staging.computesdk.com',
      'http://localhost:3000',
      'http://127.0.0.1:8787',
    ]) {
      expect(resolveActionsAuth({ apiKey: 'k', baseUrl: ok }).baseUrl).toBe(ok);
    }
  });
});
