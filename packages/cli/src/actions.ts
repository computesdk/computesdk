/** A file/dir name reduced to a safe basename — strips `..` and separators. */
function sanitizePathPart(name: string): string {
  const base = basename(name);
  if (base === '' || base === '.' || base === '..') return 'artifact';
  return base;
}

/**
 * `compute actions` — drive the benchmarks-platform Actions API end-to-end:
 * dispatch workflows, watch runs, inspect run context, stream logs,
 * manage artifacts.
 *
 * Auth: COMPUTE_API_KEY (or --api-key); --base-url overrides the
 * https://platform.computesdk.com default. Every subcommand takes --json for
 * machine-readable output.
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { mkdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import {
  ActionsApiError,
  ActionsClient,
  encodeWatchCursor,
  resolveActionsAuth,
  type CiArtifactListItem,
  type CiJob,
  type CiLogSlice,
  type CiProviderInfo,
  type CiProviderKeyResponse,
  type CiProvidersResponse,
  type CiRun,
  type CiRunHistory,
  type CiRunInspection,
  type CiWorkflow,
} from './actions-client.js';

/** The jobs inside a `/state` response — a subset of CiJob, no name/steps. */
interface CiLiveStateJob {
  id: string;
  state: CiJob['state'];
  provider: string | null;
  region: string | null;
  sandboxId: string | null;
  placementAttempts: CiJob['placementAttempts'];
}

type JsonOpts = { json?: boolean };

interface CommonOpts extends JsonOpts {
  apiKey?: string;
  baseUrl?: string;
  allowUntrustedHost?: boolean;
}

function client(opts: CommonOpts): ActionsClient {
  return new ActionsClient(resolveActionsAuth(opts));
}

/** Print `data` as JSON when --json was passed; otherwise call `render`. */
function output<T>(opts: JsonOpts, data: T, render: (data: T) => void): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    render(data);
  }
}

/** The run's job list: full detail when the runs detail route exists, else the
 * live-state route (which predates it and lists jobs without names). */
async function listRunJobs(c: ActionsClient, runId: string): Promise<CiJob[]> {
  try {
    const run = await c.get<CiRun>(`/api/v1/actions/runs/${runId}`);
    return run.jobs;
  } catch (e) {
    if (!(e instanceof ActionsApiError) || e.status !== 404) throw e;
  }
  const state = await c.get<{ jobs: CiLiveStateJob[] }>(`/api/v1/actions/runs/${runId}/state`);
  return state.jobs.map((j) => ({
    id: j.id,
    name: j.id.slice(0, 8), // the live-state route does not carry job names
    needs: [],
    workflowJobId: null,
    matrix: null,
    state: j.state,
    provider: j.provider,
    region: j.region,
    sandboxId: j.sandboxId,
    placementAttempts: j.placementAttempts,
    durationMs: null,
    steps: [],
  }));
}

function fail(error: unknown): never {
  if (error instanceof ActionsApiError) {
    console.error(pc.red(`Error (${error.status}): ${error.message}`));
  } else {
    console.error(pc.red(`Error: ${(error as Error).message}`));
  }
  process.exit(1);
}

// ─── Formatting (pure, exported for tests) ──────────────────────────────────

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 8);
}

export function conclusionLabel(conclusion: string): string {
  switch (conclusion) {
    case 'passed': return pc.green('passed');
    case 'failed': return pc.red('failed');
    case 'running': return pc.yellow('running');
    case 'cancelled': return pc.gray('cancelled');
    case 'none': return pc.yellow('queued');
    default: return conclusion;
  }
}

export function formatRunRow(run: CiRun): string {
  const num = run.runNumber === null ? '-' : `#${run.runNumber}`;
  return [
    run.id,
    pc.dim(num),
    run.workflowName || run.workflowPath,
    conclusionLabel(run.conclusion),
    pc.dim(`${run.repoFullName}@${run.ref}`),
    shortSha(run.headSha),
    formatDuration(run.durationMs),
    run.startedAt,
  ].join('  ');
}

