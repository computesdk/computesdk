import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerActionsCommands } from '../actions.js';
import type { CiSchedule } from '../actions-client.js';

const FROM = '2026-11-09T06:00:00.000Z';
const TO = '2026-11-12T06:00:00.000Z';
const CURSOR = '2026-11-09T12:00:00.000Z|00000000-0000-4000-8000-000000000001';
const schedule: CiSchedule = {
  from: FROM, to: TO, timeZone: 'America/Chicago', countsTruncated: false, days: [],
  runs: [{ id: 'run-1', repoFullName: 'acme/widgets', workflowName: 'CI', workflowPath: '.github/workflows/ci.yml', event: 'push', ref: 'refs/heads/main', status: 'completed', conclusion: 'passed', startedAt: null, createdAt: FROM }],
  upcoming: [{ scheduleId: 'schedule-1', repoFullName: 'acme/widgets', workflowName: 'Minute checks', workflowPath: '.github/workflows/minute.yml', cron: '* * * * *', description: 'Every minute', occurrences: ['2026-11-10T06:00:00.000Z'], occurrenceCount: 1440, truncated: true, countTruncated: false }],
  nextCursor: CURSOR,
};

describe('compute actions schedule', () => {
  const fetchMock = vi.fn();
  const run = async (...args: string[]) => {
    const program = new Command().exitOverride();
    registerActionsCommands(program);
    await program.parseAsync(['actions', 'schedule', '--api-key', 'test-key', '--base-url', 'http://localhost:3000', ...args], { from: 'user' });
  };
  const log = vi.fn();
  const stdout = vi.fn((_chunk: string | Uint8Array) => true);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROM));
    fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify(schedule)));
    vi.stubGlobal('fetch', fetchMock);
    log.mockClear();
    stdout.mockClear();
    vi.spyOn(console, 'log').mockImplementation(log);
    vi.spyOn(process.stdout, 'write').mockImplementation(stdout);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  it('defaults to now through seven days later in the local time zone and returns the complete JSON response', async () => {
    await run('--json');
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe('/api/v1/actions/schedule');
    expect(url.searchParams.get('from')).toBe(FROM);
    expect(url.searchParams.get('to')).toBe('2026-11-16T06:00:00.000Z');
    expect(url.searchParams.get('timeZone')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(url.searchParams.has('reliability')).toBe(false);
    expect(JSON.parse(String(stdout.mock.calls[0][0]))).toEqual(schedule);
    expect(log).not.toHaveBeenCalled();
  });

  it('passes all filters, repeated workflows, paging and an explicit time zone', async () => {
    await run('--from', FROM, '--to', TO, '--repo', 'acme/widgets', '--workflow', 'first.yml', '--workflow', 'second.yml', '--event', 'push', '--status', 'failed', '--tz', 'America/Chicago', '--limit', '2', '--cursor', CURSOR, '--reliability');
    const params = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect(Object.fromEntries(params)).toMatchObject({ from: FROM, to: TO, repo: 'acme/widgets', event: 'push', status: 'failed', timeZone: 'America/Chicago', limit: '2', cursor: CURSOR });
    expect(params.getAll('workflow')).toEqual(['first.yml', 'second.yml']);
    expect(params.get('reliability')).toBe('1');
    const text = log.mock.calls.flat().join('\n');
    expect(text).toContain('Every minute');
    expect(text).toContain('+1,439 more');
    expect(text).toContain('push  passed');
    expect(text).toContain('compute actions schedule');
    expect(text).toContain(`--from ${FROM} --to ${TO}`);
    expect(text).toContain(`--cursor '${CURSOR}'`);
    expect(text).toContain('--workflow first.yml --workflow second.yml');
    expect(text).toContain('--limit 2');
    expect(text).toContain('--reliability');
    expect(text).not.toContain('test-key');
  });

  it('uses seven days after an explicit from when to is omitted', async () => {
    await run('--from', '2026-11-01T00:00:00Z');
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('to')).toBe('2026-11-08T00:00:00.000Z');
  });

  it.each([undefined, 'other-org'])('preserves a leading root org, with local override %s, in the next-page command', async (localOrg) => {
    const program = new Command().exitOverride().option('--org <slug>');
    program.hook('preAction', (root) => {
      if (root.opts().org) vi.stubEnv('COMPUTE_ORG', root.opts().org);
    });
    registerActionsCommands(program);
    await program.parseAsync(['--org', 'acme', 'actions', 'schedule', '--api-key', 'test-key',
      '--base-url', 'http://localhost:3000', ...(localOrg ? ['--org', localOrg] : [])], { from: 'user' });
    const hint = log.mock.calls.flat().join('\n').split('\n').find((line) => line.startsWith('compute actions schedule'));
    expect(hint).toContain(`--org ${localOrg ?? 'acme'}`);
    const copied = new Command().exitOverride().option('--org <slug>');
    registerActionsCommands(copied);
    log.mockClear();
    vi.unstubAllEnvs();
    const copiedArgs = String(hint).replace(/^compute /, '').match(/'[^']*'|\S+/g)!.map((arg) => arg.replace(/^'|'$/g, ''));
    await copied.parseAsync([...copiedArgs, '--api-key', 'test-key'], { from: 'user' });
    expect(log.mock.calls.flat().join('\n')).toContain(`--org ${localOrg ?? 'acme'}`);
  });

  it('passes the reliability-only view option with empty JSON results', async () => {
    const empty = { ...schedule, days: [], runs: [], upcoming: [], nextCursor: null };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(empty)));
    await run('--reliability', '--json');
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('reliability')).toBe('1');
    expect(JSON.parse(String(stdout.mock.calls[0][0]))).toEqual(empty);
  });

  it('prints explicit empty states without a pagination hint', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...schedule, runs: [], upcoming: [], nextCursor: null })));
    await run();
    const text = log.mock.calls.flat().join('\n');
    expect(text).toContain('No upcoming fires.');
    expect(text).toContain('No past runs found.');
    expect(text).not.toContain('--cursor');
  });

  it('shows queued/running statuses, terminal-safe labels and incomplete-count warnings', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...schedule, countsTruncated: true, runs: [{ ...schedule.runs[0], workflowName: 'CI\u001b[31m', status: 'queued', conclusion: 'running' }, { ...schedule.runs[0], status: 'running', conclusion: 'running' }] })));
    await run();
    const text = log.mock.calls.flat().join('\n');
    expect(text).toContain('push  queued');
    expect(text).toContain('push  running');
    expect(text).not.toContain('CI\u001b');
    expect(text).toContain('safety limit');
  });

  it('renders API errors as the existing JSON envelope and exits unsuccessfully', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Invalid window' }), { status: 400 }));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(run('--json')).rejects.toThrow('exit');
    expect(JSON.parse(String(stderr.mock.calls[0][0]))).toMatchObject({ ok: false, error: { message: 'Invalid window' } });
  });

  it('rejects invalid timestamps before making a request', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(run('--from', 'invalid', '--json')).rejects.toThrow('exit');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(String(stderr.mock.calls[0][0]))).toMatchObject({ ok: false, error: { code: 'invalid_argument' } });
  });
});
