/**
 * `compute org members|invitations|invite|member set-role|member remove|leave`
 * and `compute invitations [show|accept|decline]` — the org's members and
 * invitations over the v1 organization routes, and the signed-in user's own
 * invitations.
 *
 * Org routes are called with the `current` org alias: the server resolves the
 * credential's org (an org API key's own org, or for a user login the org
 * `--org`/`COMPUTE_ORG` names through X-Org-Slug, else the active org).
 *
 * Writes that change who is in the org (invite, cancel, role change, remove,
 * leave, decline) ask for confirmation on a terminal and need `-y` elsewhere.
 * Accept has no confirmation: it is the invitee's own answer. Leave, accept,
 * decline and the user's own invitations need a user login; an org API key is
 * refused locally, and the server's `user_credential_required` is rendered
 * with the same hint for keys this CLI cannot recognise.
 */

import type { Command } from 'commander';
import pc from 'picocolors';
import {
  ActionsApiError,
  ActionsCliError,
  ActionsClient,
  codeForStatus,
  resolveActionsAuth,
  toErrorEnvelope,
} from './actions-client.js';
import { output, usageErrorOutput, type CommonOpts } from './actions.js';
import { confirmWrite } from './confirm.js';
import { safeTerm } from './term.js';

// Wire shapes: benchmarks-platform v1 organization member/invitation routes
// (research design F-ORG-2 / F-ORG-3).

export interface OrgMember {
  id: string;
  userId: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: string;
}

export interface OrgInvitation {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'rejected' | 'canceled' | (string & {});
  expiresAt: string;
  createdAt: string;
  inviterId: string;
  url: string;
}

export interface UserInvitation extends OrgInvitation {
  organization: { id: string; name: string; slug: string };
}

export interface InviteResponse {
  invitation: OrgInvitation;
  emailSent: boolean;
  emailError?: string;
}

export interface AcceptResponse {
  member: OrgMember;
  organization: { id: string; name: string; slug: string };
}

type WriteOpts = CommonOpts & { yes?: boolean };

const ORG_PATH = '/api/v1/organizations/current';
const MEMBER_ROLES = ['member', 'admin'] as const;
type MemberRole = (typeof MEMBER_ROLES)[number];

const USER_LOGIN_HINT =
  'This needs a user login, and org API keys have no user: run `compute login`, and drop --api-key / unset COMPUTE_API_KEY.';

/** Org API keys carry these prefixes; OAuth and session tokens do not. */
export function isOrgApiKey(key: string): boolean {
  return /^(bp|csdk)_/.test(key);
}

const segment = (id: string) => encodeURIComponent(id);

function orgName(opts: CommonOpts): string | undefined {
  return opts.org || process.env.COMPUTE_ORG || undefined;
}

async function orgClient(opts: CommonOpts): Promise<ActionsClient> {
  return new ActionsClient(await resolveActionsAuth(opts));
}

async function userClient(opts: CommonOpts, what: string): Promise<ActionsClient> {
  const auth = await resolveActionsAuth(opts);
  if (isOrgApiKey(auth.apiKey)) {
    throw new ActionsCliError(
      'user_credential_required',
      `${what} needs a user login, and org API keys have no user. Run \`compute login\`, and drop --api-key / unset COMPUTE_API_KEY.`,
    );
  }
  return new ActionsClient(auth);
}

function apiHint(error: ActionsApiError): string | undefined {
  const body = error.body;
  if (body && typeof body === 'object' && typeof (body as { hint?: unknown }).hint === 'string') {
    return (body as { hint: string }).hint;
  }
  return error.code === 'user_credential_required' ? USER_LOGIN_HINT : undefined;
}

/**
 * Like `actions.ts` `fail`, plus the platform's `hint` (in the envelope and on
 * its own line) and the error code when the server sent one more specific
 * than the status implies.
 */
function fail(error: unknown, opts: CommonOpts = {}): never {
  const hint = error instanceof ActionsApiError ? apiHint(error) : undefined;
  if (opts.json) {
    const envelope = toErrorEnvelope(error) as ReturnType<typeof toErrorEnvelope> & { error: { hint?: string } };
    if (hint) envelope.error.hint = hint;
    process.stderr.write(JSON.stringify(envelope) + '\n');
  } else if (error instanceof ActionsApiError) {
    const code = error.code !== codeForStatus(error.status) ? ` ${error.code}` : '';
    console.error(pc.red(`Error (${error.status}${code}): ${error.message}`));
    if (hint) console.error(pc.dim(`hint: ${hint}`));
  } else {
    console.error(pc.red(`Error: ${error instanceof Error ? error.message : String(error)}`));
  }
  process.exit(1);
}

