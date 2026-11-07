/**
 * `compute actions runs …` — the run list and its views over the v1 run
 * routes: the newest-100 window (`GET /api/v1/actions/runs`), one day's runs
 * page by page (`/runs/day/{day}`), the per-day index (`/run-days`), and
 * archive/unarchive (`POST /runs/archive`). Every view takes the same
 * filters, which map one-to-one onto the v1 query.
 */

import { Command } from 'commander';
import pc from 'picocolors';
import {
  ActionsApiError,
  ActionsCliError,
  type ActionsClient,
  type CiRun,
  type CiRunArchiveResponse,
  type CiRunDay,
  type CiRunsCursor,
  type CiRunsPage,
  type CiWorkflow,
} from './actions-client.js';
import type { CommonOpts } from './actions.js';
import { confirmWrite } from './confirm.js';

/** Injected by `actions.ts`, which imports this module (a runtime import back would be a cycle). */
export interface RunsDeps {
  client: (opts: CommonOpts) => Promise<ActionsClient>;
  output: <T>(opts: CommonOpts, data: T, render: (data: T) => void) => void;
  fail: (error: unknown, opts?: CommonOpts) => never;
  formatRunRow: (run: CiRun) => string;
}

export interface RunFilterOpts {
  status?: string[];
  branch?: string[];
  event?: string[];
  workflow?: string[];
  search?: string;
  archived?: boolean;
  reliability?: boolean;
}

type RunsOpts = CommonOpts & RunFilterOpts & { day?: string; timeZone?: string; cursor?: string; all?: boolean };
type Query = Record<string, string | string[] | undefined>;

/** Selectors starting here are workflow file paths and go to the API as is. */
const WORKFLOW_PATH_PREFIX = '.github/';

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * `--workflow` selectors → workflow file paths, matched against the catalog
 * by path, then name, then file name (`ci.yml`), then id. A name can match
 * workflows in several repos; each distinct path is kept once.
 */
export function resolveWorkflowPaths(workflows: CiWorkflow[], selectors: string[]): string[] {
  const paths: string[] = [];
  for (const selector of selectors) {
    const matchers: ((w: CiWorkflow) => boolean)[] = [
      (w) => w.path === selector,
      (w) => w.name === selector,
      (w) => w.path.split('/').pop() === selector,
      (w) => w.id === selector,
    ];
    let found: CiWorkflow[] = [];
    for (const matches of matchers) {
      found = workflows.filter(matches);
      if (found.length > 0) break;
    }
    if (found.length === 0) {
      const choices = [...new Set(workflows.map((w) => `${w.path} (${w.name})`))].join(', ') || 'none';
      throw new ActionsCliError('workflow_not_found', `No workflow "${selector}". Available: ${choices}`);
    }
    for (const w of found) if (!paths.includes(w.path)) paths.push(w.path);
  }
  return paths;
}

/** The v1 run-filter query for the flags; reads the workflow catalog only to resolve names. */
async function runFilterQuery(c: ActionsClient, repo: string | undefined, opts: RunFilterOpts): Promise<Query> {
  let workflow: string[] | undefined;
  if (opts.workflow && opts.workflow.length > 0) {
    const lookups = opts.workflow.filter((s) => !s.startsWith(WORKFLOW_PATH_PREFIX));
    const catalog =
      lookups.length === 0
        ? []
        : (await c.get<{ workflows: CiWorkflow[] }>('/api/v1/actions/workflows', { repo, include: 'all' })).workflows;
    workflow = [];
    for (const selector of opts.workflow) {
      const paths = selector.startsWith(WORKFLOW_PATH_PREFIX) ? [selector] : resolveWorkflowPaths(catalog, [selector]);
      for (const path of paths) if (!workflow.includes(path)) workflow.push(path);
    }
  }
  return {
    repo,
    status: opts.status,
    branch: opts.branch,
    event: opts.event,
    workflow,
    q: opts.search,
    archived: opts.archived ? 'only' : undefined,
    reliability: opts.reliability ? '1' : undefined,
  };
}

/** `--cursor <startedAt>,<id>`, the form printed after a day page. */
export function parseDayCursor(value: string): CiRunsCursor {
  const comma = value.lastIndexOf(',');
  if (comma <= 0 || comma === value.length - 1) {
    throw new ActionsCliError(
      'invalid_argument',
      `Invalid --cursor "${value}". Expected <startedAt>,<id>, as printed after a page.`,
    );
  }
  return { startedAt: value.slice(0, comma), id: value.slice(comma + 1) };
}

/** One page of a day's runs, or with `all` every page from `cursor` on, merged. */
async function listDayRuns(
  c: ActionsClient,
  day: string,
  query: Query,
  { all, cursor }: { all: boolean; cursor?: CiRunsCursor },
): Promise<CiRunsPage & { nextCursor: CiRunsCursor | null }> {
  const runs: CiRun[] = [];
  const seen = new Set<string>();
  let next: CiRunsCursor | null = cursor ?? null;
  for (;;) {
    const page: CiRunsPage = await c.get<CiRunsPage>(`/api/v1/actions/runs/day/${encodeURIComponent(day)}`, {
      ...query,
      cursorStartedAt: next?.startedAt,
      cursorId: next?.id,
    });
    runs.push(...page.runs);
    next = page.nextCursor ?? null;
    if (!all || next === null) return { runs, nextCursor: next };
    const key = `${next.startedAt},${next.id}`;
    if (seen.has(key)) throw new ActionsCliError('invalid_argument', `The platform repeated cursor ${key}; stopping.`);
    seen.add(key);
  }
}

