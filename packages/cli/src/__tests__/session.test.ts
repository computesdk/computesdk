import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import type { CliAuth } from '@benchsdk/cli';
import { benchAuthOverrides, fetchWhoami, formatWhoami } from '../session.js';

const distEntry = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'index.js');

const BASE = 'http://localhost:3210';
const auth = (over: Partial<CliAuth>): CliAuth => ({
  baseUrl: BASE,
  apiBaseUrl: `${BASE}/api/v1`,
  authBaseUrl: `${BASE}/api/auth`,
  ...over,
});
const ORG = { id: 'org_1', name: 'Parity Owner', slug: 'parity-owner' };
const ME = {
  user: { id: 'u1', name: 'Owner', email: 'owner@parity.test' },
  activeOrganizationId: 'org_1',
  organizations: [ORG],
};

type Route = { status: number; body: unknown };
function stubFetch(routes: Record<string, Route>) {
  const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
    const route = routes[String(url)];
    if (!route) throw new TypeError(`unexpected fetch ${String(url)}`);
    return new Response(JSON.stringify(route.body), {
      status: route.status,
      statusText: route.status === 401 ? 'Unauthorized' : 'OK',
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('benchAuthOverrides', () => {
  it('passes COMPUTE_API_KEY to @benchsdk/cli as an explicit key', () => {
    expect(benchAuthOverrides({}, { COMPUTE_API_KEY: 'bp_k' })).toEqual({ apiKey: 'bp_k', baseUrl: undefined });
  });

  it('treats an empty COMPUTE_API_KEY as unset', () => {
    expect(benchAuthOverrides({}, { COMPUTE_API_KEY: '' }).apiKey).toBeUndefined();
  });

  it('takes --base-url, then COMPUTE_PLATFORM_URL, then BENCHMARKS_PLATFORM_URL', () => {
    const env = { COMPUTE_PLATFORM_URL: 'http://localhost:1', BENCHMARKS_PLATFORM_URL: 'http://localhost:2' };
    expect(benchAuthOverrides({ baseUrl: 'http://localhost:0' }, env).baseUrl).toBe('http://localhost:0');
    expect(benchAuthOverrides({}, env).baseUrl).toBe('http://localhost:1');
    expect(benchAuthOverrides({}, { BENCHMARKS_PLATFORM_URL: 'http://localhost:2' }).baseUrl).toBe('http://localhost:2');
  });
});

describe('fetchWhoami', () => {
  it('returns /api/v1/me unchanged for a user credential', async () => {
    const fetchMock = stubFetch({ [`${BASE}/api/v1/me`]: { status: 200, body: ME } });
    expect(await fetchWhoami(auth({ token: 'tok' }))).toEqual(ME);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('reports an org API key as its org with no user', async () => {
    const fetchMock = stubFetch({
      [`${BASE}/api/v1/me`]: { status: 401, body: { error: 'User credential required', code: 'unauthorized' } },
      [`${BASE}/api/v1/actions/org`]: { status: 200, body: { organizationId: ORG.id, name: ORG.name, slug: ORG.slug } },
    });
    expect(await fetchWhoami(auth({ apiKey: 'bp_k' }))).toEqual({
      user: null,
      activeOrganizationId: ORG.id,
      organizations: [ORG],
      credential: 'api_key',
    });
    for (const call of fetchMock.mock.calls) {
      expect((call[1]?.headers as Record<string, string>).Authorization).toBe('Bearer bp_k');
    }
  });

  it('reports a rejected key as an authentication error with the server reason', async () => {
    stubFetch({ [`${BASE}/api/v1/me`]: { status: 401, body: { error: 'Invalid API key', code: 'unauthorized' } } });
    await expect(fetchWhoami(auth({ apiKey: 'bp_bogus' }))).rejects.toThrow(
      /Authentication failed \(401 Unauthorized\): Invalid API key/,
    );
  });

  it('says the key has no user identity when its org cannot be read', async () => {
    stubFetch({
      [`${BASE}/api/v1/me`]: { status: 401, body: { error: 'User credential required' } },
      [`${BASE}/api/v1/actions/org`]: { status: 403, body: { error: 'Insufficient scope' } },
    });
    await expect(fetchWhoami(auth({ apiKey: 'bp_k' }))).rejects.toThrow(/API key has no user identity/);
  });

  it('does not treat a user token rejected as "user credential required" as a key', async () => {
    stubFetch({ [`${BASE}/api/v1/me`]: { status: 401, body: { error: 'User credential required' } } });
    await expect(fetchWhoami(auth({ token: 'tok' }))).rejects.toThrow(/Authentication failed \(401 Unauthorized\)/);
  });
});

describe('formatWhoami', () => {
  it('prints the user and active org', () => {
    expect(formatWhoami(ME)).toEqual(['owner@parity.test', 'active org: parity-owner (org_1)']);
  });

  it('prints an API key’s org with no user', () => {
    expect(
      formatWhoami({ user: null, activeOrganizationId: ORG.id, organizations: [ORG], credential: 'api_key' }),
    ).toEqual(['API key (no user identity)', 'active org: parity-owner (org_1)']);
  });
});

// The built CLI end to end: COMPUTE_API_KEY reaches the request (no
// "No credentials found") without any BENCHMARKS_* variable.
describe.skipIf(!existsSync(distEntry))('compute whoami / org current (built CLI)', () => {
  for (const args of [['whoami'], ['org', 'current']]) {
    it(`${args.join(' ')} sends COMPUTE_API_KEY`, () => {
      const home = mkdtempSync(join(tmpdir(), 'compute-whoami-'));
      try {
        const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
        for (const k of Object.keys(env)) {
          if (k.startsWith('BENCHMARKS_') || k.startsWith('COMPUTE_')) delete env[k];
        }
        env.COMPUTE_PLATFORM_URL = 'http://127.0.0.1:9';
        env.COMPUTE_API_KEY = 'bp_x';
        const res = spawnSync(process.execPath, [distEntry, ...args], { encoding: 'utf-8', env, timeout: 30_000 });
        const out = res.stdout + res.stderr;
        expect(res.status).not.toBe(0);
        expect(out).not.toContain('No credentials found');
        expect(out).not.toContain('BENCHMARKS_PLATFORM_API_KEY');
        expect(out).toContain('127.0.0.1:9');
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    });
  }
});