function memberRole(role: string, ownerMessage: string): MemberRole {
  if (role === 'owner') throw new ActionsCliError('invalid_argument', ownerMessage);
  if (!(MEMBER_ROLES as readonly string[]).includes(role)) {
    throw new ActionsCliError('invalid_argument', `Invalid role "${role}" — use member or admin.`);
  }
  return role as MemberRole;
}

function printTable(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(header));
  for (const row of rows) console.log(line(row));
}

export function printMembers(res: { members: OrgMember[] }): void {
  if (res.members.length === 0) {
    console.log('No members.');
    return;
  }
  printTable(
    ['EMAIL', 'ROLE', 'NAME', 'MEMBER ID', 'JOINED'],
    res.members.map((m) => [safeTerm(m.email), safeTerm(m.role), safeTerm(m.name ?? '—'), safeTerm(m.id), safeTerm(m.createdAt)]),
  );
}

export function printOrgInvitations(res: { invitations: OrgInvitation[] }): void {
  if (res.invitations.length === 0) {
    console.log('No pending invitations.');
    return;
  }
  printTable(
    ['ID', 'EMAIL', 'ROLE', 'EXPIRES', 'LINK'],
    res.invitations.map((i) => [safeTerm(i.id), safeTerm(i.email), safeTerm(i.role), safeTerm(i.expiresAt), safeTerm(i.url)]),
  );
}

export function printUserInvitations(res: { invitations: UserInvitation[] }): void {
  if (res.invitations.length === 0) {
    console.log('No pending invitations.');
    return;
  }
  printTable(
    ['ID', 'ORG', 'ROLE', 'EXPIRES', 'ORG NAME'],
    res.invitations.map((i) => [
      safeTerm(i.id),
      safeTerm(i.organization.slug),
      safeTerm(i.role),
      safeTerm(i.expiresAt),
      safeTerm(i.organization.name),
    ]),
  );
  console.log(pc.dim('Accept with `compute invitations accept <id>`; decline with `compute invitations decline <id> -y`.'));
}

function printInvitationDetail(inv: UserInvitation): void {
  const rows: Array<[string, string]> = [
    ['invitation', safeTerm(inv.id)],
    ['org', `${safeTerm(inv.organization.slug)} (${safeTerm(inv.organization.name)})`],
    ['email', safeTerm(inv.email)],
    ['role', safeTerm(inv.role)],
    ['status', safeTerm(inv.status)],
    ['expires', safeTerm(inv.expiresAt)],
    ['link', safeTerm(inv.url)],
  ];
  for (const [k, v] of rows) console.log(`${k.padEnd(10)}  ${v}`);
}

function printInvite(res: InviteResponse): void {
  const inv = res.invitation;
  console.log(`Invited ${safeTerm(inv.email)} as ${safeTerm(inv.role)} (invitation ${safeTerm(inv.id)}, expires ${safeTerm(inv.expiresAt)}).`);
  if (res.emailSent) {
    console.log(`Emailed ${safeTerm(inv.email)} the invitation link.`);
  } else {
    const reason = res.emailError ? ` (${safeTerm(res.emailError)})` : '';
    console.log(pc.yellow(`The invitation email was not sent${reason}; share the link instead.`));
  }
  console.log(`Link: ${safeTerm(inv.url)}`);
}

/** A member by id, user id or email (case-insensitive). */
export function findMember(members: OrgMember[], ref: string): OrgMember | undefined {
  const lower = ref.toLowerCase();
  return (
    members.find((m) => m.id === ref) ??
    members.find((m) => m.userId === ref) ??
    members.find((m) => m.email.toLowerCase() === lower)
  );
}

