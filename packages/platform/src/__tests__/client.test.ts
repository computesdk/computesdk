import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PlatformApiError,
  PlatformClient,
  PlatformClientError,
  codeForStatus,
  errorDetails,
  isSecurePlatformTransport,
  isTrustedPlatformHost,
  resolvePlatformAuth,
  toErrorEnvelope,
} from '../client.js';

const ENV = [
  'COMPUTE_API_KEY',
  'COMPUTE_PLATFORM_URL',
  'BENCHMARKS_PLATFORM_API_KEY',
  'BENCHMARKS_PLATFORM_URL',
  'COMPUTE_ORG',
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const noStored = async () => ({});

const key = async (
  opts: Parameters<typeof resolvePlatformAuth>[0],
  stored: Parameters<typeof resolvePlatformAuth>[1] = noStored,
) => (await resolvePlatformAuth(opts, stored)).apiKey;

const failCode = async (
  opts: Parameters<typeof resolvePlatformAuth>[0],
  stored: Parameters<typeof resolvePlatformAuth>[1] = noStored,
) => {
  try {
    await resolvePlatformAuth(opts, stored);
  } catch (e) {
    return e as PlatformClientError;
  }
  throw new Error('expected resolvePlatformAuth to throw');
};

describe('resolvePlatformAuth', () => {
  it('prefers the option over the env var', async () => {
    process.env.COMPUTE_API_KEY = 'env-key';
    expect(await key({ apiKey: 'flag-key' })).toBe('flag-key');
    expect(await key({})).toBe('env-key');
  });

  it('falls back to stored platform credentials after every env var', async () => {
    const stored = vi.fn(async () => ({ apiKey: 'stored-key' }));
    expect(await key({}, stored)).toBe('stored-key');
    expect(stored).toHaveBeenCalledWith({ baseUrl: 'https://platform.computesdk.com' });
    process.env.BENCHMARKS_PLATFORM_API_KEY = 'legacy-key';
    expect(await key({}, stored)).toBe('legacy-key');
    process.env.COMPUTE_API_KEY = 'env-key';
    expect(await key({}, stored)).toBe('env-key');
    expect(await key({ apiKey: 'flag-key' }, stored)).toBe('flag-key');
    // Only consulted when nothing higher in the chain was set.
    expect(stored).toHaveBeenCalledTimes(1);
  });

  it('uses a stored OAuth access token when no API key is stored', async () => {
    const stored = async () => ({ token: 'oauth-access-token' });
    expect(await key({}, stored)).toBe('oauth-access-token');
    // A stored API key wins over a stored token, matching @benchsdk/cli.
    expect(await key({}, async () => ({ apiKey: 'stored-key', token: 't' }))).toBe('stored-key');
  });

  it('sends X-Org-Slug only for org/COMPUTE_ORG, never the stored login org', async () => {
    // The stored orgSlug is a local cache of the last `org use` — the
    // platform already knows the active org, and sending the cached slug
    // would pin this machine after a switch made elsewhere.
    const stored = vi.fn(async () => ({ token: 't', orgSlug: 'stored-org' }));
    expect((await resolvePlatformAuth({}, stored)).orgSlug).toBeUndefined();
    // COMPUTE_ORG sends the header
    process.env.COMPUTE_ORG = 'env-org';
    expect((await resolvePlatformAuth({}, stored)).orgSlug).toBe('env-org');
    // explicit org beats the env var
    expect((await resolvePlatformAuth({ org: 'flag-org' }, stored)).orgSlug).toBe('flag-org');
    delete process.env.COMPUTE_ORG;
    // An explicit API key still carries the override (the platform ignores the
    // header for org keys).
    process.env.COMPUTE_API_KEY = 'env-key';
    expect((await resolvePlatformAuth({}, stored)).orgSlug).toBeUndefined();
    expect((await resolvePlatformAuth({ org: 'flag-org' }, stored)).orgSlug).toBe('flag-org');
  });

  it('passes the resolved base URL to the stored resolver so refresh hits the same host', async () => {
    const stored = vi.fn(async () => ({ token: 't' }));
    await resolvePlatformAuth({ baseUrl: 'http://localhost:3000/' }, stored);
    expect(stored).toHaveBeenCalledWith({ baseUrl: 'http://localhost:3000' });
  });

  it('uses stored platform credentials for trusted hosts only', async () => {
    const stored = vi.fn(async () => ({ token: 'oauth-access-token' }));
    expect(await key({ baseUrl: 'https://platform.computesdk.com' }, stored)).toBe('oauth-access-token');
    expect(await key({ baseUrl: 'https://staging.computesdk.com' }, stored)).toBe('oauth-access-token');
    expect(stored).toHaveBeenCalledTimes(2);
  });

  it('never resolves or refreshes stored credentials for an untrusted host, even with allowUntrustedHost', async () => {
    const stored = vi.fn(async () => ({ token: 'oauth-access-token' }));
    const err = await failCode({ baseUrl: 'https://evil.example.com', allowUntrustedHost: true }, stored);
    expect(err).toBeInstanceOf(PlatformClientError);
    expect(err.code).toBe('untrusted_host_stored_auth');
    expect(err.message).toContain('COMPUTE_API_KEY');
    expect(stored).not.toHaveBeenCalled();
    // Without the flag the plain untrusted_host refusal wins, still without touching stored auth.
    expect((await failCode({ baseUrl: 'https://evil.example.com' }, stored)).code).toBe('untrusted_host');
    expect(stored).not.toHaveBeenCalled();
  });

  it('lets allowUntrustedHost send an explicit option or env key over HTTPS', async () => {
    const stored = vi.fn(async () => ({ token: 'oauth-access-token' }));
    const untrusted = { baseUrl: 'https://evil.example.com', allowUntrustedHost: true };
    expect(await key({ ...untrusted, apiKey: 'flag-key' }, stored)).toBe('flag-key');
    process.env.COMPUTE_API_KEY = 'env-key';
    expect(await key(untrusted, stored)).toBe('env-key');
    delete process.env.COMPUTE_API_KEY;
    process.env.BENCHMARKS_PLATFORM_API_KEY = 'legacy-key';
    expect(await key(untrusted, stored)).toBe('legacy-key');
    expect(stored).not.toHaveBeenCalled();
  });

  it('maps a stored-credential failure (missing, expired, refresh failed) to no_credentials', async () => {
    const expired = async () => {
      throw new Error('Your session has expired.');
    };
    const err = await failCode({}, expired);
    expect(err).toBeInstanceOf(PlatformClientError);
    expect(err.code).toBe('no_credentials');
    expect(err.message).toContain('Your session has expired.');
    expect(err.message).toContain('compute login');

    const nothingStored = async () => {
      throw new Error('No credentials found. Set BENCHMARKS_PLATFORM_API_KEY ... run `bench auth login`.');
    };
    const none = await failCode({}, nothingStored);
    expect(none.code).toBe('no_credentials');
    expect(none.message).toBe('No API key. Set COMPUTE_API_KEY, pass apiKey, or run `compute login`.');
  });

  it('accepts the legacy BENCHMARKS_PLATFORM_* env vars as fallback', async () => {
    process.env.BENCHMARKS_PLATFORM_API_KEY = 'legacy-key';
    process.env.BENCHMARKS_PLATFORM_URL = 'https://staging.computesdk.com';
    const auth = await resolvePlatformAuth({});
    expect(auth.apiKey).toBe('legacy-key');
    expect(auth.baseUrl).toBe('https://staging.computesdk.com');
  });

  it('empty new env vars fall through to the legacy aliases', async () => {
    process.env.COMPUTE_API_KEY = '';
    process.env.COMPUTE_PLATFORM_URL = '';
    process.env.BENCHMARKS_PLATFORM_API_KEY = 'legacy-key';
    process.env.BENCHMARKS_PLATFORM_URL = 'https://staging.computesdk.com';
    const auth = await resolvePlatformAuth({});
    expect(auth.apiKey).toBe('legacy-key');
    expect(auth.baseUrl).toBe('https://staging.computesdk.com');
  });

  it('strips a trailing slash from base-url', async () => {
    expect(
      (await resolvePlatformAuth({ apiKey: 'k', baseUrl: 'http://localhost:3000/' })).baseUrl,
    ).toBe('http://localhost:3000');
  });

  it('throws a coded error without a key', async () => {
    const err = await failCode({});
    expect(err).toBeInstanceOf(PlatformClientError);
    expect(err.code).toBe('no_credentials');
    expect(err.message).toContain('compute login');
  });

  it('requires https for any non-loopback host, trusted or not', async () => {
    for (const insecure of [
      'http://platform.computesdk.com',
      'http://staging.computesdk.com',
      'http://computesdk.com',
    ]) {
      await expect(resolvePlatformAuth({ apiKey: 'k', baseUrl: insecure })).rejects.toThrow('plaintext HTTP');
    }
    expect((await failCode({ apiKey: 'k', baseUrl: 'http://platform.computesdk.com' })).code).toBe('insecure_transport');
    // allowUntrustedHost is about the host, not the transport.
    await expect(
      resolvePlatformAuth({ apiKey: 'k', baseUrl: 'http://evil.example.com', allowUntrustedHost: true }),
    ).rejects.toThrow('plaintext HTTP');
    await expect(
      resolvePlatformAuth({ apiKey: 'k', baseUrl: 'http://evil.example.com' }),
    ).rejects.toThrow('untrusted');
  });
});

describe('host trust helpers', () => {
  it('trusts computesdk.com, its subdomains, and loopback', () => {
    for (const trusted of [
      'https://platform.computesdk.com',
      'https://computesdk.com',
      'https://staging.computesdk.com',
      'http://localhost:3000',
      'http://127.0.0.1:8080',
      'http://[::1]:3000',
    ]) {
      expect(isTrustedPlatformHost(trusted), trusted).toBe(true);
    }
    for (const untrusted of [
      'https://evil.example.com',
      'https://computesdk.com.evil.com',
      'https://notcomputesdk.com',
    ]) {
      expect(isTrustedPlatformHost(untrusted), untrusted).toBe(false);
    }
  });

  it('allows plaintext only on loopback', () => {
    expect(isSecurePlatformTransport('https://anything.example.com')).toBe(true);
    expect(isSecurePlatformTransport('http://localhost:3000')).toBe(true);
    expect(isSecurePlatformTransport('http://127.0.0.1:8080')).toBe(true);
    expect(isSecurePlatformTransport('http://platform.computesdk.com')).toBe(false);
    expect(isSecurePlatformTransport('http://192.168.1.5:3000')).toBe(false);
  });
});

describe('PlatformApiError', () => {
  function makeError(status: number, body: unknown, headers: Record<string, string> = {}) {
    const res = new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
    const client = new PlatformClient({ apiKey: 'k', baseUrl: 'https://platform.computesdk.com' }, async () => res);
    return client.get('/x').then(
      () => {
        throw new Error('expected request to fail');
      },
      (e: unknown) => e as PlatformApiError,
    );
  }

  it('derives code from details.code first', async () => {
    const err = await makeError(402, { error: 'Payment required', details: { code: 'insufficient_credits' } });
    expect(err).toBeInstanceOf(PlatformApiError);
    expect(err.code).toBe('insufficient_credits');
    expect(err.details).toEqual({ code: 'insufficient_credits' });
  });

  it('then body.code', async () => {
    const err = await makeError(503, { error: 'booting', code: 'sandbox_booting' });
    expect(err.code).toBe('sandbox_booting');
  });

  it('then the status table', async () => {
    const err = await makeError(404, { error: 'not here' });
    expect(err.code).toBe('not_found');
  });

  it('keeps details.code in details when body.code is the top-level carrier', async () => {
    const err = await makeError(402, {
      error: 'nope',
      code: 'insufficient_credits',
      details: { balance: 3 },
    });
    expect(err.code).toBe('insufficient_credits');
    expect(err.details).toEqual({ balance: 3 });
  });

  it('is retryable on 429/502/503/504 but never for market codes', async () => {
    for (const status of [429, 502, 503, 504]) {
      const err = await makeError(status, { error: 'x' });
      expect(err.retryable, String(status)).toBe(true);
    }
    const market = await makeError(503, { error: 'x', code: 'no_market_capacity' });
    expect(market.retryable).toBe(false);
    const e402 = await makeError(402, { error: 'x', details: { code: 'insufficient_credits' } });
    expect(e402.retryable).toBe(false);
  });

  it('parses Retry-After seconds and HTTP dates', async () => {
    const seconds = await makeError(429, { error: 'x' }, { 'retry-after': '12' });
    expect(seconds.retryAfterMs).toBe(12000);
    const date = new Date(Date.now() + 5000).toUTCString();
    const httpDate = await makeError(429, { error: 'x' }, { 'retry-after': date });
    expect(httpDate.retryAfterMs).toBeGreaterThan(0);
    expect(httpDate.retryAfterMs).toBeLessThanOrEqual(6000);
  });

  it('appends the requestId when the body carries one', async () => {
    const err = await makeError(500, { error: 'boom', requestId: 'req_123' });
    expect(err.message).toContain('req_123');
  });

  it('points at `compute login` on insufficient_scope', async () => {
    const err = await makeError(403, { error: 'nope', code: 'insufficient_scope' });
    expect(err.message).toContain('compute login');
  });
});

describe('download', () => {
  const BASE = 'https://platform.computesdk.com';

  const recordingFetch = (responses: Response[]) => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(
      async (input: string | URL, init?: { headers?: Record<string, string> }) => {
        calls.push({ url: String(input), headers: init?.headers ?? {} });
        return responses[Math.min(calls.length, responses.length) - 1];
      },
    );
    return { calls, fetchImpl };
  };

  const redirect = (location: string) =>
    new Response(null, { status: 302, headers: { location } });

  it('sends credentials only to the base origin across multi-hop redirects', async () => {
    const { calls, fetchImpl } = recordingFetch([
      redirect('https://tigris.storage.example/signed-1'),
      // A second hop within the storage origin must NOT regain the token —
      // "same origin" means the API's origin, not the previous hop's.
      redirect('/signed-2'),
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    ]);
    const client = new PlatformClient({ apiKey: 'k', baseUrl: BASE }, fetchImpl as never);
    expect(await client.download('/artifact/1')).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls).toHaveLength(3);
    expect(calls[0].headers.authorization).toBe('Bearer k');
    expect(calls[1].headers.authorization).toBeUndefined();
    expect(calls[2].headers.authorization).toBeUndefined();
  });

  it('keeps credentials on a same-origin redirect', async () => {
    const { calls, fetchImpl } = recordingFetch([
      redirect('https://platform.computesdk.com/artifact/2'),
      new Response(new Uint8Array([9]), { status: 200 }),
    ]);
    const client = new PlatformClient({ apiKey: 'k', baseUrl: BASE }, fetchImpl as never);
    await client.download('/artifact/1');
    expect(calls[1].headers.authorization).toBe('Bearer k');
  });
});

describe('toErrorEnvelope / codeForStatus / errorDetails', () => {
  it('envelopes API errors with their code and retryable flag', () => {
    const err = new PlatformApiError(429, 'slow down');
    const env = toErrorEnvelope(err);
    expect(env.error.code).toBe(codeForStatus(429));
    expect(env.error.retryable).toBe(true);
    expect(env.error.message).toBe('slow down');
  });

  it('envelopes client errors by their code', () => {
    const env = toErrorEnvelope(new PlatformClientError('no_credentials', 'x'));
    expect(env.error.code).toBe('no_credentials');
    expect(env.error.retryable).toBe(false);
  });

  it('falls back to unknown for anything else', () => {
    expect(toErrorEnvelope(new Error('boom')).error).toEqual({ code: 'unknown', message: 'boom', retryable: false });
    expect(toErrorEnvelope('str').error.message).toBe('str');
  });

  it('errorDetails extracts the body\'s details object and nothing else', () => {
    expect(errorDetails({ details: { balance: 3 } })).toEqual({ balance: 3 });
    expect(errorDetails({ details: [1, 2] })).toBeUndefined();
    expect(errorDetails({ error: 'x' })).toBeUndefined();
    expect(errorDetails(undefined)).toBeUndefined();
  });
});
