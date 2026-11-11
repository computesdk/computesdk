// API fields reach the terminal through the human renderers; a platform the
// operator doesn't control (a PR preview behind --allow-untrusted-host) can put
// ANSI/OSC/C0 sequences in any of them. Every renderer here must strip them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printMembers, printOrgInvitations, printUserInvitations } from '../org-members.js';
import { printCosts } from '../sandbox-billing.js';
import { formatBranchRow } from '../actions-repos.js';
import { formatByokDetail, formatByokRow, formatByokVerify, type ByokProvider } from '../byok.js';

/** An OSC title-set plus a bell and an escape: what a hostile field would carry. */
const EVIL = 'x\u001b]0;pwned\u0007\u001b[2J';

function hasControl(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/.test(text);
}

let out: string;
beforeEach(() => {
  out = '';
  vi.spyOn(console, 'log').mockImplementation((...a) => void (out += a.join(' ') + '\n'));
});
afterEach(() => {
  vi.restoreAllMocks();
});

const rate = { usd: 0.1, per: 'hour' as const, rateUsd: { perSecond: 0.1 / 3600, perMinute: 0.1 / 60, perHour: 0.1 } };

describe('API fields never reach the terminal with control sequences', () => {
  it('org members and invitations: ids and timestamps', () => {
    printMembers({ members: [{ id: EVIL, userId: 'u', name: 'n', email: 'e@x.dev', role: 'member', createdAt: EVIL }] });
    const invitation = { id: EVIL, email: 'e@x.dev', role: 'member', status: 'pending', expiresAt: EVIL, createdAt: EVIL, inviterId: 'u', url: 'https://x' };
    printOrgInvitations({ invitations: [invitation] });
    printUserInvitations({ invitations: [{ ...invitation, organization: { id: 'o', name: 'Org', slug: 'org' } }] });
    expect(out).toContain('x');
    expect(hasControl(out)).toBe(false);
  });

  it('sandbox costs: provider and currency', () => {
    printCosts(
      {
        currency: EVIL,
        running: { count: 0, costUsd: 0 },
        settled: { count: 1, costUsd: 1 },
        totalUsd: 1,
        byProvider: [{ provider: EVIL, count: 1, costUsd: 1 }],
      },
      false,
    );
    expect(hasControl(out)).toBe(false);
  });

  it('branches: the latest run id', () => {
    const row = formatBranchRow({ ref: 'refs/heads/main', prNumber: null, watched: true, runCount: 1, latestRunId: EVIL, lastRunAt: new Date().toISOString() });
    expect(hasControl(row)).toBe(false);
  });

  it('byok: provider, regions, last tested and verify output', () => {
    const key = { provider: EVIL, keyHint: EVIL, lastCheckedAt: EVIL, status: 'connected' as const, statusDetail: EVIL, actCapable: false, credential: 'key' as const, fields: [] };
    const provider: ByokProvider = { provider: EVIL, regions: [EVIL], key, rate, customRate: null, platformRate: rate };
    const text = [formatByokRow(provider), formatByokDetail(provider), formatByokVerify({ key, verified: false })].join('\n');
    expect(hasControl(text)).toBe(false);
  });
});
