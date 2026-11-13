import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

const { fetchMock, question, auth } = vi.hoisted(() => ({
  fetchMock: vi.fn<[URL | string, RequestInit | undefined], Promise<Response>>(),
  question: vi.fn(async (_q: string) => ''),
  auth: { apiKey: 'oauth-access-token' },
}));

// The commands build their client from `resolveActionsAuth`; a real
// ActionsClient on a recorded fetch lets the tests see each request's method,
// URL, body and X-Org-Slug header.
vi.mock('../actions-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../actions-client.js')>();
  return {
    ...actual,
    resolveActionsAuth: vi.fn(async (opts: { org?: string }) => ({
      apiKey: auth.apiKey,
      baseUrl: 'https://platform.test',
      ...(opts.org ? { orgSlug: opts.org } : {}),
    })),
    ActionsClient: vi.fn(function ActionsClient(a: ConstructorParameters<typeof actual.ActionsClient>[0]) {
      return new actual.ActionsClient(a, fetchMock as unknown as typeof fetch);
    }),
  };
});

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question, close: () => undefined }),
}));

const { registerOrgMemberCommands, registerInvitationsCommands } = await import('../org-members.js');

class Exit extends Error {
  constructor(public code: number | undefined) {
    super(`exit ${code}`);
  }
}

function program(): Command {
  const p = new Command().enablePositionalOptions().exitOverride();
  registerOrgMemberCommands(p.command('org'));
  registerInvitationsCommands(p);
  return p;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const ORG_KEY = 'bp_0123456789abcdef';
const BASE = '/api/v1/organizations/current';

const OWNER = {
  id: 'mem_owner',
  userId: 'usr_owner',
  name: 'Owner',
  email: 'owner@parity.test',
  role: 'owner',
  createdAt: '2026-11-01T00:00:00.000Z',
};
const TEMP1 = {
  id: 'mem_temp1',
  userId: 'usr_temp1',
  name: null,
  email: 'temp1@parity.test',
  role: 'member',
  createdAt: '2026-11-02T00:00:00.000Z',
};
const MEMBERS = { members: [OWNER, TEMP1] };

const INVITATION = {
  id: 'inv_1',
  email: 'cli-invite@parity.test',
  role: 'admin',
  status: 'pending',
  expiresAt: '2026-11-12T00:00:00.000Z',
  createdAt: '2026-11-10T00:00:00.000Z',
  inviterId: 'usr_owner',
  url: 'http://localhost:3210/invitations/inv_1',
};
const USER_INVITATION = {
  ...INVITATION,
  organization: { id: 'org_a', name: 'Parity Owner', slug: 'parity-owner' },
};

const USER_CREDENTIAL_REQUIRED = {
  error: 'User credential required',
  code: 'user_credential_required',
  message: 'User credential required',
  requestId: 'req_1',
};

let stdout: string;
let stderr: string;

const requests = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    method: init?.method ?? 'GET',
    url: String(url).replace('https://platform.test', ''),
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
  }));
const orgHeader = (i = 0) =>
  (fetchMock.mock.calls[i]?.[1]?.headers as Record<string, string> | undefined)?.['X-Org-Slug'];
const writes = () => requests().filter((r) => r.method !== 'GET');

async function cli(...args: string[]): Promise<number> {
  try {
    await program().parseAsync(args, { from: 'user' });
    return 0;
  } catch (e) {
    if (e instanceof Exit) return e.code ?? 0;
    if (e && typeof e === 'object' && 'exitCode' in e) return Number((e as { exitCode: number }).exitCode);
    throw e;
  }
}

