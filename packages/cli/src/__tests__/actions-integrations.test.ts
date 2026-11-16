import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const get = vi.fn(async (_path: string): Promise<unknown> => ({}));
const fakeClient = { get, patch: vi.fn(), post: vi.fn(), del: vi.fn() };

// Commands registered inside actions.ts build their client from these two.
vi.mock('../actions-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../actions-client.js')>();
  return {
    ...actual,
    resolveActionsAuth: vi.fn(async () => ({ apiKey: 'test', baseUrl: 'https://platform.computesdk.com', orgSlug: null })),
    ActionsClient: vi.fn(function ActionsClient() {
      return fakeClient;
    }),
  };
});

const { registerActionsCommands } = await import('../actions.js');
const { formatInstallations, formatInstallLink, formatSlack } = await import('../actions-integrations.js');

function buildActions(): Command {
  const program = new Command().exitOverride();
  registerActionsCommands(program);
  return program;
}

async function captureStdout(fn: () => Promise<unknown>): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    await fn();
    return [...log.mock.calls, ...write.mock.calls].map((c) => String(c[0])).join('\n');
  } finally {
    log.mockRestore();
    write.mockRestore();
  }
}

const INSTALLATION = {
  githubInstallationId: 42,
  account: 'ada-org',
  accountType: 'Organization',
  accountAvatarUrl: null,
  appSlug: 'computesdk',
  repoSelection: 'selected' as const,
  suspended: false,
  suspendedAt: null,
  installedAt: '2026-01-02T03:04:05.000Z',
  configureUrl: 'https://github.com/organizations/ada-org/settings/installations/42',
  repos: { granted: 5, enabled: 2 },
};

const SLACK = {
  installed: true,
  teamName: 'Ada Inc',
  channelId: 'C0123ABC456',
  channelName: 'ci',
  notifyOn: 'failure' as const,
  brief: { enabled: true, times: ['09:00', '17:00'], timeZone: 'Europe/London', categories: ['deploy'] },
};

beforeEach(() => {
  get.mockReset();
});

describe('formatInstallations', () => {
  it('shows each account with its selection, repo counts and configure link', () => {
    const out = formatInstallations({ installations: [INSTALLATION] }).join('\n');
    expect(out).toContain('ada-org');
    expect(out).toContain('Organization');
    expect(out).toContain('selected repos');
    expect(out).toContain('5 granted, 2 enabled');
    expect(out).toContain('configure: https://github.com/organizations/ada-org/settings/installations/42');
    expect(out).not.toContain('suspended');
  });

  it('marks a suspended installation', () => {
    const out = formatInstallations({
      installations: [{ ...INSTALLATION, repoSelection: 'all', suspended: true, suspendedAt: '2026-02-01T00:00:00.000Z' }],
    }).join('\n');
    expect(out).toContain('all repos');
    expect(out).toContain('suspended 2026-02-01T00:00:00.000Z');
  });

  it('points at install-url when nothing is installed', () => {
    expect(formatInstallations({ installations: [] }).join('\n')).toContain('compute actions installations install-url');
  });
});

describe('formatSlack', () => {
  it('shows the workspace, channel, notify rule and brief', () => {
    const out = formatSlack(SLACK).join('\n');
    expect(out).toContain('workspace: Ada Inc');
    expect(out).toContain('#ci');
    expect(out).toContain('C0123ABC456');
    expect(out).toContain('failures and cancels');
    expect(out).toContain('09:00, 17:00 Europe/London');
    expect(out).toContain('categories: deploy');
  });

  it('says when Slack is not connected or the brief is off', () => {
    expect(formatSlack({ ...SLACK, installed: false }).join('\n')).toContain('compute actions slack install-url');
    expect(formatSlack({ ...SLACK, brief: { ...SLACK.brief, enabled: false } }).join('\n')).toMatch(/daily brief: .*off/);
  });
});

describe('formatInstallLink', () => {
  it('prints the page to open, or that the deployment has no app', () => {
    const github = formatInstallLink({ configured: true, appSlug: 'computesdk', url: 'https://platform.computesdk.com/ada/settings/actions' }, 'github');
    expect(github[0]).toBe('https://platform.computesdk.com/ada/settings/actions');
    expect(github.join('\n')).toContain('Install GitHub App');
    expect(formatInstallLink({ configured: false, url: null }, 'slack')[0]).toContain('no Slack app');
  });
});

describe('compute actions installations / slack', () => {
  it('reads each route', async () => {
    get.mockImplementation(async (path: string) =>
      path === '/api/v1/actions/installations'
        ? { installations: [INSTALLATION] }
        : path === '/api/v1/actions/slack'
          ? SLACK
          : { configured: true, url: `https://platform.computesdk.com${path}` },
    );
    const out = await captureStdout(async () => {
      await buildActions().parseAsync(['actions', 'installations'], { from: 'user' });
      await buildActions().parseAsync(['actions', 'installations', 'install-url'], { from: 'user' });
      await buildActions().parseAsync(['actions', 'slack'], { from: 'user' });
      await buildActions().parseAsync(['actions', 'slack', 'install-url'], { from: 'user' });
    });
    expect(get.mock.calls.map((c) => c[0])).toEqual([
      '/api/v1/actions/installations',
      '/api/v1/actions/installations/install-url',
      '/api/v1/actions/slack',
      '/api/v1/actions/slack/install-url',
    ]);
    expect(out).toContain('ada-org');
    expect(out).toContain('workspace: Ada Inc');
    expect(out).toContain('/api/v1/actions/slack/install-url');
  });

  it('--json prints the raw body', async () => {
    get.mockImplementation(async () => SLACK);
    const out = await captureStdout(() => buildActions().parseAsync(['actions', 'slack', '--json'], { from: 'user' }));
    expect(JSON.parse(out)).toEqual(SLACK);
  });
});
