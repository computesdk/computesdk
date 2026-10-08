import { describe, it, expect } from 'vitest';
import {
  credentialBody,
  credentialEnvVar,
  credentialValues,
  formatBook,
  formatListingRow,
  formatListingStatus,
  formatProviderStatus,
  formatRate,
  formatReplacedFill,
  formatSettlementRow,
  formatUsd,
  listingPatchBody,
  parseCapacity,
  parseExpiresIn,
  parseMarketLane,
  parseRate,
  replaceTarget,
  sellBody,
  type MarketAsk,
  type MarketCredentialField,
  type MarketOrderBook,
  type MarketProvider,
  type MarketSettlement,
} from '../market.js';

const ASK: MarketAsk = {
  id: 'a-1',
  provider: 'tensorlake',
  region: 'us-east-1',
  size: 'medium',
  resources: { cpus: 2, memoryMb: 4096 },
  usd: 0.12,
  per: 'second',
  takeBps: 500,
  maxConcurrent: 4,
  status: 'live',
  live: true,
  expiresAt: null,
  rollover: false,
  pendingUsd: null,
  pendingPer: null,
  createdAt: '2026-09-29T12:00:00.000Z',
  updatedAt: '2026-09-29T12:00:00.000Z',
};

const FIELDS: MarketCredentialField[] = [
  { name: 'apiKey', label: 'API key', secret: true },
  { name: 'workspace', label: 'Workspace', secret: false },
];

const PROVIDER: MarketProvider = {
  id: 'mp-1',
  name: 'Acme Compute',
  provider: 'blaxel',
  organizationId: 'org-1',
  keyHint: 'org key',
  executorCredentialConnected: true,
  revokedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  sizes: [
    { name: 'small', label: '1 vCPU · 1 GB', resources: { cpus: 1, memoryMb: 1024 } },
    { name: 'medium', label: '2 vCPU · 4 GB', resources: { cpus: 2, memoryMb: 4096 } },
  ],
  regions: ['us-east-1', 'eu-west-1'],
  credentialFields: FIELDS,
};

describe('parseRate', () => {
  it('requires a unit — a bare usd is rejected', () => {
    expect(() => parseRate('0.12', undefined)).toThrow('needs a unit');
    expect(parseRate('0.12/second', undefined)).toEqual({ usd: 0.12, per: 'second' });
    expect(parseRate('0.12/hour', undefined)).toEqual({ usd: 0.12, per: 'hour' });
    expect(parseRate('0.12', 'second')).toEqual({ usd: 0.12, per: 'second' });
  });

  it('accepts minute and hour', () => {
    expect(parseRate('1.5', 'minute')).toEqual({ usd: 1.5, per: 'minute' });
    expect(parseRate('10', 'hour')).toEqual({ usd: 10, per: 'hour' });
    expect(parseRate('10/minute', undefined)).toEqual({ usd: 10, per: 'minute' });
  });

  it('rejects a conflicting --per', () => {
    expect(() => parseRate('1/hour', 'minute')).toThrow('conflicts');
  });

  it('requires a price', () => {
    expect(() => parseRate(undefined, undefined)).toThrow('--price');
  });

  it('rejects non-positive and non-numeric prices', () => {
    for (const bad of ['0/hour', '-1/hour', 'abc/hour', '1.2.3/hour', '/hour']) {
      expect(() => parseRate(bad, undefined)).toThrow('Invalid --price');
    }
  });

  it('rejects an unknown unit', () => {
    expect(() => parseRate('1/day', undefined)).toThrow('must be second, minute, or hour');
    expect(() => parseRate('1', 'day')).toThrow('must be second, minute, or hour');
  });
});

describe('parseMarketLane', () => {
  it('defaults to the actions lane', () => {
    expect(parseMarketLane(undefined)).toBe('actions');
  });

  it('accepts actions and sandbox and rejects anything else', () => {
    expect(parseMarketLane('actions')).toBe('actions');
    expect(parseMarketLane('sandbox')).toBe('sandbox');
    expect(() => parseMarketLane('everything')).toThrow('--use-case must be');
  });
});

describe('parseCapacity', () => {
  it('is undefined when absent', () => {
    expect(parseCapacity(undefined)).toBeUndefined();
  });

  it('parses a positive integer', () => {
    expect(parseCapacity('4')).toBe(4);
  });

  it('rejects zero, negatives, and non-integers', () => {
    for (const bad of ['0', '-2', '1.5', 'x']) {
      expect(() => parseCapacity(bad)).toThrow('Invalid --capacity');
    }
  });
});