function setTTY(value: boolean | undefined) {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

beforeEach(() => {
  fetchMock.mockReset();
  question.mockReset();
  auth.apiKey = 'oauth-access-token';
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

describe('compute org members', () => {
  it('GETs the current org members; --json prints the API body', async () => {
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    expect(await cli('org', 'members', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'GET', url: `${BASE}/members`, body: undefined }]);
    expect(orgHeader()).toBeUndefined();
    expect(JSON.parse(stdout)).toEqual(MEMBERS);
  });

  it('--org selects the org for a user login through X-Org-Slug', async () => {
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    expect(await cli('org', 'members', '--org', 'parity-admin', '--json')).toBe(0);
    expect(requests()[0].url).toBe(`${BASE}/members`);
    expect(orgHeader()).toBe('parity-admin');
  });

  it('prints each member with email and role', async () => {
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    expect(await cli('org', 'members')).toBe(0);
    const lines = stdout.split('\n');
    expect(lines[0]).toMatch(/^EMAIL\s+ROLE\s+NAME\s+MEMBER ID/);
    expect(lines.find((l) => l.startsWith('owner@parity.test'))).toMatch(/owner@parity.test\s+owner\s+Owner\s+mem_owner/);
    expect(lines.find((l) => l.startsWith('temp1@parity.test'))).toMatch(/temp1@parity.test\s+member\s+—\s+mem_temp1/);
  });

  it('renders the error envelope with its hint', async () => {
    const body = { error: 'Forbidden', code: 'forbidden', message: 'Forbidden', hint: 'Ask an org admin.', requestId: 'req_9' };
    fetchMock.mockResolvedValueOnce(json(body, 403));
    expect(await cli('org', 'members', '--json')).toBe(1);
    expect(stdout).toBe('');
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'forbidden', httpStatus: 403, hint: 'Ask an org admin.' });

    fetchMock.mockResolvedValueOnce(json(body, 403));
    stderr = '';
    expect(await cli('org', 'members')).toBe(1);
    expect(stderr).toContain('Error (403): Forbidden');
    expect(stderr).toContain('Ask an org admin.');
  });
});

describe('compute org invitations', () => {
  it('GETs the pending invitations; --json prints the API body', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitations: [INVITATION] }));
    expect(await cli('org', 'invitations', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'GET', url: `${BASE}/invitations`, body: undefined }]);
    expect(JSON.parse(stdout)).toEqual({ invitations: [INVITATION] });
  });

  it('prints each invitation with its link', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitations: [INVITATION] }));
    expect(await cli('org', 'invitations')).toBe(0);
    expect(stdout).toMatch(/^ID\s+EMAIL\s+ROLE\s+EXPIRES\s+LINK/);
    expect(stdout).toMatch(/inv_1\s+cli-invite@parity.test\s+admin\s+2026-11-12T00:00:00.000Z\s+http:\/\/localhost:3210\/invitations\/inv_1/);
  });

  it('says so when nothing is pending', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitations: [] }));
    expect(await cli('org', 'invitations')).toBe(0);
    expect(stdout).toContain('No pending invitations.');
  });
});

