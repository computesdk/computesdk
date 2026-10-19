import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RgstrClient, RgstrCliError, isSecureTransport, isTrustedHost, resolveAuth } from '../client.js';
import { discoverAuthServer, requestDeviceCode } from '../auth.js';
import { parseRouteSpec } from '../routes.js';

const ENV = ['RGSTR_TOKEN', 'RGSTR_ORG', 'RGSTR_URL', 'RGSTR_HOME'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.RGSTR_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'rgstr-home-'));
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const stored = {
  baseUrl: 'https://rgstr.org',
  token: 'device-token',
  clientId: 'benchsdk-cli',
  authBaseUrl: 'https://platform.computesdk.com/api/auth',
  resource: 'https://platform.computesdk.com/api/v1',
};

describe('host trust', () => {
  it('trusts rgstr.org, computesdk.com and loopback only', () => {
    expect(isTrustedHost('https://rgstr.org')).toBe(true);
    expect(isTrustedHost('https://platform.computesdk.com')).toBe(true);
    expect(isTrustedHost('http://rgstr.localhost:3000')).toBe(true);
    expect(isTrustedHost('https://evil.example')).toBe(false);
    expect(isTrustedHost('https://rgstr.org.evil.example')).toBe(false);
  });
  it('allows plaintext only for loopback', () => {
    expect(isSecureTransport('http://127.0.0.1:3000')).toBe(true);
    expect(isSecureTransport('http://rgstr.org')).toBe(false);
  });
});

describe('resolveAuth', () => {
  it('prefers RGSTR_TOKEN and picks the org from RGSTR_ORG', async () => {
    process.env.RGSTR_TOKEN = 'csdk_key';
    process.env.RGSTR_ORG = 'acme';
    const auth = await resolveAuth({}, { loadCredentials: async () => stored });
    expect(auth).toMatchObject({ baseUrl: 'https://rgstr.org', token: 'csdk_key', kind: 'api_key', org: 'acme' });
  });

  it('falls back to the stored device login for its own origin', async () => {
    const auth = await resolveAuth({ org: 'acme' }, { loadCredentials: async () => stored });
    expect(auth).toMatchObject({ token: 'device-token', kind: 'device', org: 'acme' });
    await expect(resolveAuth({ baseUrl: 'http://rgstr.localhost:3000' }, { loadCredentials: async () => stored })).rejects.toMatchObject({ code: 'no_credentials' });
  });

  it('refuses untrusted hosts, and never sends stored auth to one', async () => {
    await expect(resolveAuth({ baseUrl: 'https://evil.example' }, { loadCredentials: async () => stored })).rejects.toMatchObject({ code: 'untrusted_host' });
    const err = await resolveAuth(
      { baseUrl: 'https://evil.example', allowUntrustedHost: true },
      { loadCredentials: async () => ({ ...stored, baseUrl: 'https://evil.example' }) },
    ).catch((e: RgstrCliError) => e);
    expect(err).toMatchObject({ code: 'no_credentials' });
    await expect(resolveAuth({ baseUrl: 'http://rgstr.org', allowUntrustedHost: true })).rejects.toMatchObject({ code: 'insecure_transport' });
  });

  it('is optional for public commands', async () => {
    const auth = await resolveAuth({ optional: true }, { loadCredentials: async () => null });
    expect(auth).toMatchObject({ kind: 'none', token: null });
  });
});

describe('RgstrClient', () => {
  it('sends Bearer + X-Org-Slug and surfaces API errors', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return url.endsWith('/boom')
        ? new Response(JSON.stringify({ error: 'Name already claimed' }), { status: 409 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new RgstrClient({ baseUrl: 'https://rgstr.org', token: 't', kind: 'api_key', org: 'acme' }, fetchImpl);
    await c.post('/api/v1/registry/claims', { name: 'x' });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer t');
    expect(headers['x-org-slug']).toBe('acme');
    await expect(c.get('/boom')).rejects.toMatchObject({ status: 409, message: 'Name already claimed' });
  });
});

describe('device flow discovery', () => {
  it('finds the issuer and resource from the protected-resource metadata and posts the device code request', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://rgstr.org/.well-known/oauth-protected-resource/api/v1') {
        return new Response(JSON.stringify({ resource: 'https://platform.computesdk.com/api/v1', authorization_servers: ['https://platform.computesdk.com/api/auth'] }));
      }
      expect(url).toBe('https://platform.computesdk.com/api/auth/device/code');
      const body = init?.body as URLSearchParams;
      expect(body.get('client_id')).toBe('benchsdk-cli');
      expect(body.get('resource')).toBe('https://platform.computesdk.com/api/v1');
      expect(body.get('scope')).toContain('packages:write');
      return new Response(JSON.stringify({ device_code: 'd', user_code: 'ABCD-EFGH', verification_uri: 'https://platform.computesdk.com/device', expires_in: 900, interval: 5 }));
    }) as unknown as typeof fetch;
    const server = await discoverAuthServer('https://rgstr.org', fetchImpl);
    const code = await requestDeviceCode(server, 'benchsdk-cli', 'packages:read packages:write org:read offline_access', fetchImpl);
    expect(code.user_code).toBe('ABCD-EFGH');
  });
});

describe('route specs', () => {
  it('parses kind, name and range', () => {
    expect(parseRouteSpec('npm:tsc-rs@^0.7', 'tsc-rs')).toEqual({ versionRange: '^0.7', upstreamKind: 'npm', upstreamName: null });
    expect(parseRouteSpec('npm:tsc-rs-real@^0.7', 'tsc-rs')).toEqual({ versionRange: '^0.7', upstreamKind: 'npm', upstreamName: 'tsc-rs-real' });
    expect(parseRouteSpec('jsr:@scope/pkg@^1', 'tsc-rs')).toEqual({ versionRange: '^1', upstreamKind: 'jsr', upstreamName: '@scope/pkg' });
    expect(parseRouteSpec('pypi:tsc-rs', 'tsc-rs')).toEqual({ versionRange: '*', upstreamKind: 'pypi', upstreamName: null });
    expect(() => parseRouteSpec('github:owner/repo@v1.2.3', 'tsc-rs')).toThrow(/github: routes are not supported yet/);
    expect(() => parseRouteSpec('tsc-rs', 'tsc-rs')).toThrow(/npm:<name>@<range>/);
  });
});