describe('parseExpiresIn', () => {
  it('is undefined when absent', () => {
    expect(parseExpiresIn(undefined)).toBeUndefined();
  });

  it('parses fractional hours', () => {
    expect(parseExpiresIn('0.5')).toBe(0.5);
  });

  it('rejects non-positive values', () => {
    expect(() => parseExpiresIn('0')).toThrow('Invalid --expires-in');
    expect(() => parseExpiresIn('-3')).toThrow('Invalid --expires-in');
  });
});

describe('sellBody', () => {
  it('builds a minimal create body', () => {
    expect(sellBody({ size: 'medium', price: '0.12/second' })).toEqual({
      size: 'medium',
      useCase: 'actions',
      usd: 0.12,
      per: 'second',
    });
  });

  it('carries every option through to the API field names', () => {
    expect(
      sellBody({
        size: 'large',
        price: '2',
        per: 'hour',
        region: 'us-east-1',
        capacity: '8',
        expiresIn: '24',
        renew: true,
      }),
    ).toEqual({
      size: 'large',
      useCase: 'actions',
      region: 'us-east-1',
      usd: 2,
      per: 'hour',
      maxConcurrent: 8,
      expiresInHours: 24,
      rollover: true,
    });
  });

  it('posts to the sandbox lane when asked', () => {
    expect(
      sellBody({ size: 'large', price: '0.5/second', useCase: 'sandbox' }),
    ).toEqual({
      size: 'large',
      useCase: 'sandbox',
      usd: 0.5,
      per: 'second',
    });
  });

  it('rejects --renew on a standing listing', () => {
    expect(() => sellBody({ size: 'medium', price: '1/second', renew: true })).toThrow(
      '--renew requires --expires-in',
    );
  });
});

describe('listingPatchBody', () => {
  it('builds a reprice body', () => {
    expect(listingPatchBody('a-1', { price: '0.08/second' })).toEqual({
      askId: 'a-1',
      usd: 0.08,
      per: 'second',
    });
  });

  it('builds pause and resume bodies', () => {
    expect(listingPatchBody('a-1', { status: 'paused' })).toEqual({
      askId: 'a-1',
      status: 'paused',
    });
    expect(listingPatchBody('a-1', { status: 'live' })).toEqual({
      askId: 'a-1',
      status: 'live',
    });
  });

  it('builds a capacity body', () => {
    expect(listingPatchBody('a-1', { capacity: '3' })).toEqual({
      askId: 'a-1',
      maxConcurrent: 3,
    });
  });

  it('combines price and capacity', () => {
    expect(listingPatchBody('a-1', { price: '0.5', per: 'minute', capacity: '2' })).toEqual({
      askId: 'a-1',
      usd: 0.5,
      per: 'minute',
      maxConcurrent: 2,
    });
  });

  it('rejects an empty change', () => {
    expect(() => listingPatchBody('a-1', {})).toThrow('Nothing to change');
  });
});

describe('credentialEnvVar', () => {
  it('maps provider + field to an upper-snake env name', () => {
    expect(credentialEnvVar('tensorlake', 'apiKey')).toBe('TENSORLAKE_API_KEY');
    expect(credentialEnvVar('blaxel', 'workspace')).toBe('BLAXEL_WORKSPACE');
    expect(credentialEnvVar('namespace', 'token')).toBe('NAMESPACE_TOKEN');
    expect(credentialEnvVar('archil', 'region')).toBe('ARCHIL_REGION');
  });
});