describe('compute org invite', () => {
  it('refuses without -y when stdin is not a TTY, naming email and role, and sends nothing', async () => {
    expect(await cli('org', 'invite', 'cli-invite@parity.test', '--role', 'admin')).toBe(1);
    expect(stderr).toContain('cli-invite@parity.test');
    expect(stderr).toContain('admin');
    expect(stderr).toContain('Pass -y to confirm');
    expect(requests()).toEqual([]);
  });

  it('-y --json POSTs {email, role} and prints the API body', async () => {
    const res = { invitation: INVITATION, emailSent: false };
    fetchMock.mockResolvedValueOnce(json(res, 201));
    expect(await cli('org', 'invite', 'cli-invite@parity.test', '--role', 'admin', '-y', '--json')).toBe(0);
    expect(requests()).toEqual([
      { method: 'POST', url: `${BASE}/invitations`, body: { email: 'cli-invite@parity.test', role: 'admin' } },
    ]);
    expect(JSON.parse(stdout)).toEqual(res);
  });

  it('invites as member by default', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitation: { ...INVITATION, role: 'member' }, emailSent: true }, 201));
    expect(await cli('org', 'invite', 'cli-invite@parity.test', '--yes')).toBe(0);
    expect(requests()[0].body).toEqual({ email: 'cli-invite@parity.test', role: 'member' });
  });

  it('prints the link and says the email was not sent when emailSent is false', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitation: INVITATION, emailSent: false, emailError: 'Email is not configured' }, 201));
    expect(await cli('org', 'invite', 'cli-invite@parity.test', '--role', 'admin', '-y')).toBe(0);
    expect(stdout).toContain('Invited cli-invite@parity.test as admin');
    expect(stdout).toContain('http://localhost:3210/invitations/inv_1');
    expect(stdout).toMatch(/email was not sent/i);
    expect(stdout).toContain('Email is not configured');
  });

  it('says the email was sent and still prints the link', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitation: INVITATION, emailSent: true }, 201));
    expect(await cli('org', 'invite', 'cli-invite@parity.test', '--role', 'admin', '-y')).toBe(0);
    expect(stdout).toContain('Emailed cli-invite@parity.test');
    expect(stdout).toContain('http://localhost:3210/invitations/inv_1');
    expect(stdout).not.toMatch(/not sent/i);
  });

  it('refuses --role owner locally: owner invitations need the web app', async () => {
    expect(await cli('org', 'invite', 'cli-owner@parity.test', '--role', 'owner', '-y')).toBe(1);
    expect(stderr).toContain('Owner invitations require the web app');
    expect(requests()).toEqual([]);
  });

  it('rejects an unknown role and a malformed email without a request', async () => {
    expect(await cli('org', 'invite', 'a@parity.test', '--role', 'viewer', '-y', '--json')).toBe(1);
    expect(JSON.parse(stderr).error).toMatchObject({ code: 'invalid_argument', message: expect.stringContaining('member or admin') });
    stderr = '';
    expect(await cli('org', 'invite', 'not-an-email', '-y')).toBe(1);
    expect(stderr).toContain('not-an-email');
    expect(requests()).toEqual([]);
  });

  it('prompts on a TTY naming email and role; "n" sends nothing', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('n');
    expect(await cli('org', 'invite', 'tty-invite@parity.test')).toBe(1);
    expect(question).toHaveBeenCalledWith(expect.stringMatching(/tty-invite@parity.test.*member/));
    expect(requests()).toEqual([]);
    expect(stderr).toContain('nothing was changed');
  });

  it('prompts on a TTY; "y" creates the invitation and prints its link', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('y');
    fetchMock.mockResolvedValueOnce(json({ invitation: { ...INVITATION, email: 'tty-invite@parity.test', role: 'member' }, emailSent: false }, 201));
    expect(await cli('org', 'invite', 'tty-invite@parity.test')).toBe(0);
    expect(requests()).toHaveLength(1);
    expect(stdout).toContain('http://localhost:3210/invitations/inv_1');
  });

  it('renders a server refusal (duplicate) and exits 1', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'An invitation is already pending for this email', code: 'conflict' }, 409));
    expect(await cli('org', 'invite', 'cli-invite@parity.test', '-y')).toBe(1);
    expect(stderr).toContain('An invitation is already pending for this email');
  });
});

describe('compute org invitations cancel', () => {
  it('refuses without -y when stdin is not a TTY and sends nothing', async () => {
    expect(await cli('org', 'invitations', 'cancel', 'inv_1')).toBe(1);
    expect(stderr).toContain('Pass -y to confirm');
    expect(requests()).toEqual([]);
  });

  it('-y DELETEs the invitation; --json prints the API body', async () => {
    const res = { invitation: { ...INVITATION, status: 'canceled' } };
    fetchMock.mockResolvedValueOnce(json(res));
    expect(await cli('org', 'invitations', 'cancel', 'inv_1', '-y', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'DELETE', url: `${BASE}/invitations/inv_1`, body: undefined }]);
    expect(JSON.parse(stdout)).toEqual(res);
  });

  it('prints whose invitation was cancelled', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitation: { ...INVITATION, status: 'canceled' } }));
    expect(await cli('org', 'invitations', 'cancel', 'inv_1', '-y')).toBe(0);
    expect(stdout).toContain('Cancelled the invitation for cli-invite@parity.test');
  });
});

