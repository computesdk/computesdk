/**
 * `compute actions repos …` and `compute actions branches` — the org's
 * repositories over `/api/v1/actions/repos*`: the list with run counts and
 * poll state, connect/sync/enable/disable, poll-now (`/repos/poll`, at most
 * every 30 s, shared with the dashboard), the fork pull request setting, and
 * a repo's refs (`/repos/branches`).
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { readFileSync } from 'fs';
import {
  ActionsApiError,
  ActionsCliError,
  type ActionsClient,
  type CiApiRepo,
  type CiBranch,
  type CiBranchesResponse,
  type CiRepoConnectResponse,
  type CiRepoPatchResponse,
  type CiRepoPollResponse,
  type CiRepoSyncResponse,
  type CiReposResponse,
} from './actions-client.js';
import type { CommonOpts } from './actions.js';
import { formatAgo } from './actions-workflows.js';
import { confirmWrite } from './confirm.js';
import { conclusionLabel, safeTerm } from './term.js';

/** Injected by `actions.ts`, which imports this module (a runtime import back would be a cycle). */
export interface ReposDeps {
  client: (opts: CommonOpts) => Promise<ActionsClient>;
  output: <T>(opts: CommonOpts, data: T, render: (data: T) => void) => void;
  fail: (error: unknown, opts?: CommonOpts) => never;
}

type RepoIdOpts = CommonOpts & { repoId?: string };
type WriteOpts = RepoIdOpts & { yes?: boolean };

const FORK_PRS: Record<string, boolean> = { allow: true, refuse: false };

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** `in 25s` / `in 2m` / `in 3h` / `in 2d` — the countdown twin of `formatAgo`. */
export function formatIn(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((Date.parse(iso) - now) / 1000));
  if (s < 60) return `in ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

/** `not polled yet` / `next poll in 2m` / `poll due`; nothing for a disabled repo. */
function pollText(r: Partial<CiApiRepo>, now: number): string | null {
  if (!r.enabled) return null;
  if (r.pollSchedule === 'never') return 'not polled yet';
  if (!r.nextPollDueAt) return null;
  return Date.parse(r.nextPollDueAt) <= now ? 'poll due' : `next poll ${formatIn(r.nextPollDueAt, now)}`;
}

/**
 * `enabled  acme/widgets  github-app · main · 2 workflows · 5 runs · last passed 3h ago · next poll in 2m`.
 * The run and poll parts are left out when the platform predates them.
 */
export function formatRepoRow(r: CiApiRepo, now: number = Date.now()): string {
  const head = r.enabled ? pc.green('enabled') : pc.dim('disabled');
  const via = r.authType === 'github_app' ? 'github-app' : r.authType;
  const parts = [
    safeTerm(via),
    safeTerm(r.defaultBranch),
    r.workflowPaths.length > 0 ? plural(r.workflowPaths.length, 'workflow') : 'no workflows yet',
  ];
  if (r.runs) {
    parts.push(plural(r.runs.total, 'run'));
    if (r.runs.lastRunState && r.runs.lastRunQueuedAt) {
      parts.push(`last ${conclusionLabel(r.runs.lastRunState)} ${formatAgo(r.runs.lastRunQueuedAt, now)}`);
    }
  }
  const poll = pollText(r, now);
  if (poll) parts.push(poll);
  if (r.forkPullRequests) parts.push('fork PRs on');
  const error = r.lastPollError ? pc.red(`  poll error: ${safeTerm(r.lastPollError)}`) : '';
  return `${head}  ${safeTerm(r.fullName)}  ${pc.dim(parts.join(' · '))}${error}`;
}

/** `refs/pull/482/head  PR #482  watched  3 runs  last 2h ago  <run-id>`. */
export function formatBranchRow(b: CiBranch, now: number = Date.now(), defaultBranch?: string): string {
  const isDefault = defaultBranch !== undefined && b.ref === `refs/heads/${defaultBranch}`;
  const at = Number.isNaN(Date.parse(b.lastRunAt)) ? null : formatAgo(b.lastRunAt, now);
  return [
    safeTerm(b.ref) + (isDefault ? pc.dim(' (default)') : ''),
    ...(b.prNumber !== null ? [`PR #${b.prNumber}`] : []),
    b.watched ? pc.green('watched') : pc.dim('history only'),
    plural(b.runCount, 'run'),
    ...(at ? [b.runCount > 0 ? `last ${at}` : pc.dim(`moved ${at}`)] : []),
    ...(b.latestRunId ? [pc.dim(b.latestRunId)] : []),
  ].join('  ');
}

/** Print what an enable/connect discovered — one dim line, nothing on a clean run. */
function printDiscovery(d: { workflowsFound: boolean; seeded: boolean; error: string | null }): void {
  if (d.error) {
    console.log(pc.yellow(`discovery: ${safeTerm(d.error)} (the poll cron retries)`));
    return;
  }
  console.log(pc.dim(`discovery: ${d.workflowsFound ? 'workflows found' : 'no workflows yet'}${d.seeded ? ', cursors seeded' : ''}`));
}