export function formatRunDetail(run: CiRun, runUrl?: string): string {
  const lines: string[] = [];
  lines.push(`${pc.bold(run.workflowName || run.workflowPath)}  ${conclusionLabel(run.conclusion)}`);
  lines.push(pc.dim(`run ${run.id}${run.runNumber === null ? '' : `  #${run.runNumber}`}`));
  lines.push(`${run.repoFullName} @ ${run.ref}  ${shortSha(run.headSha)}  ${run.event}${run.prNumber ? `  PR #${run.prNumber}` : ''}`);
  lines.push(`title: ${run.title}`);
  lines.push(`started: ${run.startedAt}  duration: ${formatDuration(run.durationMs)}`);
  if (run.cancellationReason) lines.push(`cancelled: ${run.cancellationReason}`);
  if (run.providerOverride) lines.push(`dispatched to: ${run.providerOverride}`);
  if (run.supersededByRunId) lines.push(`superseded by: ${run.supersededByRunId}`);
  if (runUrl) lines.push(`url: ${runUrl}`);
  if (run.jobs.length > 0) {
    lines.push('');
    lines.push(pc.bold('jobs'));
    for (const job of run.jobs) {
      const placement = job.provider
        ? `${job.provider}${job.region ? `:${job.region}` : ''}`
        : '-';
      lines.push(`  ${job.id}  ${job.name}  ${conclusionLabel(job.state)}  ${placement}  ${formatDuration(job.durationMs)}`);
      for (const attempt of job.placementAttempts) {
        lines.push(pc.dim(`    placement failed on ${attempt.provider}${attempt.region ? `:${attempt.region}` : ''}: ${attempt.error}`));
      }
      for (const step of job.steps) {
        const exit = step.exitCode === null ? '' : ` (exit ${step.exitCode})`;
        lines.push(pc.dim(`    ${step.name}  ${step.state}${exit}  ${formatDuration(step.durationMs)}`));
      }
    }
  }
  return lines.join('\n');
}

/** `compute actions inspect` — the run plus everything that shaped it. */
export function formatRunInspection(run: CiRunInspection): string {
  const lines: string[] = [];
  lines.push(`${pc.bold('run')}  ${conclusionLabel(run.conclusion)}${run.runNumber === null ? '' : `  #${run.runNumber}`}`);
  lines.push(pc.dim(run.id));
  lines.push(`${safeTerm(run.ref)}  ${shortSha(run.headSha)}  ${safeTerm(run.event)}`);
  lines.push(`queued: ${run.queuedAt}  started: ${run.startedAt}  finished: ${run.finishedAt}`);
  if (run.cancellationReason) lines.push(`cancelled: ${run.cancellationReason}`);
  if (run.supersededByRunId) lines.push(`superseded by: ${run.supersededByRunId}`);
  if (run.blockedReason) lines.push(pc.red(`blocked: ${safeTerm(run.blockedReason)}`));
  if (run.concurrencyGroup) lines.push(`concurrency: ${safeTerm(run.concurrencyGroup)}`);
  if (run.providerOverride) lines.push(`dispatched to: ${safeTerm(run.providerOverride)}`);
  if (run.definitionStale) {
    const parsed = run.workflowParsedFromSha ? shortSha(run.workflowParsedFromSha) : 'unknown';
    lines.push(pc.yellow(`definition: stored parse is from ${parsed}, not this head — context may be newer than the run`));
  }
  if (run.dispatchInputs && Object.keys(run.dispatchInputs).length > 0) {
    lines.push(`inputs: ${Object.entries(run.dispatchInputs).map(([k, v]) => `${safeTerm(k)}=${safeTerm(v)}`).join('  ')}`);
  }
  if (run.secrets) {
    const names = run.secrets.names.length > 0 ? run.secrets.names.map(safeTerm).join(', ') : 'none';
    lines.push(`secrets (${run.secrets.access}${run.secrets.env ? ', exported to env' : ''}): ${names}`);
  }
  if (run.caches.length > 0) {
    lines.push('');
    lines.push(pc.bold('caches'));
    for (const cache of run.caches) {
      const action = [cache.restoredAt ? 'restored' : null, cache.savedAt ? 'saved' : null]
        .filter(Boolean)
        .join('+');
      lines.push(`  ${safeTerm(cache.key)}  ${pc.dim(`${action}  ${safeTerm(cache.scopeRef)}  ${cache.sizeBytes}B`)}`);
    }
  }
  if (run.jobs.length > 0) {
    lines.push('');
    lines.push(pc.bold('jobs'));
    for (const job of run.jobs) {
      const placement = job.provider
        ? `${safeTerm(job.provider)}${job.region ? `:${safeTerm(job.region)}` : ''}`
        : '-';
      lines.push(`  ${safeTerm(job.name)}  ${conclusionLabel(job.state)}  ${placement}`);
      lines.push(pc.dim(`    ${job.id}`));
      if (job.runsOn.length > 0 || job.resolvedRunsOn !== null) {
        const resolved =
          job.resolvedRunsOn !== null && job.resolvedRunsOn.join(',') !== job.runsOn.join(',')
            ? ` → ${job.resolvedRunsOn.map(safeTerm).join(', ')}`
            : '';
        lines.push(`    runs-on: ${job.runsOn.map(safeTerm).join(', ') || '(none)'}${resolved}`);
      }
      if (job.runsOnHasExpression) lines.push(pc.dim('    runs-on resolves at runtime (expression)'));
      if (job.container) lines.push(`    container: ${safeTerm(job.container)}`);
      if (job.runnerImage) lines.push(`    image: ${safeTerm(job.runnerImage)}`);
      if (job.placementHint) {
        lines.push(`    pinned: ${safeTerm(job.placementHint.label)}`);
      }
      if (job.concurrencyGroup) {
        lines.push(`    concurrency: ${safeTerm(job.concurrencyGroup)}${job.concurrencyCancelInProgress ? ' (cancel-in-progress)' : ''}`);
      }
      const overrides = [
        job.timeoutMinutes !== null ? `timeout ${job.timeoutMinutes}m` : null,
        job.fetchDepth !== null ? `fetch-depth ${job.fetchDepth}` : null,
      ].filter(Boolean);
      if (overrides.length > 0) lines.push(`    ${overrides.join('  ')}`);
      if (job.matrix) {
        lines.push(`    matrix: ${Object.entries(job.matrix).map(([k, v]) => `${safeTerm(k)}=${safeTerm(v)}`).join(' ')}`);
      }
      if (job.failureReason) lines.push(pc.red(`    failed: ${safeTerm(job.failureReason)}`));
      for (const attempt of job.placementAttempts) {
        lines.push(pc.dim(`    placement failed on ${safeTerm(attempt.provider)}${attempt.region ? `:${safeTerm(attempt.region)}` : ''}: ${safeTerm(attempt.error)}`));
      }
    }
  }
  return lines.join('\n');
}

// ─── Parsing helpers (pure, exported for tests) ─────────────────────────────

/** `--inputs k=v` pairs → a dispatch inputs object. `k=v` with no `=` is an error. */
export function parseInputs(pairs: string[] | undefined): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const pair of pairs ?? []) {
    const eq = pair.indexOf('=');
    if (eq === -1) {
      throw new Error(`Invalid --inputs entry "${pair}". Expected key=value.`);
    }
    inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return inputs;
}

/** Match `--workflow` to a workflow by path first, then by name. */
export function matchWorkflow(
  workflows: CiWorkflow[],
  selector: string,
): CiWorkflow | undefined {
  return (
    workflows.find((w) => w.path === selector) ??
    workflows.find((w) => w.name === selector) ??
    workflows.find((w) => w.id === selector)
  );
}

/** Match `--job` to a run's job by id, then by name. */
export function matchJob(jobs: CiJob[], selector: string): CiJob | undefined {
  return jobs.find((j) => j.id === selector) ?? jobs.find((j) => j.name === selector);
}

// ─── Logs ───────────────────────────────────────────────────────────────────

async function readWholeJobLog(client: ActionsClient, jobId: string, step?: string): Promise<CiLogSlice> {
  const segments: CiLogSlice['segments'] = [];
  let offset = 0;
  let slice: CiLogSlice;
  do {
    slice = await client.get<CiLogSlice>(`/api/v1/actions/jobs/${jobId}/logs`, {
      offset: String(offset),
      step,
    });
    segments.push(...slice.segments);
    offset = slice.nextOffset;
  } while (slice.truncated);
  return { ...slice, segments };
}

/** Follow one job's log over the SSE `follow=1` slice stream, resuming on reconnect. */
async function* followJobLog(client: ActionsClient, jobId: string, step?: string): AsyncGenerator<CiLogSlice> {
  let offset = 0;
  for (;;) {
    let terminal = false;
    for await (const raw of client.sse(`/api/v1/actions/jobs/${jobId}/logs`, {
      offset: String(offset),
      follow: '1',
      step,
    })) {
      const slice = raw as CiLogSlice;
      offset = slice.nextOffset;
      if (slice.segments.length > 0 || slice.state !== 'running') yield slice;
      if (slice.state !== 'running' && slice.state !== 'pending' && !slice.truncated) {
        terminal = true;
      }
    }
    if (terminal) return;
    // The connection ended (server-side ceiling or a drop): resume from the
    // offset we hold — resumable cursors make this a continuation, not a replay.
  }
}

/** `--step` CLI value → the watch-cursor step field. */
export function parseStep(step: string | undefined): number | 'runner' | null {
  if (step === undefined) return null;
  if (step === 'runner') return 'runner';
  const n = Number(step);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Invalid --step "${step}". Expected a step ordinal or "runner".`);
  }
  return n;
}

/** Follow a run's logs across jobs via the multiplexed run stream. */
async function* followRunLogs(
  client: ActionsClient,
  runId: string,
  jobs: CiJob[],
  step?: string,
): AsyncGenerator<{ job: CiJob; slice: CiLogSlice }> {
  const cursorStep = parseStep(step);
  const offsets = new Map<string, number>(jobs.map((j) => [j.id, 0]));
  const byCursor = new Map<string, CiJob>(jobs.map((j, i) => [`j${i}`, j]));
  for (;;) {
    let done = false;
    const watch = jobs.map((j, i) =>
      encodeWatchCursor(`j${i}`, j.id, cursorStep, offsets.get(j.id) ?? 0),
    );
    for await (const raw of client.sse(`/api/v1/actions/runs/${runId}/stream`, { watch })) {
      const msg = raw as
        | { type: 'state'; state: unknown }
        | { type: 'log'; cursor: string; slice: CiLogSlice }
        | { type: 'done' }
        | { type: 'reconnect' };
      if (msg.type === 'log') {
        const job = byCursor.get(msg.cursor);
        if (job) {
          offsets.set(msg.slice.jobId, msg.slice.nextOffset);
          yield { job, slice: msg.slice };
        }
      } else if (msg.type === 'done') {
        done = true;
        break;
      } else if (msg.type === 'reconnect') {
        break;
      }
    }
    if (done) return;
    // Both an explicit `reconnect` event and an unexpected EOF resume from the
    // offsets we hold; back off briefly so a repeatedly-closing server doesn't
    // spin the loop.
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// Job and step names come from workflow files — potentially attacker-controlled
// in a PR context — so strip control characters before writing to the terminal.
function safeTerm(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F\u007F-\u009F]/g, '�');
}

export function formatRunHistory(history: CiRunHistory): string {
  const lines: string[] = [];
  const parts = (Object.entries(history.conclusions) as [string, number][])
    .map(([c, n]) => `${n} ${c}`)
    .join(', ');
  lines.push(`last ${history.runCount} runs: ${parts || 'none'}`);
  if (history.jobs.length > 0) {
    lines.push('');
    lines.push(pc.bold('jobs'));
    for (const job of history.jobs) {
      const rate = job.runs > 0 ? Math.round((job.failedRuns / job.runs) * 100) : 0;
      const platform = job.failedBeforeSteps > 0 ? pc.dim(`  (${job.failedBeforeSteps} failed before steps)`) : '';
      const count = `${job.failedRuns}/${job.runs} runs failed`;
      const label = job.failedRuns > 0 ? pc.red(count) : pc.green(count);
      lines.push(`  ${safeTerm(job.job)}  ${label}  ${rate}%${platform}`);
      for (const step of job.steps) {
        lines.push(pc.dim(`    step "${safeTerm(step.step)}" failed in ${step.failedRuns} run${step.failedRuns === 1 ? '' : 's'}`));
      }
    }
  }
  const failed = history.runs.filter(
    (r) => r.conclusion === 'failed' || r.failedJobs.length > 0,
  );
  if (failed.length > 0) {
    lines.push('');
    lines.push(pc.bold('failed runs'));
    for (const run of failed) {
      const blame = run.failedJobs.length > 0
        ? run.failedJobs.map((j) => safeTerm(j.step === null ? j.job : `${j.job}:${j.step}`)).join(', ')
        : pc.dim('(no failed job recorded)');
      lines.push(`  ${shortSha(run.headSha)}  ${pc.dim(run.startedAt)}  ${blame}`);
    }
  }
  return lines.join('\n');
}

export function formatProviderRow(p: CiProviderInfo): string {
  const icon = p.usable ? pc.green('●') : pc.gray('○');
  const name = p.usable ? pc.white(p.provider) : pc.gray(p.provider);
  const flags = [
    p.credential,
    p.actCapable ? pc.green('act') : pc.gray('no-act'),
    p.regions.length > 0 ? `regions: ${p.regions.join(',')}` : 'no region choice',
    p.position === null ? pc.gray('not in provider order') : `order #${p.position}`,
  ].join('  ');
  return `  ${icon} ${name}  ${flags}`;
}

export function formatVerifyResult(r: CiProviderKeyResponse): string {
  const ok = r.verified === true;
  const head = ok ? pc.green('verified') : pc.red('not verified');
  const detail = r.key.statusDetail ? pc.dim(`  ${r.key.statusDetail}`) : '';
  const act = r.key.actCapable ? pc.green('  act-capable') : '';
  return `${head}  ${r.key.provider}${act}${detail}`;
}

// ─── Commands ───────────────────────────────────────────────────────────────

export function registerActionsCommands(program: Command): void {
  const actions = program
    .command('actions')
    .alias('ci')
    .description('Drive the benchmarks-platform Actions API');

  const common = (cmd: Command) =>
    cmd
      .option('--api-key <key>', 'API key (default: $COMPUTE_API_KEY)')
      .option('--base-url <url>', 'API base URL (default: https://platform.computesdk.com)')
      .option('--allow-untrusted-host', 'send the API key to a non-computesdk, non-localhost --base-url')
      .option('--json', 'print machine-readable JSON');

  common(
    actions
      .command('dispatch')
      .description('Dispatch a workflow_dispatch run')
      .argument('<repo>', 'repository in owner/repo format')
      .requiredOption('--workflow <path|name>', 'workflow path or name')
      .option('--ref <ref>', 'git ref to run (default: the workflow\'s first watched ref)')
      .option('--inputs <pairs...>', 'workflow inputs as key=value')
      .option('--provider <id>', 'place the run on one provider (e.g. namespace, vercel:sfo1) instead of the org provider order')
      .option('--provider-region <region>', 'region for --provider (same as --provider <id>:<region>)'),
  ).action(async (repo: string, opts: CommonOpts & { workflow: string; ref?: string; inputs?: string[]; provider?: string; providerRegion?: string }) => {
    try {
      const c = client(opts);
      const { workflows } = await c.get<{ workflows: CiWorkflow[] }>(
        '/api/v1/actions/workflows',
        { repo },
      );
      const workflow = matchWorkflow(workflows, opts.workflow);
      if (!workflow) {
        const choices = workflows.map((w) => `${w.path} (${w.name})`).join(', ') || 'none';
        throw new Error(
          `No dispatchable workflow "${opts.workflow}" in ${repo}. Available: ${choices}`,
        );
      }
      const ref = opts.ref ?? workflow.refs[0];
      if (!ref) throw new Error('No --ref given and the workflow has no watched refs.');
      if (opts.providerRegion !== undefined && opts.provider === undefined) {
        throw new Error('--provider-region requires --provider.');
      }
      const result = await c.post<{ runId: string; created: boolean; headSha: string }>(
        '/api/v1/actions/dispatch',
        {
          workflowId: workflow.id,
          ref,
          inputs: parseInputs(opts.inputs),
          ...(opts.provider !== undefined && {
            provider: opts.provider,
            ...(opts.providerRegion !== undefined && { providerRegion: opts.providerRegion }),
          }),
        },
      );
      const org = await c.org();
      const url = `${c.baseUrl}/${org.slug}/actions/runs/${result.runId}`;
      output(opts, { ...result, url }, (r) => {
        console.log(`${r.created ? 'dispatched' : 'already running'}  ${pc.cyan(r.runId)}`);
        console.log(`sha: ${r.headSha}`);
        console.log(`url: ${r.url}`);
      });
    } catch (e) {
      fail(e);
    }
  });

  common(
    actions
      .command('runs')
      .description('List recent runs for a repo')
      .argument('<repo>', 'repository in owner/repo format')
      .option('--status <status...>', 'filter by conclusion: passed, failed, running, cancelled, none')
      .option('--branch <branch...>', 'filter by branch/ref'),
  ).action(async (repo: string, opts: CommonOpts & { status?: string[]; branch?: string[] }) => {
    try {
      const { runs } = await client(opts).get<{ runs: CiRun[] }>(
        '/api/v1/actions/runs',
        { repo, status: opts.status, branch: opts.branch },
      );
      output(opts, runs, (rs) => {
        if (rs.length === 0) {
          console.log('No runs found.');
          return;
        }
        for (const run of rs) console.log(formatRunRow(run));
      });
    } catch (e) {
      fail(e);
    }
  });

  common(
    actions
      .command('history')
      .description('Recent run history for a workflow — per-job/step failure rates (is this failure flaky?)')
      .argument('<repo>', 'repository in owner/repo format')
      .requiredOption('--workflow <path|name>', 'workflow path or name')
      .option('--branch <branch...>', 'narrow the window to branches/refs')
      .option('--job <job>', 'narrow the rollup to one job name or workflow job id')
      .option('--limit <n>', 'runs in the window (default 10, max 50)'),
  ).action(async (repo: string, opts: CommonOpts & { workflow: string; branch?: string[]; job?: string; limit?: string }) => {
    try {
      const c = client(opts);
      const { workflows } = await c.get<{ workflows: CiWorkflow[] }>(
        '/api/v1/actions/workflows',
        { repo },
      );
      const workflow = matchWorkflow(workflows, opts.workflow) ?? workflows.find((w) => w.path === opts.workflow);
      const workflowPath = workflow?.path ?? opts.workflow;
      const history = await c.get<CiRunHistory>('/api/v1/actions/history', {
        repo,
        workflow: workflowPath,
        branch: opts.branch,
        job: opts.job,
        limit: opts.limit,
      });
      output(opts, history, (h) => console.log(formatRunHistory(h)));
    } catch (e) {
      fail(e);
    }
  });

  common(
    actions
      .command('run')
      .description('Show a run: jobs, provider:region placement, placement attempts')
      .argument('<run-id>', 'run ID'),
  ).action(async (runId: string, opts: CommonOpts) => {
    try {
      const c = client(opts);
      const run = await c.get<CiRun>(`/api/v1/actions/runs/${runId}`);
      const org = await c.org();
      const url = `${c.baseUrl}/${org.slug}/actions/runs/${run.id}`;
      output(opts, { ...run, url }, (r) => console.log(formatRunDetail(r, r.url)));
    } catch (e) {
      fail(e);
    }
  });

  common(
    actions
      .command('inspect')
      .description('Inspect a run: resolved runner image, caches, secret names, concurrency, placement context')
      .argument('<run-id>', 'run ID'),
  ).action(async (runId: string, opts: CommonOpts) => {
    try {
      const c = client(opts);
      const inspection = await c.get<CiRunInspection>(
        `/api/v1/actions/runs/${runId}/state`,
      );
      output(opts, inspection, (r) => console.log(formatRunInspection(r)));
    } catch (e) {
      fail(e);
    }
  });

  common(
    actions
      .command('logs')
      .description('Print or follow a run\'s job logs')
      .argument('<run-id>', 'run ID')
      .option('--job <job>', 'job ID or name (default: all jobs)')
      .option('--step <step>', 'step ordinal or "runner" (default: whole job)')
      .option('--follow', 'stream logs while the run is live'),
  ).action(async (runId: string, opts: CommonOpts & { job?: string; step?: string; follow?: boolean }) => {
    try {
      const c = client(opts);
      let jobs = await listRunJobs(c, runId);
      if (opts.job) {
        const job = matchJob(jobs, opts.job);
        if (!job) {
          throw new Error(
            `No job "${opts.job}" in run ${runId}. Jobs: ${jobs.map((j) => j.name).join(', ') || 'none'}`,
          );
        }
        jobs = [job];
      }
      if (jobs.length === 0) {
        if (opts.json) output(opts, { segments: [] }, () => {});
        else console.error('Run has no jobs yet.');
        return;
      }

      if (!opts.follow) {
        for (const job of jobs) {
          const slice = await readWholeJobLog(c, job.id, opts.step);
          if (opts.json) {
            process.stdout.write(JSON.stringify({ jobId: job.id, name: job.name, slice }) + '\n');
          } else {
            if (jobs.length > 1) console.log(pc.bold(`── ${job.name} ──`));
            for (const seg of slice.segments) process.stdout.write(seg.text);
          }
        }
        return;
      }

      if (jobs.length === 1) {
        // Single job: the slice endpoint's own SSE, resumed on reconnect.
        for await (const slice of followJobLog(c, jobs[0].id, opts.step)) {
          if (opts.json) {
            process.stdout.write(JSON.stringify(slice) + '\n');
          } else {
            for (const seg of slice.segments) process.stdout.write(seg.text);
          }
        }
        return;
      }

      // Multiple jobs: one multiplexed stream, each slice tagged by job.
      for await (const { job, slice } of followRunLogs(c, runId, jobs, opts.step)) {
        if (opts.json) {
          process.stdout.write(JSON.stringify({ jobId: job.id, name: job.name, slice }) + '\n');
        } else {
          for (const seg of slice.segments) {
            const text = seg.text.replace(/\n/g, `\n[${job.name}] `);
            process.stdout.write(`[${job.name}] ${text}`);
          }
        }
      }
    } catch (e) {
      fail(e);
    }
  });

  const providers = actions
    .command('providers')
    .description('List the org\'s registered compute providers (regions, act/usable status)');
  common(providers).action(async (opts: CommonOpts) => {
    try {
      const data = await client(opts).get<CiProvidersResponse>('/api/v1/actions/providers');
      output(opts, data, (d) => {
        for (const p of d.providers) console.log(formatProviderRow(p));
      });
    } catch (e) {
      fail(e);
    }
  });

  common(
    providers
      .command('configure')
      .description('Save the org\'s credential for a provider (owner/admin API key)')
      .argument('<provider>', 'provider id (e.g. tensorlake, blaxel)')
      .option('--key <key>', 'provider API key (single-field credentials)')
      .option('--field <pair...>', 'credential fields as name=value (multi-field providers)')
      .option('--verify', 'run the placement probe after saving'),
  ).action(async (provider: string, opts: CommonOpts & { key?: string; field?: string[]; verify?: boolean }) => {
    try {
      const c = client(opts);
      let body: Record<string, unknown>;
      if (opts.field !== undefined) {
        if (opts.key !== undefined) throw new Error('Pass either --key or --field, not both.');
        body = { fields: parseInputs(opts.field) };
      } else if (opts.key !== undefined) {
        body = { key: opts.key };
      } else {
        throw new Error('Pass --key <key> or --field name=value.');
      }
      const saved = await c.put<CiProviderKeyResponse>(
        `/api/v1/actions/providers/${provider}/key`,
        body,
      );
      const verification = opts.verify
        ? await c.post<CiProviderKeyResponse>(
            `/api/v1/actions/providers/${provider}/verify`,
          )
        : undefined;
      output(opts, verification ? { key: saved.key, verification } : saved, () => {
        console.log(`saved  ${saved.key.provider}  ${pc.dim(saved.key.keyHint)}  ${saved.key.status}`);
        if (verification) console.log(formatVerifyResult(verification));
      });
      if (verification?.verified === false) process.exitCode = 1;
    } catch (e) {
      fail(e);
    }
  });

  common(
    providers
      .command('verify')
      .description('Probe the stored provider key with a real sandbox ("Test" in Settings)')
      .argument('<provider>', 'provider id'),
  ).action(async (provider: string, opts: CommonOpts) => {
    try {
      const result = await client(opts).post<CiProviderKeyResponse>(
        `/api/v1/actions/providers/${provider}/verify`,
      );
      output(opts, result, (r) => console.log(formatVerifyResult(r)));
      if (result.verified === false) process.exitCode = 1;
    } catch (e) {
      fail(e);
    }
  });

  common(
    providers
      .command('remove')
      .description('Delete the org\'s stored credential for a provider')
      .argument('<provider>', 'provider id'),
  ).action(async (provider: string, opts: CommonOpts) => {
    try {
      const result = await client(opts).del<{ provider: string; deleted: boolean }>(
        `/api/v1/actions/providers/${provider}/key`,
      );
      output(opts, result, (r) => {
        console.log(r.deleted ? `deleted  ${r.provider}` : `no key stored for ${r.provider}`);
      });
    } catch (e) {
      fail(e);
    }
  });

  common(
    actions
      .command('cancel')
      .description('Cancel a run')
      .argument('<run-id>', 'run ID'),
  ).action(async (runId: string, opts: CommonOpts) => {
    try {
      const result = await client(opts).post<{ cancelled: boolean }>(
        `/api/v1/actions/runs/${runId}/cancel`,
      );
      output(opts, result, (r) => {
        console.log(r.cancelled ? `Cancelled ${runId}` : `Run ${runId} was already finished`);
      });
    } catch (e) {
      fail(e);
    }
  });

  common(
    actions
      .command('rerun')
      .description('Re-run a finished run at the same commit')
      .argument('<run-id>', 'run ID'),
  ).action(async (runId: string, opts: CommonOpts) => {
    try {
      const c = client(opts);
      const result = await c.post<{ runId: string; created: boolean }>(
        `/api/v1/actions/runs/${runId}/rerun`,
      );
      const org = await c.org();
      const url = `${c.baseUrl}/${org.slug}/actions/runs/${result.runId}`;
      output(opts, { ...result, url }, (r) => {
        console.log(`${r.created ? 'rerun dispatched' : 'rerun already running'}  ${pc.cyan(r.runId)}`);
        console.log(`url: ${r.url}`);
      });
    } catch (e) {
      fail(e);
    }
  });

  common(
    actions
      .command('artifacts')
      .description('List or download a run\'s artifacts')
      .argument('<run-id>', 'run ID')
      .option('--job <job>', 'job ID or name (default: all jobs)')
      .option('--out <dir>', 'download artifacts into this directory instead of listing'),
  ).action(async (runId: string, opts: CommonOpts & { job?: string; out?: string }) => {
    try {
      const c = client(opts);
      let jobs = await listRunJobs(c, runId);
      if (opts.job) {
        const job = matchJob(jobs, opts.job);
        if (!job) throw new Error(`No job "${opts.job}" in run ${runId}.`);
        jobs = [job];
      }
      const entries: { job: CiJob; artifacts: CiArtifactListItem[] }[] = [];
      for (const job of jobs) {
        const artifacts = await c.get<CiArtifactListItem[]>(
          `/api/v1/actions/jobs/${job.id}/artifacts`,
        );
        entries.push({ job, artifacts });
      }

      if (opts.out) {
        const written: { jobId: string; id: string; file: string }[] = [];
        for (const { job, artifacts } of entries) {
          // Per-job directory: artifact names are not unique across jobs.
          const jobDir = join(opts.out, sanitizePathPart(job.name || job.id));
          mkdirSync(jobDir, { recursive: true });
          for (const artifact of artifacts) {
            if (artifact.expired || artifact.skippedReason) continue;
            const bytes = await c.download(
              `/api/v1/actions/jobs/${job.id}/artifacts/${artifact.id}`,
            );
            const file = join(jobDir, sanitizePathPart(artifact.fileName || artifact.name));
            writeFileSync(file, bytes);
            written.push({ jobId: job.id, id: artifact.id, file });
          }
        }
        output(opts, written, (ws) => {
          for (const w of ws) console.log(`wrote ${w.file}`);
          if (ws.length === 0) console.log('No downloadable artifacts.');
        });
        return;
      }

      output(opts, entries.map((e) => ({ jobId: e.job.id, job: e.job.name, artifacts: e.artifacts })), (es) => {
        let any = false;
        for (const { job, artifacts } of es) {
          for (const a of artifacts) {
            any = true;
            const flags = a.expired ? '  expired' : a.skippedReason ? `  skipped: ${a.skippedReason}` : '';
            console.log(
              `${job}  ${a.id}  ${a.name}  ${a.contentType}  ${a.byteLength}B${flags}`,
            );
          }
        }
        if (!any) console.log('No artifacts.');
      });
    } catch (e) {
      fail(e);
    }
  });
}