describe('credentialValues', () => {
  it('reads each field from its env var', () => {
    const env = { BLAXEL_API_KEY: 'key-1', BLAXEL_WORKSPACE: 'ws-1' };
    const r = credentialValues('blaxel', FIELDS, {}, env);
    expect(r.values).toEqual({ apiKey: 'key-1', workspace: 'ws-1' });
    expect(r.missing).toEqual([]);
    expect(r.fromFlag).toEqual([]);
  });

  it('lets --field override the env var', () => {
    const env = { BLAXEL_API_KEY: 'env-key', BLAXEL_WORKSPACE: 'env-ws' };
    const r = credentialValues('blaxel', FIELDS, { apiKey: 'flag-key' }, env);
    expect(r.values).toEqual({ apiKey: 'flag-key', workspace: 'env-ws' });
    expect(r.fromFlag).toEqual(['apiKey']);
  });

  it('reports required fields with no value as missing', () => {
    const r = credentialValues('blaxel', FIELDS, {}, {});
    expect(r.missing.map((f) => f.name)).toEqual(['apiKey', 'workspace']);
    expect(r.envNames.apiKey).toBe('BLAXEL_API_KEY');
  });

  it('treats empty strings as missing', () => {
    const r = credentialValues('blaxel', FIELDS, { apiKey: '  ' }, { BLAXEL_WORKSPACE: 'ws' });
    expect(r.missing.map((f) => f.name)).toEqual(['apiKey']);
  });

  it('does not require optional fields', () => {
    const fields: MarketCredentialField[] = [
      { name: 'apiKey', label: 'API key', secret: true },
      { name: 'region', label: 'Region', secret: false, required: false },
    ];
    const r = credentialValues('archil', fields, {}, { ARCHIL_API_KEY: 'k' });
    expect(r.missing).toEqual([]);
    expect(r.values).toEqual({ apiKey: 'k' });
  });

  it('rejects an undeclared --field name', () => {
    expect(() =>
      credentialValues('blaxel', FIELDS, { bogus: 'x' }, { BLAXEL_API_KEY: 'k' }),
    ).toThrow('no credential field');
  });
});

describe('credentialBody', () => {
  it('sends {key} for a single-field executor', () => {
    const fields: MarketCredentialField[] = [
      { name: 'apiKey', label: 'API key', secret: true },
    ];
    expect(credentialBody(fields, { apiKey: 'k' })).toEqual({ key: 'k' });
  });

  it('sends {fields} for a multi-field executor', () => {
    expect(
      credentialBody(FIELDS, { apiKey: 'k', workspace: 'w' }),
    ).toEqual({ fields: { apiKey: 'k', workspace: 'w' } });
  });
});

describe('formatUsd / formatRate', () => {
  it('trims trailing zeros', () => {
    expect(formatUsd(0.12)).toBe('$0.12');
    expect(formatUsd(5)).toBe('$5');
    expect(formatUsd(0.00005)).toBe('$0.00005');
  });

  it('renders a rate', () => {
    expect(formatRate(0.12, 'second')).toBe('$0.12/second');
  });
});

describe('formatListingStatus', () => {
  it('labels each status', () => {
    expect(formatListingStatus({ ...ASK })).toContain('live');
    expect(formatListingStatus({ ...ASK, status: 'paused' })).toContain('paused');
    expect(formatListingStatus({ ...ASK, status: 'withdrawn' })).toContain('withdrawn');
  });

  it('labels a live-status ask past its expiry as expired', () => {
    expect(formatListingStatus({ ...ASK, live: false })).toContain('expired');
  });

  it('shows a queued rate for the next window', () => {
    const s = formatListingStatus({ ...ASK, pendingUsd: 0.08, pendingPer: 'second' });
    expect(s).toContain('$0.08/second');
  });
});

describe('formatListingRow', () => {
  it('shows id, size, region, rate, capacity, and standing expiry', () => {
    const row = formatListingRow(ASK);
    expect(row).toContain('a-1');
    expect(row).toContain('medium');
    expect(row).toContain('us-east-1');
    expect(row).toContain('$0.12/second');
    expect(row).toContain('×4');
    expect(row).toContain('standing');
  });
});

describe('formatProviderStatus', () => {
  it('shows identity, credential, sizes, and regions', () => {
    const out = formatProviderStatus(PROVIDER);
    expect(out).toContain('Acme Compute');
    expect(out).toContain('blaxel');
    expect(out).toContain('connected');
    expect(out).toContain('medium (2 vCPU · 4 GB)');
    expect(out).toContain('eu-west-1');
  });

  it('warns when the credential is not connected', () => {
    const out = formatProviderStatus({ ...PROVIDER, executorCredentialConnected: false });
    expect(out).toContain('not connected');
    expect(out).toContain('credential connect');
  });
});