describe('compute org member set-role', () => {
  it('refuses without -y when stdin is not a TTY and changes nothing', async () => {
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    expect(await cli('org', 'member', 'set-role', 'temp1@parity.test', 'admin')).toBe(1);
    expect(stderr).toMatch(/-y/);
    expect(writes()).toEqual([]);
  });

  it('-y resolves an email to the member id and PATCHes {role}', async () => {
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    fetchMock.mockResolvedValueOnce(json({ member: { ...TEMP1, role: 'admin' } }));
    expect(await cli('org', 'member', 'set-role', 'TEMP1@parity.test', 'admin', '-y')).toBe(0);
    expect(requests()).toEqual([
      { method: 'GET', url: `${BASE}/members`, body: undefined },
      { method: 'PATCH', url: `${BASE}/members/mem_temp1`, body: { role: 'admin' } },
    ]);
    expect(stdout).toContain('temp1@parity.test is now admin');
  });

  it('accepts a member id; --json prints the API body', async () => {
    const res = { member: { ...TEMP1, role: 'admin' } };
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    fetchMock.mockResolvedValueOnce(json(res));
    expect(await cli('org', 'member', 'set-role', 'mem_temp1', 'admin', '-y', '--json')).toBe(0);
    expect(requests()[1]).toEqual({ method: 'PATCH', url: `${BASE}/members/mem_temp1`, body: { role: 'admin' } });
    expect(JSON.parse(stdout)).toEqual(res);
  });

  it('exits 1 with a no-such-member message', async () => {
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    expect(await cli('org', 'member', 'set-role', 'nobody@parity.test', 'admin', '-y')).toBe(1);
    expect(stderr).toContain('No member nobody@parity.test');
    expect(writes()).toEqual([]);
  });

  it('sends an owner target to the server and shows its 403', async () => {
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    fetchMock.mockResolvedValueOnce(json({ error: 'Owner role changes require the web app', code: 'forbidden' }, 403));
    expect(await cli('org', 'member', 'set-role', 'owner@parity.test', 'member', '-y')).toBe(1);
    expect(requests()[1]).toEqual({ method: 'PATCH', url: `${BASE}/members/mem_owner`, body: { role: 'member' } });
    expect(stderr).toContain('Error (403): Owner role changes require the web app');
  });

  it('refuses the owner role locally and rejects other roles', async () => {
    expect(await cli('org', 'member', 'set-role', 'temp1@parity.test', 'owner', '-y')).toBe(1);
    expect(stderr).toContain('Owner role changes require the web app');
    expect(await cli('org', 'member', 'set-role', 'temp1@parity.test', 'viewer', '-y')).toBe(1);
    expect(stderr).toContain('member or admin');
    expect(requests()).toEqual([]);
  });

  it('prompts on a TTY naming the member, the current role and the new role', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('y');
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    fetchMock.mockResolvedValueOnce(json({ member: { ...TEMP1, role: 'admin' } }));
    expect(await cli('org', 'member', 'set-role', 'temp1@parity.test', 'admin')).toBe(0);
    expect(question).toHaveBeenCalledWith(expect.stringMatching(/temp1@parity.test.*member.*admin/));
    expect(writes()).toHaveLength(1);
  });
});

describe('compute org member remove', () => {
  it('refuses without -y when stdin is not a TTY and removes nothing', async () => {
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    expect(await cli('org', 'member', 'remove', 'temp1@parity.test')).toBe(1);
    expect(stderr).toContain('Pass -y to confirm');
    expect(writes()).toEqual([]);
  });

  it('-y DELETEs the member and prints who was removed', async () => {
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    fetchMock.mockResolvedValueOnce(json({ removed: TEMP1 }));
    expect(await cli('org', 'member', 'remove', 'temp1@parity.test', '-y')).toBe(0);
    expect(requests()[1]).toEqual({ method: 'DELETE', url: `${BASE}/members/mem_temp1`, body: undefined });
    expect(stdout).toContain('Removed temp1@parity.test (member)');
  });

  it('--json prints the API body', async () => {
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    fetchMock.mockResolvedValueOnce(json({ removed: TEMP1 }));
    expect(await cli('org', 'member', 'remove', 'mem_temp1', '--yes', '--json')).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ removed: TEMP1 });
  });

  it('an owner target exits 1 with the server refusal', async () => {
    fetchMock.mockResolvedValueOnce(json(MEMBERS));
    fetchMock.mockResolvedValueOnce(json({ error: 'Owner role changes require the web app', code: 'forbidden' }, 403));
    expect(await cli('org', 'member', 'remove', 'owner@parity.test', '-y')).toBe(1);
    expect(stderr).toContain('Owner role changes require the web app');
  });
});