async function resolveMember(c: ActionsClient, ref: string, opts: CommonOpts): Promise<OrgMember> {
  const { members } = await c.get<{ members: OrgMember[] }>(`${ORG_PATH}/members`);
  const member = findMember(members, ref);
  if (!member) {
    const org = orgName(opts);
    throw new ActionsCliError('not_found', `No member ${ref} in ${org ? `org ${org}` : 'this organization'}.`);
  }
  return member;
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;

/**
 * `common` adds the shared platform flags; every command here sends its usage
 * errors through the `--json` envelope.
 */
function command(parent: Command, name: string): Command {
  return parent.command(name).configureOutput({ outputError: usageErrorOutput });
}

function common(cmd: Command): Command {
  return cmd
    .option('--api-key <key>', 'API key (default: $COMPUTE_API_KEY)')
    .option('--base-url <url>', 'API base URL (default: https://platform.computesdk.com)')
    .option('--org <slug>', 'organization slug for this command, for a user login (or $COMPUTE_ORG)')
    .option('--allow-untrusted-host', 'send an explicit --api-key/env key to a non-computesdk, non-localhost --base-url (stored login credentials are never sent)')
    .option('--json', 'print machine-readable JSON');
}

/** Registers the member and invitation commands on the existing `compute org` group. */
export function registerOrgMemberCommands(org: Command): void {
  common(
    command(org, 'members').description("List the organization's members with their roles"),
  ).action(async (opts: CommonOpts) => {
    try {
      const c = await orgClient(opts);
      output(opts, await c.get<{ members: OrgMember[] }>(`${ORG_PATH}/members`), printMembers);
    } catch (e) {
      fail(e, opts);
    }
  });

  const invitations = common(
    command(org, 'invitations')
      .description("List the organization's pending invitations with their links (owner/admin)")
      .allowExcessArguments(false),
  ).action(async (opts: CommonOpts) => {
    try {
      const c = await orgClient(opts);
      output(opts, await c.get<{ invitations: OrgInvitation[] }>(`${ORG_PATH}/invitations`), printOrgInvitations);
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    command(invitations, 'cancel')
      .description('Cancel a pending invitation; its link stops working (owner/admin)')
      .argument('<invitationId>', 'invitation id (see `compute org invitations`)')
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (invitationId: string, opts: WriteOpts) => {
    try {
      await confirmWrite(`Cancel invitation ${invitationId}? Its link stops working.`, opts);
      const c = await orgClient(opts);
      const res = await c.del<{ invitation: OrgInvitation }>(`${ORG_PATH}/invitations/${segment(invitationId)}`);
      output(opts, res, (r) =>
        console.log(`Cancelled the invitation for ${safeTerm(r.invitation.email)} (${r.invitation.id}).`),
      );
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    command(org, 'invite')
      .description('Invite someone to the organization by email and print the invite link (owner/admin)')
      .argument('<email>', 'email address to invite')
      .option('--role <role>', 'member | admin (owners are invited in the web app)', 'member')
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (email: string, opts: WriteOpts & { role: string }) => {
    try {
      const role = memberRole(opts.role, 'Owner invitations require the web app.');
      if (!EMAIL.test(email)) {
        throw new ActionsCliError('invalid_argument', `Invalid email "${email}".`);
      }
      const target = orgName(opts);
      await confirmWrite(`Invite ${email} as ${role}${target ? ` to ${target}` : ''}?`, opts);
      const c = await orgClient(opts);
      output(opts, await c.post<InviteResponse>(`${ORG_PATH}/invitations`, { email, role }), printInvite);
    } catch (e) {
      fail(e, opts);
    }
  });

  const member = command(org, 'member').description("Change a member's role or remove a member (owner/admin)");

  common(
    command(member, 'set-role')
      .description("Change a member's role between member and admin (owner roles change in the web app)")
      .argument('<member>', 'member id or email (see `compute org members`)')
      .argument('<role>', 'member | admin')
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (ref: string, roleArg: string, opts: WriteOpts) => {
    try {
      const role = memberRole(roleArg, 'Owner role changes require the web app.');
      const c = await orgClient(opts);
      const target = await resolveMember(c, ref, opts);
      await confirmWrite(`Change ${target.email} from ${target.role} to ${role}?`, opts);
      const res = await c.patch<{ member: OrgMember }>(`${ORG_PATH}/members/${segment(target.id)}`, { role });
      output(opts, res, (r) => console.log(`${safeTerm(r.member.email)} is now ${safeTerm(r.member.role)}.`));
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    command(member, 'remove')
      .alias('rm')
      .description('Remove a member from the organization (owners are removed in the web app)')
      .argument('<member>', 'member id or email (see `compute org members`)')
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (ref: string, opts: WriteOpts) => {
    try {
      const c = await orgClient(opts);
      const target = await resolveMember(c, ref, opts);
      const org = orgName(opts);
      await confirmWrite(
        `Remove ${target.email} (${target.role}) from ${org ?? 'the organization'}? They lose access at once.`,
        opts,
      );
      const res = await c.del<{ removed: OrgMember }>(`${ORG_PATH}/members/${segment(target.id)}`);
      output(opts, res, (r) =>
        console.log(`Removed ${safeTerm(r.removed.email)} (${safeTerm(r.removed.role)}) from ${org ?? 'the organization'}.`),
      );
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    command(org, 'leave')
      .description('Leave the organization (needs a user login; the last owner cannot leave)')
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (opts: WriteOpts) => {
    try {
      const c = await userClient(opts, '`compute org leave`');
      const org = orgName(opts);
      await confirmWrite(`Leave ${org ?? 'the active organization'}? You lose access to it at once.`, opts);
      const res = await c.post<{ left: true }>(`${ORG_PATH}/leave`, {});
      output(opts, res, () => {
        console.log(`Left ${org ?? 'the organization'}.`);
        // Leaving revokes the user's OAuth grants for that org, so a login
        // granted through it stops working on the next call.
        console.log(
          pc.dim('If your login was granted for that organization, it no longer works: run `compute login` again.'),
        );
      });
    } catch (e) {
      fail(e, opts);
    }
  });
}

/** `compute invitations [show|accept|decline]` — the signed-in user's own invitations. */
export function registerInvitationsCommands(program: Command): void {
  const invitations = common(
    command(program, 'invitations')
      .description('Your pending invitations to other organizations (needs a user login)')
      .allowExcessArguments(false),
  ).action(async (opts: CommonOpts) => {
    try {
      const c = await userClient(opts, '`compute invitations`');
      output(opts, await c.get<{ invitations: UserInvitation[] }>('/api/v1/me/invitations'), printUserInvitations);
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    command(invitations, 'show')
      .description('Show one of your invitations')
      .argument('<invitationId>', 'invitation id (see `compute invitations`)'),
  ).action(async (invitationId: string, opts: CommonOpts) => {
    try {
      const c = await userClient(opts, '`compute invitations show`');
      const res = await c.get<{ invitation: UserInvitation }>(`/api/v1/invitations/${segment(invitationId)}`);
      output(opts, res, (r) => printInvitationDetail(r.invitation));
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    command(invitations, 'accept')
      .description('Accept an invitation and join its organization (no confirmation)')
      .argument('<invitationId>', 'invitation id (see `compute invitations`)')
      .option('-y, --yes', 'accepted for symmetry with decline; accept never asks'),
  ).action(async (invitationId: string, opts: WriteOpts) => {
    try {
      const c = await userClient(opts, '`compute invitations accept`');
      const res = await c.post<AcceptResponse>(`/api/v1/invitations/${segment(invitationId)}/accept`, {});
      output(opts, res, (r) => {
        const slug = safeTerm(r.organization.slug);
        console.log(`Joined ${slug} as ${safeTerm(r.member.role)}.`);
        console.log(pc.dim(`Switch to it with \`compute org use ${slug}\`, or pass --org ${slug}.`));
      });
    } catch (e) {
      fail(e, opts);
    }
  });

  common(
    command(invitations, 'decline')
      .description('Decline an invitation')
      .argument('<invitationId>', 'invitation id (see `compute invitations`)')
      .option('-y, --yes', 'skip the confirmation'),
  ).action(async (invitationId: string, opts: WriteOpts) => {
    try {
      const c = await userClient(opts, '`compute invitations decline`');
      await confirmWrite(`Decline invitation ${invitationId}? Its link stops working.`, opts);
      const res = await c.post<{ invitation: OrgInvitation & Partial<Pick<UserInvitation, 'organization'>> }>(
        `/api/v1/invitations/${segment(invitationId)}/decline`,
        {},
      );
      output(opts, res, (r) => {
        const org = r.invitation.organization?.slug;
        console.log(org ? `Declined the invitation to ${safeTerm(org)}.` : `Declined invitation ${r.invitation.id}.`);
      });
    } catch (e) {
      fail(e, opts);
    }
  });
}
