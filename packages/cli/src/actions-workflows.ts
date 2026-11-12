/**
 * `compute actions workflows …` — the workflow catalog and its per-workflow
 * controls over `GET`/`PATCH /api/v1/actions/workflows`: the runnable list,
 * every workflow with `--all` (user-disabled ones and those on disabled
 * repos), the files only a branch or tag has with `--ref`, and
 * enable/disable/set for the on/off switch, placement order and snapshot cap.
 */

import { Command } from 'commander';
import pc from 'picocolors';
import {
  ActionsCliError,
  type ActionsClient,
  type CiRefOnlyWorkflow,
  type CiWorkflowControls,
  type CiWorkflowInput,
  type CiWorkflowListItem,
  type CiWorkflowsResponse,
} from './actions-client.js';
import type { CommonOpts } from './actions.js';
import { resolveWorkflowPaths } from './actions-runs.js';
import { confirmWrite } from './confirm.js';
import { conclusionLabel, safeTerm } from './term.js';

/** Injected by `actions.ts`, which imports this module (a runtime import back would be a cycle). */
export interface WorkflowsDeps {
  client: (opts: CommonOpts) => Promise<ActionsClient>;
  output: <T>(opts: CommonOpts, data: T, render: (data: T) => void) => void;
  fail: (error: unknown, opts?: CommonOpts) => never;
}

type ListOpts = CommonOpts & { all?: boolean; ref?: string };
type WriteOpts = CommonOpts & { yes?: boolean };
type SetOpts = WriteOpts & {
  order?: string;
  inheritOrder?: boolean;
  snapshotCap?: string;
  dynamicSnapshots?: boolean;
};
type Controls = { enabled?: boolean; providerOrder?: string[] | null; snapshotCap?: number | null };