describe('compute org leave', () => {
  it('refuses an org API key locally: leave needs `compute login`', async () => {
    auth.apiKey = ORG_KEY;
    expect(await cli('org', 'leave', '-y')).toBe(1);
    expect(stderr).toContain('compute login');
    expect(requests()).toEqual([]);
  });

  it('refuses without -y when stdin is not a TTY', async () => {
    expect(await cli('org', 'leave')).toBe(1);
    expect(stderr).toContain('Pass -y to confirm');
    expect(requests()).toEqual([]);
  });

  it('-y POSTs leave and notes that the login may need renewing', async () => {
    fetchMock.mockResolvedValueOnce(json({ left: true }));
    expect(await cli('org', 'leave', '-y')).toBe(0);
    expect(requests()).toEqual([{ method: 'POST', url: `${BASE}/leave`, body: {} }]);
    expect(stdout).toContain('Left the organization');
    expect(stdout).toContain('compute login');
  });

  it('--org names the org in the prompt and sends X-Org-Slug; --json prints the API body', async () => {
    setTTY(true);
    question.mockResolvedValueOnce('yes');
    fetchMock.mockResolvedValueOnce(json({ left: true }));
    expect(await cli('org', 'leave', '--org', 'parity-owner', '--json')).toBe(0);
    expect(question).toHaveBeenCalledWith(expect.stringContaining('parity-owner'));
    expect(orgHeader()).toBe('parity-owner');
    expect(JSON.parse(stdout)).toEqual({ left: true });
  });

  it('renders the server user_credential_required refusal with a login hint', async () => {
    auth.apiKey = 'opaque-key-without-prefix';
    fetchMock.mockResolvedValueOnce(json(USER_CREDENTIAL_REQUIRED, 403));
    expect(await cli('org', 'leave', '-y', '--json')).toBe(1);
    expect(JSON.parse(stderr).error).toMatchObject({
      code: 'user_credential_required',
      httpStatus: 403,
      hint: expect.stringContaining('compute login'),
    });
  });

  it('the last owner sees the server refusal', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'The last owner of an organization cannot leave', code: 'forbidden' }, 403));
    expect(await cli('org', 'leave', '-y')).toBe(1);
    expect(stderr).toContain('The last owner of an organization cannot leave');
  });
});

