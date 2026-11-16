/**
 * `compute actions installations …` and `compute actions slack …` — the org's
 * connected integrations over `/api/v1/actions/installations*` and
 * `/api/v1/actions/slack*`: the GitHub App installations (account, repo
 * selection and counts, suspension) and the Slack connection (workspace,
 * channel, notify rule, daily brief), plus where an owner/admin starts a new
 * install. Reads only: installing is a browser step the platform signs for
 * the signed-in user, so `install-url` prints the page to open, never a
 * signed install link.
 */

import { Command } from 'commander';
import pc from 'picocolors';
import type {
  ActionsClient,
  CiInstallation,
  CiInstallationsResponse,
  CiInstallLink,
  CiSlackConnection,
} from './actions-client.js';
import type { CommonOpts } from './actions.js';
import { safeTerm } from './term.js';

/** Injected by `actions.ts`, which imports this module (a runtime import back would be a cycle). */
export interface IntegrationsDeps {
  client: (opts: CommonOpts) => Promise<ActionsClient>;
  output: <T>(opts: CommonOpts, data: T, render: (data: T) => void) => void;
  fail: (error: unknown, opts?: CommonOpts) => never;
}

export function formatInstallationRow(i: CiInstallation): string {
  const head = i.suspended ? pc.yellow(safeTerm(i.account)) : pc.cyan(safeTerm(i.account));
  const parts = [
    i.accountType ? safeTerm(i.accountType) : 'account',
    i.repoSelection === 'all' ? 'all repos' : 'selected repos',
    `${i.repos.granted} granted, ${i.repos.enabled} enabled`,
    ...(i.suspended ? [pc.yellow(`suspended ${safeTerm(i.suspendedAt ?? '')}`.trim())] : []),
    pc.dim(`installed ${safeTerm(i.installedAt)}`),
  ];
  return `${head}  ${parts.join('  ')}`;
}

export function formatInstallations(data: CiInstallationsResponse): string[] {
  if (data.installations.length === 0) {
    return ['No GitHub App installations. Run `compute actions installations install-url` for where to install it.'];
  }
  const lines: string[] = [];
  for (const i of data.installations) {
    lines.push(formatInstallationRow(i));
    if (i.configureUrl) lines.push(`  ${pc.dim(`configure: ${safeTerm(i.configureUrl)}`)}`);
  }
  return lines;
}

export function formatSlack(s: CiSlackConnection): string[] {
  if (!s.installed) {
    return ['Slack is not connected. Run `compute actions slack install-url` for where to connect it.'];
  }
  const channel = s.channelId
    ? `${s.channelName ? `#${safeTerm(s.channelName)} ` : ''}${pc.dim(safeTerm(s.channelId))}`
    : pc.gray('no channel picked');
  const brief = s.brief.enabled
    ? `${s.brief.times.map(safeTerm).join(', ')} ${safeTerm(s.brief.timeZone)}${s.brief.categories.length > 0 ? `  categories: ${s.brief.categories.map(safeTerm).join(', ')}` : ''}`
    : pc.gray('off');
  return [
    `workspace: ${s.teamName ? safeTerm(s.teamName) : pc.gray('(unnamed)')}`,
    `channel: ${channel}`,
    `notify on: ${s.notifyOn === 'failure' ? 'failures and cancels' : 'every conclusion'}`,
    `daily brief: ${brief}`,
  ];
}

export function formatInstallLink(link: CiInstallLink, what: 'github' | 'slack'): string[] {
  if (!link.configured || link.url === null) {
    return [what === 'github' ? 'This deployment has no GitHub App configured.' : 'This deployment has no Slack app configured.'];
  }
  return [
    safeTerm(link.url),
    pc.dim(
      what === 'github'
        ? 'Open it signed in as an org owner/admin and press Install GitHub App.'
        : 'Open it in a browser signed in as an org owner/admin; it continues to Slack.',
    ),
  ];
}

export function registerIntegrationsCommands(
  actions: Command,
  common: (cmd: Command) => Command,
  deps: IntegrationsDeps,
): void {
  const { client, output, fail } = deps;
  const print = (lines: string[]) => {
    for (const line of lines) console.log(line);
  };

  const installations = common(
    actions
      .command('installations')
      .description('List the org\'s GitHub App installations (account, repo selection and counts, suspension)'),
  ).action(async (opts: CommonOpts) => {
    try {
      const data = await (await client(opts)).get<CiInstallationsResponse>('/api/v1/actions/installations');
      output(opts, data, (d) => print(formatInstallations(d)));
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    installations
      .command('install-url')
      .description('Print where an owner/admin installs the GitHub App into another account'),
  ).action(async (opts: CommonOpts) => {
    try {
      const data = await (await client(opts)).get<CiInstallLink>('/api/v1/actions/installations/install-url');
      output(opts, data, (d) => print(formatInstallLink(d, 'github')));
    } catch (e) {
      fail(e, opts);
    }
  });

  const slack = common(
    actions
      .command('slack')
      .description('Show the org\'s Slack connection (workspace, channel, notify rule, daily brief; owner/admin)'),
  ).action(async (opts: CommonOpts) => {
    try {
      const data = await (await client(opts)).get<CiSlackConnection>('/api/v1/actions/slack');
      output(opts, data, (d) => print(formatSlack(d)));
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    slack
      .command('install-url')
      .description('Print where an owner/admin connects a Slack workspace'),
  ).action(async (opts: CommonOpts) => {
    try {
      const data = await (await client(opts)).get<CiInstallLink>('/api/v1/actions/slack/install-url');
      output(opts, data, (d) => print(formatInstallLink(d, 'slack')));
    } catch (e) {
      fail(e, opts);
    }
  });
}
