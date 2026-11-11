/**
 * The stored-login session behind `compute login`, `whoami` and `org …`,
 * resolved through `@benchsdk/cli` (shared `~/.benchsdk/credentials.json`).
 * That package reads only bench's env names, so compute's are passed in as
 * explicit overrides here.
 */

import type { CliAuth } from '@benchsdk/cli';
import { DEFAULT_BASE_URL, isSecurePlatformTransport, isTrustedPlatformHost } from '@computesdk/platform';
import { describeFetchFailure, isFetchFailure } from './net.js';

export function envBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.COMPUTE_PLATFORM_URL || env.BENCHMARKS_PLATFORM_URL || undefined;
}

/**
 * `@benchsdk/cli` doesn't check where it sends a key, so compute applies its
 * own rule before handing COMPUTE_API_KEY over (as `resolvePlatformAuth`
 * does for every other command): a computesdk.com or loopback host, over
 * HTTPS off loopback. A key the user gives bench directly
 * (BENCHMARKS_PLATFORM_API_KEY) is bench's business and isn't checked here.
 */
export function assertComputeKeyDestination(baseUrl: string): void {
  const url = baseUrl.replace(/\/+$/, '');
  if (!isTrustedPlatformHost(url)) {
    throw new Error(
      `Refusing to send COMPUTE_API_KEY to ${url}: it is not a computesdk.com or localhost host. ` +
        'To use a key with a host you trust, set BENCHMARKS_PLATFORM_API_KEY for it instead.',
    );
  }
  if (!isSecurePlatformTransport(url)) {
    throw new Error(`Refusing to send COMPUTE_API_KEY over plaintext HTTP to ${url}; use https://.`);
  }
}

/**
 * `@benchsdk/cli` `resolveAuth` overrides. COMPUTE_API_KEY goes in as an
 * explicit key, so it wins over the stored login (as for every other compute
 * command), but only to a host compute itself would send it to;
 * BENCHMARKS_PLATFORM_API_KEY still works through bench's own env.
 */
export function benchAuthOverrides(
  opts: { baseUrl?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): { baseUrl?: string; apiKey?: string } {
  const baseUrl = opts.baseUrl ?? envBaseUrl(env);
  const apiKey = env.COMPUTE_API_KEY || undefined;
  if (apiKey) assertComputeKeyDestination(baseUrl ?? DEFAULT_BASE_URL);
  return { baseUrl, apiKey };
}

export async function benchAuth(opts: { baseUrl?: string } = {}): Promise<CliAuth> {
  const { resolveAuth } = await import('@benchsdk/cli');
  return resolveAuth(benchAuthOverrides(opts));
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

/** `GET /api/v1/me`, or for an org API key (no user) the key's org. */
export interface Whoami {
  user: { id: string; name?: string | null; email?: string | null } | null;
  activeOrganizationId: string | null;
  organizations: Organization[];
  credential?: 'api_key';
}

function errorReason(body: unknown): string | undefined {
  if (typeof body !== 'string' || body === '') return undefined;
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown };
    const reason = parsed.message ?? parsed.error;
    return typeof reason === 'string' ? reason : undefined;
  } catch {
    return body.slice(0, 200);
  }
}

function httpStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Org API keys carry no user, so `/api/v1/me` answers them 401 "User
 * credential required"; `/api/v1/actions/org` is the v1 route that names the
 * org a key belongs to.
 */
async function apiKeyOrganization(auth: CliAuth, apiKey: string): Promise<Organization> {
  const url = `${auth.apiBaseUrl}/actions/org`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch (error) {
    throw isFetchFailure(error) ? describeFetchFailure(error, url) : error;
  }
  const text = await response.text();
  if (!response.ok) {
    const reason = errorReason(text);
    throw new Error(
      `This API key has no user identity, and its organization could not be read (${response.status}${reason ? `: ${reason}` : ''}).`,
    );
  }
  const org = JSON.parse(text) as { organizationId: string; name: string; slug: string };
  return { id: org.organizationId, name: org.name, slug: org.slug };
}

export async function fetchWhoami(auth: CliAuth): Promise<Whoami> {
  const { getMe } = await import('@benchsdk/cli');
  try {
    return await getMe(auth);
  } catch (error) {
    if (isFetchFailure(error)) throw describeFetchFailure(error, `${auth.apiBaseUrl}/me`);
    if (httpStatus(error) !== 401) throw error;
    const reason = errorReason((error as { body?: unknown }).body);
    if (auth.apiKey && !auth.token && reason === 'User credential required') {
      const org = await apiKeyOrganization(auth, auth.apiKey);
      return { user: null, activeOrganizationId: org.id, organizations: [org], credential: 'api_key' };
    }
    throw new Error(
      `Authentication failed (401 Unauthorized)${reason ? `: ${reason}` : ''}. ` +
        'Check COMPUTE_API_KEY / the stored login, or run `compute login`.',
    );
  }
}

export function formatWhoami(me: Whoami): string[] {
  const active = me.organizations.find((o) => o.id === me.activeOrganizationId);
  const who = me.user ? (me.user.email ?? me.user.name ?? me.user.id) : 'API key (no user identity)';
  return [
    who,
    `active org: ${active ? `${active.slug} (${active.id})` : '—'}${me.organizations.length > 1 ? '  — change with `compute org use <slug>`' : ''}`,
  ];
}