export function formatAgo(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function orderText(order: string[] | null | undefined): string {
  return order && order.length > 0 ? order.map(safeTerm).join(',') : 'inherits';
}

function snapshotText(cap: number | null | undefined): string {
  if (cap === null || cap === undefined) return 'dynamic';
  return cap === 0 ? 'off' : String(cap);
}

/** `target* (required), suite default=dax` — dispatch inputs as `--inputs` needs them. */
export function formatWorkflowInputs(inputs: CiWorkflowInput[]): string {
  return inputs
    .map((i) => {
      const name = safeTerm(i.name);
      if (i.required) return `${name}* (required)`;
      return i.default !== '' ? `${name} default=${safeTerm(i.default)}` : name;
    })
    .join(', ');
}

function stateLabel(w: CiWorkflowListItem): string {
  if (w.repoEnabled === false) return pc.gray('○ repo disabled');
  if (w.enabled === false || w.userDisabledAt) return pc.gray('○ disabled (user)');
  return pc.green('● enabled');
}

export function formatWorkflowRow(w: CiWorkflowListItem, now: number = Date.now()): string {
  const last = w.lastRun ? `${conclusionLabel(w.lastRun.conclusion)} ${formatAgo(w.lastRun.queuedAt, now)}` : 'never';
  const inputs = formatWorkflowInputs(w.inputs ?? []);
  return [
    stateLabel(w),
    pc.dim(safeTerm(w.repoFullName)),
    `${safeTerm(w.path)} (${safeTerm(w.name)})`,
    `order: ${orderText(w.providerOrder)}`,
    `snapshots: ${snapshotText(w.snapshotCap)}`,
    `last: ${last}`,
    ...(inputs ? [pc.dim(`inputs: ${inputs}`)] : []),
  ].join('  ');
}

export function formatRefOnlyRow(w: CiRefOnlyWorkflow): string {
  const inputs = formatWorkflowInputs(w.inputs);
  return [
    pc.cyan('◇ ref-only'),
    `${safeTerm(w.path)} (${safeTerm(w.name)})`,
    w.dispatchable
      ? inputs
        ? `inputs: ${inputs}`
        : pc.dim('no inputs')
      : pc.dim('push-only: dispatch with --manual'),
  ].join('  ');
}

/**
 * Match a dispatch `--workflow` against the files only the ref has: an exact
 * path first, then the name. A name two files share is refused with their
 * paths rather than guessed, as the control commands do.
 */
export function matchRefOnly(refOnly: CiRefOnlyWorkflow[], selector: string): CiRefOnlyWorkflow | undefined {
  const byPath = refOnly.find((w) => w.path === selector);
  if (byPath) return byPath;
  const byName = refOnly.filter((w) => w.name === selector);
  if (byName.length > 1) {
    throw new ActionsCliError(
      'invalid_argument',
      `"${selector}" matches ${byName.length} workflows only on this ref: ${byName.map((w) => safeTerm(w.path)).join(', ')}. Pass the path.`,
    );
  }
  return byName[0];
}

/** `path (name)` choices for a not-found message. */
export function workflowChoices(workflows: { path: string; name: string }[]): string {
  return [...new Set(workflows.map((w) => `${w.path} (${w.name})`))].join(', ') || 'none';
}

/**
 * The path a control command's `<workflow>` names in `repo`, matched against
 * the full catalog (disabled workflows included) by path, name, file name or
 * id. A name shared by two files is refused rather than guessed.
 */
export function resolveControlTarget(catalog: CiWorkflowListItem[], repo: string, selector: string): string {
  const inRepo = catalog.filter((w) => w.repoFullName === repo);
  let paths: string[];
  try {
    paths = resolveWorkflowPaths(inRepo, [selector]);
  } catch (e) {
    if (e instanceof ActionsCliError && e.code === 'workflow_not_found') {
      throw new ActionsCliError('workflow_not_found', `No workflow "${selector}" in ${repo}. Available: ${workflowChoices(inRepo)}`);
    }
    throw e;
  }
  if (paths.length > 1) {
    throw new ActionsCliError(
      'invalid_argument',
      `"${selector}" matches ${paths.length} workflows in ${repo}: ${paths.join(', ')}. Pass the path.`,
    );
  }
  return paths[0];
}

/** `set`'s flags → the PATCH controls; refuses conflicting, malformed or empty input. */
export function setControls(opts: SetOpts): Controls {
  const controls: Controls = {};
  if (opts.order !== undefined && opts.inheritOrder) {
    throw new ActionsCliError('invalid_argument', 'Pass --order or --inherit-order, not both.');
  }
  if (opts.snapshotCap !== undefined && opts.dynamicSnapshots) {
    throw new ActionsCliError('invalid_argument', 'Pass --snapshot-cap or --dynamic-snapshots, not both.');
  }
  if (opts.inheritOrder) controls.providerOrder = null;
  if (opts.order !== undefined) {
    const order = opts.order.split(',').map((s) => s.trim()).filter(Boolean);
    if (order.length === 0) {
      throw new ActionsCliError(
        'invalid_argument',
        `--order "${opts.order}" names no providers — pass a comma-separated list, or --inherit-order.`,
      );
    }
    controls.providerOrder = order;
  }
  if (opts.dynamicSnapshots) controls.snapshotCap = null;
  if (opts.snapshotCap !== undefined) {
    if (!/^\d+$/.test(opts.snapshotCap.trim())) {
      throw new ActionsCliError(
        'invalid_argument',
        `Invalid --snapshot-cap "${opts.snapshotCap}". Expected a whole number (0 turns snapshots off), or --dynamic-snapshots.`,
      );
    }
    controls.snapshotCap = Number(opts.snapshotCap.trim());
  }
  if (Object.keys(controls).length === 0) {
    throw new ActionsCliError(
      'invalid_argument',
      'Nothing to change — pass --order, --inherit-order, --snapshot-cap or --dynamic-snapshots.',
    );
  }
  return controls;
}

function describeControls(c: Controls): string {
  const parts: string[] = [];
  if (c.providerOrder !== undefined) parts.push(`order: ${orderText(c.providerOrder)}`);
  if (c.snapshotCap !== undefined) parts.push(`snapshots: ${snapshotText(c.snapshotCap)}`);
  return parts.join(', ');
}

function formatControlsResult(verb: string, r: CiWorkflowControls): string {
  const detail =
    verb === 'set'
      ? `  order: ${orderText(r.providerOrder)}  snapshots: ${snapshotText(r.snapshotCap)}`
      : '';
  return `${verb}  ${pc.cyan(safeTerm(r.repoFullName))}  ${safeTerm(r.path)}${detail}`;
}

export function registerWorkflowsCommands(
  actions: Command,
  common: (cmd: Command) => Command,
  deps: WorkflowsDeps,
): void {
  const workflows = actions
    .command('workflows')
    .description('List workflows with their controls (every repo, or one); --all adds disabled ones, --ref the files only a branch has');
  common(
    workflows
      .argument('[repo]', 'repository in owner/repo format (default: every repo)')
      .option('--all', 'include user-disabled workflows and workflows on disabled repos')
      .option('--ref <ref>', 'with a repo: also list the workflow files only this branch or tag has (dispatchable by path)'),
  ).action(async (repo: string | undefined, opts: ListOpts) => {
    try {
      if (opts.ref !== undefined && repo === undefined) {
        throw new ActionsCliError('invalid_argument', '--ref needs a repo: compute actions workflows <owner/repo> --ref <ref>.');
      }
      const c = await deps.client(opts);
      const data = await c.get<CiWorkflowsResponse>('/api/v1/actions/workflows', {
        repo,
        include: opts.all ? 'all' : undefined,
        ref: opts.ref,
      });
      deps.output(opts, data, (d) => {
        if (d.workflows.length === 0 && (d.refOnly ?? []).length === 0) {
          console.log('No workflows found.');
          return;
        }
        for (const w of d.workflows) console.log(formatWorkflowRow(w));
        if (opts.ref !== undefined) {
          const refOnly = d.refOnly ?? [];
          console.log(pc.dim(refOnly.length === 0 ? `only on ${safeTerm(opts.ref)}: none` : `only on ${safeTerm(opts.ref)}:`));
          for (const w of refOnly) console.log(formatRefOnlyRow(w));
        }
      });
    } catch (e) {
      deps.fail(e, opts);
    }
  });

  /** Confirm, resolve `<workflow>` against `?include=all`, then PATCH repo + path with `controls`. */
  async function writeControls(
    repo: string,
    selector: string,
    controls: Controls,
    question: string,
    verb: string,
    opts: WriteOpts,
  ): Promise<void> {
    await confirmWrite(question, opts);
    const c = await deps.client(opts);
    const { workflows: catalog } = await c.get<CiWorkflowsResponse>('/api/v1/actions/workflows', {
      repo,
      include: 'all',
    });
    const path = resolveControlTarget(catalog, repo, selector);
    const result = await c.patch<CiWorkflowControls>('/api/v1/actions/workflows', {
      repoFullName: repo,
      path,
      ...controls,
    });
    deps.output(opts, result, (r) => console.log(formatControlsResult(verb, r)));
  }

  for (const enabled of [true, false]) {
    const verb = enabled ? 'enable' : 'disable';
    common(
      workflows
        .command(verb)
        .description(
          enabled
            ? 'Turn a workflow back on (owner/admin)'
            : 'Turn a workflow off: no pushes, schedules or dispatches run it until enabled (owner/admin)',
        )
        .argument('<repo>', 'repository in owner/repo format')
        .argument('<workflow>', 'workflow path, name, file name (ci.yml) or id')
        .option('-y, --yes', 'skip the confirmation'),
    ).action(async (repo: string, selector: string, opts: WriteOpts) => {
      try {
        const question = enabled
          ? `Enable workflow "${selector}" in ${repo}? It runs again on its triggers.`
          : `Disable workflow "${selector}" in ${repo}? Pushes, schedules and dispatches stop running it until it is enabled.`;
        await writeControls(repo, selector, { enabled }, question, `${verb}d`, opts);
      } catch (e) {
        deps.fail(e, opts);
      }
    });
  }

  common(
    workflows
      .command('set')
      .description('Set a workflow\'s provider order and snapshot cap (owner/admin)')
      .argument('<repo>', 'repository in owner/repo format')
      .argument('<workflow>', 'workflow path, name, file name (ci.yml) or id')
      .option('--order <providers>', 'this workflow walks exactly these BYOK providers instead of the Actions router (e.g. e2b,blaxel)')
      .option('--inherit-order', 'drop the workflow\'s order: it follows the Actions router')
      .option('--snapshot-cap <n>', 'most snapshots this workflow keeps (0 turns them off)')
      .option('--dynamic-snapshots', 'drop the cap: the workflow uses the dynamic snapshot pool')
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (repo: string, selector: string, opts: SetOpts) => {
    try {
      const controls = setControls(opts);
      await writeControls(
        repo,
        selector,
        controls,
        `Change workflow "${selector}" in ${repo} (${describeControls(controls)})?`,
        'set',
        opts,
      );
    } catch (e) {
      deps.fail(e, opts);
    }
  });
}