/** A 429 from `/repos/poll` with its `nextAllowedAt` folded into the message. */
function withRetryAfter(error: unknown): unknown {
  if (!(error instanceof ActionsApiError) || error.status !== 429) return error;
  const next = error.details?.nextAllowedAt;
  if (typeof next !== 'string') return error;
  const rewritten = new ActionsApiError(error.status, `${error.message}; retry after ${next} (${formatIn(next)})`, error.body);
  rewritten.retryAfterMs = error.retryAfterMs;
  return rewritten;
}

/** `--fork-prs` → `forkPullRequests`; anything but allow/refuse is refused before any request. */
export function parseForkPrs(value: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(FORK_PRS, value)) {
    throw new ActionsCliError('invalid_argument', `Invalid --fork-prs "${value}". Expected allow or refuse.`);
  }
  return FORK_PRS[value];
}

const repoIdBody = (opts: RepoIdOpts) => (opts.repoId !== undefined ? { repoId: opts.repoId } : {});
const REPO_ID_HELP = 'scope to one row when two installations grant the same name';

export function registerReposCommands(
  actions: Command,
  common: (cmd: Command) => Command,
  deps: ReposDeps,
): void {
  const { client, output, fail } = deps;

  const repos = actions
    .command('repos')
    .description('List the org\'s connected repositories: run counts, last run and next poll');
  common(repos).action(async (opts: CommonOpts) => {
    try {
      const data = await (await client(opts)).get<CiReposResponse>('/api/v1/actions/repos');
      output(opts, data, (d) => {
        if (d.repos.length === 0) {
          console.log('No repositories connected.');
          return;
        }
        for (const r of d.repos) console.log(formatRepoRow(r));
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    repos
      .command('connect')
      .description('Connect a git remote (validated by a real ls-remote; lands enabled)')
      .argument('<cloneUrl>', 'http(s) or ssh git remote URL')
      .option('--name <owner/repo>', 'repo name override (default: derived from cloneUrl)')
      .option('--branch <branch>', 'default branch (default: main, else the remote\'s first)')
      .option('--token <token>', 'credential for private http(s) remotes')
      .option('--username <user>', 'username — with --token, makes auth "basic" instead of "token"')
      .option('--ssh-key-file <path>', 'OpenSSH/PEM private key file for ssh remotes')
      .option('--known-hosts-file <path>', 'known_hosts pin for ssh remotes'),
  ).action(async (cloneUrl: string, opts: CommonOpts & { name?: string; branch?: string; token?: string; username?: string; sshKeyFile?: string; knownHostsFile?: string }) => {
    try {
      let body: Record<string, unknown>;
      if (opts.sshKeyFile !== undefined) {
        if (opts.token !== undefined || opts.username !== undefined) {
          throw new Error('Pass either --ssh-key-file or --token/--username, not both.');
        }
        body = {
          authType: 'ssh',
          credential: readFileSync(opts.sshKeyFile, 'utf8'),
          ...(opts.knownHostsFile !== undefined && {
            knownHosts: readFileSync(opts.knownHostsFile, 'utf8'),
          }),
        };
      } else if (opts.username !== undefined) {
        if (opts.token === undefined) throw new Error('--username requires --token.');
        body = { authType: 'basic', username: opts.username, credential: opts.token };
      } else if (opts.token !== undefined) {
        body = { authType: 'token', credential: opts.token };
      } else {
        body = { authType: 'none' };
      }
      if (opts.knownHostsFile !== undefined && opts.sshKeyFile === undefined) {
        throw new Error('--known-hosts-file requires --ssh-key-file.');
      }
      const result = await (await client(opts)).post<CiRepoConnectResponse>('/api/v1/actions/repos', {
        cloneUrl,
        ...body,
        ...(opts.name !== undefined && { name: opts.name }),
        ...(opts.branch !== undefined && { defaultBranch: opts.branch }),
      });
      output(opts, result, (r) => {
        console.log(`connected  ${pc.cyan(safeTerm(r.fullName))}  ${pc.dim(`(${safeTerm(r.authType)}, ${safeTerm(r.defaultBranch)})`)}`);
        printDiscovery(r.discovery);
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    repos
      .command('sync')
      .description('Re-read the GitHub App installation so repos granted after install show up (owner/admin key)'),
  ).action(async (opts: CommonOpts) => {
    try {
      const result = await (await client(opts)).post<CiRepoSyncResponse>('/api/v1/actions/repos/sync', {});
      output(opts, result, (r) => {
        for (const a of r.accounts) {
          console.log(a.error === null ? `synced  ${pc.cyan(safeTerm(a.account))}` : `failed  ${pc.cyan(safeTerm(a.account))}  ${pc.red(safeTerm(a.error))}`);
        }
        console.log(pc.dim(`${r.repos.length} repos visible`));
      });
      if (result.accounts.some((a) => a.error !== null)) process.exitCode = 1;
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    repos
      .command('enable')
      .description('Enable a repo the org can already see (granted by a GitHub App install, or a connected remote)')
      .argument('<repo>', 'repository in owner/repo format')
      .option('--repo-id <id>', REPO_ID_HELP),
  ).action(async (repo: string, opts: RepoIdOpts) => {
    try {
      const result = await (await client(opts)).patch<CiRepoPatchResponse>('/api/v1/actions/repos', {
        fullName: repo,
        enabled: true,
        ...repoIdBody(opts),
      });
      output(opts, result, (r) => {
        console.log(`enabled  ${pc.cyan(safeTerm(r.fullName))}`);
        if (r.discovery) printDiscovery(r.discovery);
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    repos
      .command('disable')
      .description('Disable a repo — it stays connected but no runs are scheduled')
      .argument('<repo>', 'repository in owner/repo format')
      .option('--repo-id <id>', REPO_ID_HELP),
  ).action(async (repo: string, opts: RepoIdOpts) => {
    try {
      const result = await (await client(opts)).patch<CiRepoPatchResponse>('/api/v1/actions/repos', {
        fullName: repo,
        enabled: false,
        ...repoIdBody(opts),
      });
      output(opts, result, (r) => console.log(`disabled  ${pc.cyan(safeTerm(r.fullName))}`));
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    repos
      .command('poll')
      .description('Poll a repo now: fetch its refs and start the runs new commits call for (owner/admin; at most every 30 s)')
      .argument('<repo>', 'repository in owner/repo format')
      .option('--repo-id <id>', REPO_ID_HELP)
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (repo: string, opts: WriteOpts) => {
    try {
      await confirmWrite(`Poll ${repo} now? New commits on its watched refs start the runs their workflows call for.`, opts);
      const c = await client(opts);
      let result: CiRepoPollResponse;
      try {
        result = await c.post<CiRepoPollResponse>('/api/v1/actions/repos/poll', { fullName: repo, ...repoIdBody(opts) });
      } catch (e) {
        throw withRetryAfter(e);
      }
      output(opts, result, (r) => {
        console.log(`polled  ${pc.cyan(safeTerm(r.fullName))}  ${plural(r.createdRunIds.length, 'run')} started`);
        if (r.error) console.log(pc.red(`poll error: ${safeTerm(r.error)}`));
      });
      // The platform answers 200 for a poll the remote refused; the error is the outcome.
      if (result.error) process.exitCode = 1;
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    repos
      .command('set')
      .description('Change a repo\'s settings: whether pull requests from forks run CI (owner/admin)')
      .argument('<repo>', 'repository in owner/repo format')
      .requiredOption('--fork-prs <allow|refuse>', 'run pull requests from forks (isolated: no org secrets, no GitHub token), or refuse them')
      .option('--repo-id <id>', REPO_ID_HELP)
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (repo: string, opts: WriteOpts & { forkPrs: string }) => {
    try {
      const forkPullRequests = parseForkPrs(opts.forkPrs);
      await confirmWrite(
        forkPullRequests
          ? `Run pull requests from forks on ${repo}? They run isolated: no org secrets, no GitHub token, and the base branch's workflow definition.`
          : `Refuse pull requests from forks on ${repo}? Fork pull requests stop running CI.`,
        opts,
      );
      const result = await (await client(opts)).patch<CiRepoPatchResponse>('/api/v1/actions/repos', {
        fullName: repo,
        forkPullRequests,
        ...repoIdBody(opts),
      });
      output(opts, result, (r) =>
        console.log(`fork PRs ${r.forkPullRequests === false ? 'refused' : 'allowed'}  ${pc.cyan(safeTerm(r.fullName))}`),
      );
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    actions
      .command('branches')
      .description('List a repo\'s refs: watched branches and pull requests, then refs with run history only')
      .argument('<repo>', 'repository in owner/repo format')
      .option('--search <text>', 'only refs containing this text (case-insensitive)')
      .option('--archived', 'count archived runs instead of active ones')
      .option('--repo-id <id>', REPO_ID_HELP),
  ).action(async (repo: string, opts: RepoIdOpts & { search?: string; archived?: boolean }) => {
    try {
      const data = await (await client(opts)).get<CiBranchesResponse>('/api/v1/actions/repos/branches', {
        repo,
        repoId: opts.repoId,
        q: opts.search,
        archived: opts.archived ? '1' : undefined,
      });
      output(opts, data, (d) => {
        console.log(`${pc.bold(safeTerm(d.repo))}  ${pc.dim(`default: ${safeTerm(d.defaultBranch)}`)}`);
        if (d.branches.length === 0) {
          console.log('No branches found.');
          return;
        }
        const now = Date.now();
        for (const b of d.branches) console.log(formatBranchRow(b, now, d.defaultBranch));
      });
    } catch (e) {
      fail(e, opts);
    }
  });
}