export function formatRunDays(days: CiRunDay[]): string {
  if (days.length === 0) return 'No runs found.';
  return days.map((d) => `${d.day}  ${plural(d.count, 'run')}`).join('\n');
}

function archiveQuestion(count: number, archived: boolean): string {
  return archived
    ? `Archive ${plural(count, 'run')}? Archived runs leave the run lists and counts; \`compute actions runs unarchive\` restores them.`
    : `Unarchive ${plural(count, 'run')}? They return to the run lists and counts.`;
}

/** The ids a 400 from `POST /runs/archive` reported as unknown or another org's. */
function notFoundIds(error: unknown): string[] {
  if (!(error instanceof ActionsApiError)) return [];
  const ids = error.details?.notFound;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

export function registerRunsCommands(
  actions: Command,
  common: (cmd: Command) => Command,
  deps: RunsDeps,
): void {
  const withFilters = (cmd: Command) =>
    cmd
      .option('--status <status...>', 'filter by conclusion: passed, failed, running, cancelled, none')
      .option('--branch <branch...>', 'filter by branch/ref')
      .option('--event <event...>', 'filter by trigger: push, pull_request, schedule, workflow_dispatch')
      .option('--workflow <path|name...>', 'filter by workflow path, name or file name (e.g. ci.yml)')
      .option('--search <text>', 'search title, ref, SHA prefix, workflow, #run or #PR number')
      .option('--archived', 'archived runs only (hidden by default)')
      .option('--reliability', 'reliability runs only (hidden by default)');

  const printRuns = (runs: CiRun[]) => {
    if (runs.length === 0) {
      console.log('No runs found.');
      return;
    }
    for (const run of runs) console.log(deps.formatRunRow(run));
  };

  const runs = actions
    .command('runs')
    .description('List recent runs (every repo, or one), or one day\'s runs with --day');
  common(
    withFilters(runs.argument('[repo]', 'repository in owner/repo format (default: every repo)'))
      .option('--day <YYYY-MM-DD>', 'list one day\'s runs, page by page, instead of the newest 100')
      .option('--time-zone <iana>', 'with --day: the time zone the day is read in (default: UTC)')
      .option('--cursor <startedAt,id>', 'with --day: continue after this cursor (printed after a page)')
      .option('--all', 'with --day: follow every page'),
  ).action(async (repo: string | undefined, opts: RunsOpts) => {
    try {
      if (opts.day === undefined && (opts.all || opts.timeZone !== undefined || opts.cursor !== undefined)) {
        throw new ActionsCliError('invalid_argument', '--all, --time-zone and --cursor page one day\'s runs: pass --day <YYYY-MM-DD>.');
      }
      const cursor = opts.cursor === undefined ? undefined : parseDayCursor(opts.cursor);
      const c = await deps.client(opts);
      const query = await runFilterQuery(c, repo, opts);
      if (opts.day !== undefined) {
        const page = await listDayRuns(c, opts.day, { ...query, timeZone: opts.timeZone }, { all: opts.all === true, cursor });
        deps.output(opts, page, (p) => {
          printRuns(p.runs);
          if (p.nextCursor) console.log(pc.dim(`more: --cursor ${p.nextCursor.startedAt},${p.nextCursor.id}`));
        });
        return;
      }
      const { runs: list } = await c.get<{ runs: CiRun[] }>('/api/v1/actions/runs', query);
      deps.output(opts, list, printRuns);
    } catch (e) {
      deps.fail(e, opts);
    }
  });

  common(
    withFilters(
      runs
        .command('days')
        .description('How many runs each day holds, newest first (same filters as runs)')
        .argument('[repo]', 'repository in owner/repo format (default: every repo)'),
    ).option('--time-zone <iana>', 'the time zone days are read in (default: UTC)'),
  ).action(async (repo: string | undefined, opts: CommonOpts & RunFilterOpts & { timeZone?: string }) => {
    try {
      const c = await deps.client(opts);
      const query = await runFilterQuery(c, repo, opts);
      const data = await c.get<{ days: CiRunDay[] }>('/api/v1/actions/run-days', { ...query, timeZone: opts.timeZone });
      deps.output(opts, data, (d) => console.log(formatRunDays(d.days)));
    } catch (e) {
      deps.fail(e, opts);
    }
  });

  for (const archived of [true, false]) {
    const verb = archived ? 'archive' : 'unarchive';
    common(
      runs
        .command(verb)
        .description(
          archived
            ? 'Archive runs: hide them from run lists and counts, still reachable by id (owner/admin)'
            : 'Restore archived runs to the run lists (owner/admin)',
        )
        .argument('<run-id...>', 'run IDs')
        .option('-y, --yes', 'skip the confirmation'),
    ).action(async (runIds: string[], opts: CommonOpts & { yes?: boolean }) => {
      try {
        await confirmWrite(archiveQuestion(runIds.length, archived), opts);
        const result = await (await deps.client(opts)).post<CiRunArchiveResponse>('/api/v1/actions/runs/archive', {
          runIds,
          archived,
        });
        deps.output(opts, result, (r) => console.log(`${verb}d ${plural(r.archived, 'run')}`));
      } catch (e) {
        const missing = notFoundIds(e);
        if (!opts.json && missing.length > 0 && e instanceof ActionsApiError) {
          deps.fail(new ActionsApiError(e.status, `${e.message} — not found: ${missing.join(', ')}`, e.body), opts);
        }
        deps.fail(e, opts);
      }
    });
  }
}