describe('compute invitations', () => {
  it('GETs my invitations; --json prints the API body', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitations: [USER_INVITATION] }));
    expect(await cli('invitations', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'GET', url: '/api/v1/me/invitations', body: undefined }]);
    expect(JSON.parse(stdout)).toEqual({ invitations: [USER_INVITATION] });
  });

  it('prints the org slug and role of each invitation', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitations: [USER_INVITATION] }));
    expect(await cli('invitations')).toBe(0);
    expect(stdout).toMatch(/^ID\s+ORG\s+ROLE\s+EXPIRES/);
    expect(stdout).toMatch(/inv_1\s+parity-owner\s+admin\s+2026-11-12T00:00:00.000Z/);
    expect(stdout).toContain('compute invitations accept <id>');
  });

  it('says so when nothing is pending', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitations: [] }));
    expect(await cli('invitations')).toBe(0);
    expect(stdout).toContain('No pending invitations.');
  });

  it('refuses an org API key locally', async () => {
    auth.apiKey = ORG_KEY;
    expect(await cli('invitations')).toBe(1);
    expect(stderr).toContain('compute login');
    expect(requests()).toEqual([]);
  });

  it('show GETs one invitation', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitation: USER_INVITATION }));
    expect(await cli('invitations', 'show', 'inv_1', '--json')).toBe(0);
    expect(requests()).toEqual([{ method: 'GET', url: '/api/v1/invitations/inv_1', body: undefined }]);
    expect(JSON.parse(stdout)).toEqual({ invitation: USER_INVITATION });

    fetchMock.mockResolvedValueOnce(json({ invitation: USER_INVITATION }));
    stdout = '';
    expect(await cli('invitations', 'show', 'inv_1')).toBe(0);
    expect(stdout).toContain('parity-owner');
    expect(stdout).toContain('admin');
    expect(stdout).toContain('pending');
    expect(stdout).toContain('http://localhost:3210/invitations/inv_1');
  });

  it('show of someone else’s invitation exits 1 with the 404', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Invitation not found', code: 'not_found' }, 404));
    expect(await cli('invitations', 'show', 'inv_1')).toBe(1);
    expect(stderr).toContain('Invitation not found');
  });

  it('accept POSTs without a confirmation, even off a terminal', async () => {
    const res = { member: { ...TEMP1, role: 'admin' }, organization: USER_INVITATION.organization };
    fetchMock.mockResolvedValueOnce(json(res));
    expect(await cli('invitations', 'accept', 'inv_1')).toBe(0);
    expect(question).not.toHaveBeenCalled();
    expect(requests()).toEqual([{ method: 'POST', url: '/api/v1/invitations/inv_1/accept', body: {} }]);
    expect(stdout).toContain('Joined parity-owner as admin');
    expect(stdout).toContain('compute org use parity-owner');
  });

  it('accept takes -y and --json', async () => {
    const res = { member: TEMP1, organization: USER_INVITATION.organization };
    fetchMock.mockResolvedValueOnce(json(res));
    expect(await cli('invitations', 'accept', 'inv_1', '-y', '--json')).toBe(0);
    expect(JSON.parse(stdout)).toEqual(res);
  });

  it('accept refuses an org API key locally', async () => {
    auth.apiKey = ORG_KEY;
    expect(await cli('invitations', 'accept', 'inv_1', '-y')).toBe(1);
    expect(stderr).toContain('compute login');
    expect(requests()).toEqual([]);
  });

  it('accept renders the server user_credential_required refusal clearly', async () => {
    auth.apiKey = 'opaque-key-without-prefix';
    fetchMock.mockResolvedValueOnce(json(USER_CREDENTIAL_REQUIRED, 403));
    expect(await cli('invitations', 'accept', 'inv_1', '-y')).toBe(1);
    expect(stderr).toContain('Error (403 user_credential_required): User credential required');
    expect(stderr).toContain('compute login');
  });

  it('decline refuses without -y when stdin is not a TTY', async () => {
    expect(await cli('invitations', 'decline', 'inv_1')).toBe(1);
    expect(stderr).toContain('Pass -y to confirm');
    expect(requests()).toEqual([]);
  });

  it('decline -y POSTs decline', async () => {
    const res = { invitation: { ...USER_INVITATION, status: 'rejected' } };
    fetchMock.mockResolvedValueOnce(json(res));
    expect(await cli('invitations', 'decline', 'inv_1', '-y')).toBe(0);
    expect(requests()).toEqual([{ method: 'POST', url: '/api/v1/invitations/inv_1/decline', body: {} }]);
    expect(stdout).toContain('Declined the invitation to parity-owner');

    fetchMock.mockResolvedValueOnce(json(res));
    stdout = '';
    expect(await cli('invitations', 'decline', 'inv_1', '-y', '--json')).toBe(0);
    expect(JSON.parse(stdout)).toEqual(res);
  });

  it('decline refuses an org API key before asking', async () => {
    auth.apiKey = ORG_KEY;
    expect(await cli('invitations', 'decline', 'inv_1', '-y')).toBe(1);
    expect(stderr).toContain('compute login');
    expect(requests()).toEqual([]);
  });

  it('encodes ids into the path', async () => {
    fetchMock.mockResolvedValueOnce(json({ invitation: USER_INVITATION }));
    expect(await cli('invitations', 'show', 'a/b', '--json')).toBe(0);
    expect(requests()[0].url).toBe('/api/v1/invitations/a%2Fb');
  });
});

describe('command tree', () => {
  it('registers the org member and invitation commands', () => {
    const p = program();
    const org = p.commands.find((c) => c.name() === 'org')!;
    expect(org.commands.map((c) => c.name()).sort()).toEqual(['invitations', 'invite', 'leave', 'member', 'members']);
    const member = org.commands.find((c) => c.name() === 'member')!;
    expect(member.commands.map((c) => c.name()).sort()).toEqual(['remove', 'set-role']);
    expect(org.commands.find((c) => c.name() === 'invitations')!.commands.map((c) => c.name())).toEqual(['cancel']);
    const invitations = p.commands.find((c) => c.name() === 'invitations')!;
    expect(invitations.commands.map((c) => c.name()).sort()).toEqual(['accept', 'decline', 'show']);
  });
});