describe('formatBook', () => {
  const BOOK: MarketOrderBook = {
    asks: [
      {
        id: 'a-1',
        provider: 'tensorlake',
        providerName: 'Acme Compute',
        region: 'us-east-1',
        size: 'medium',
        usd: 0.1,
        per: 'second',
        takeBps: 500,
        maxConcurrent: 2,
        expiresAt: null,
        rollover: false,
        updatedAt: '2026-09-29T12:00:00.000Z',
      },
    ],
    bids: [
      {
        id: 'b-1',
        organizationId: 'org-9',
        size: 'medium',
        region: null,
        maxUsd: 0.09,
        per: 'second',
        createdAt: '2026-09-29T11:00:00.000Z',
        expiresAt: null,
      },
    ],
    fills: [
      {
        id: 'f-1',
        askId: 'a-1',
        provider: 'tensorlake',
        size: 'medium',
        region: 'us-east-1',
        usd: 0.1,
        per: 'second',
        status: 'live' as const,
        createdAt: '2026-09-29T12:30:00.000Z',
      },
    ],
    prices: [],
  };

  it('labels both sides plainly', () => {
    const out = formatBook(BOOK);
    expect(out).toContain("sellers' asking prices");
    expect(out).toContain('buyer offers');
    expect(out).toContain('recent sales');
    expect(out).toContain('Acme Compute');
    expect(out).toContain('$0.1/second');
    expect(out).toContain('pays up to $0.09/second');
  });

  it('shows empty states', () => {
    const out = formatBook({ asks: [], bids: [], fills: [], prices: [] });
    expect(out).toContain('no listings are live');
    expect(out).toContain('no open offers');
    expect(out).toContain('nothing has sold yet');
  });

  it('marks a replaced sale and shows the sale id for --fill', () => {
    const out = formatBook({
      ...BOOK,
      fills: [{ ...BOOK.fills[0], status: 'replaced' as const }],
    });
    expect(out).toContain('replaced');
    expect(out).toContain('f-1');
  });
});

describe('replaceTarget', () => {
  it('evicts a whole listing by default', () => {
    expect(replaceTarget('a-1', undefined)).toEqual({
      path: '/api/v1/market/listings/a-1/replace',
      scope: 'listing',
    });
  });

  it('targets one sale with --fill', () => {
    expect(replaceTarget('a-1', 'f-1')).toEqual({
      path: '/api/v1/market/fills/f-1/replace',
      scope: 'fill',
    });
  });

  it('requires a target', () => {
    expect(() => replaceTarget(undefined, undefined)).toThrow('Nothing to replace');
  });
});

describe('formatReplacedFill', () => {
  it('shows the seconds-lived settle and a re-placed job', () => {
    const out = formatReplacedFill({
      fillId: 'f-1',
      askId: 'a-1',
      settledMicroUsd: 300,
      jobRequeued: true,
    });
    expect(out).toContain('f-1');
    expect(out).toContain('$0.0003');
    expect(out).toContain('re-places');
  });

  it('omits the job note for a router sale', () => {
    const out = formatReplacedFill({
      fillId: 'f-2',
      askId: 'a-1',
      settledMicroUsd: 0,
      jobRequeued: false,
    });
    expect(out).not.toContain('re-places');
  });
});

describe('formatSettlementRow', () => {
  const SETTLEMENT: MarketSettlement = {
    id: 's-1',
    providerId: 'mp-1',
    provider: 'Acme Compute',
    periodStart: '2026-08-01T00:00:00.000Z',
    periodEnd: '2026-09-01T00:00:00.000Z',
    vcpuSeconds: 1_234_567,
    grossUsd: 12.5,
    netUsd: 11.875,
    grossMicroUsd: 12_500_000,
    netMicroUsd: 11_875_000,
    invoiceRef: null,
    paidAt: '2026-09-05T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  it('shows the period, volume, totals, and paid state', () => {
    const row = formatSettlementRow(SETTLEMENT);
    expect(row).toContain('2026-08-01');
    expect(row).toContain('2026-09-01');
    expect(row).toContain('1,234,567 vCPU·s');
    expect(row).toContain('gross $12.5');
    expect(row).toContain('net $11.875');
    expect(row).toContain('paid 2026-09-05');
  });

  it('shows invoiced and unpaid states', () => {
    expect(
      formatSettlementRow({ ...SETTLEMENT, paidAt: null, invoiceRef: 'inv-7' }),
    ).toContain('invoiced inv-7');
    expect(
      formatSettlementRow({ ...SETTLEMENT, paidAt: null, invoiceRef: null }),
    ).toContain('unpaid');
  });
});
