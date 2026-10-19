// Auth resolution + the JSON client every command uses. Mirrors
// packages/cli/src/actions-client.ts: explicit token > RGSTR_TOKEN > the
// stored device login; untrusted hosts need --allow-untrusted-host and never
// see stored credentials; http:// only for loopback.

import { refreshAccessToken, AuthError } from './auth.js';
import { loadConfig, loadCredentials, saveCredentials, type Credentials } from './config.js';
import { isSecureTransport, isTrustedHost } from './hosts.js';

export const DEFAULT_BASE_URL = 'https://rgstr.org';

export type RgstrCliErrorCode =
  | 'no_credentials'
  | 'untrusted_host'
  | 'untrusted_host_stored_auth'
  | 'insecure_transport'
  | 'invalid_argument'
  | 'not_found'
  | 'not_holder';

export class RgstrCliError extends Error {
  constructor(
    public code: RgstrCliErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RgstrCliError';
  }
}

export class RgstrApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'RgstrApiError';
  }
}

export { isSecureTransport, isTrustedHost } from './hosts.js';

export function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

export interface GlobalOptions {
  baseUrl?: string;
  allowUntrustedHost?: boolean;
  org?: string;
  token?: string;
  json?: boolean;
}

export interface ResolvedAuth {
  baseUrl: string;
  token: string | null;
  kind: 'api_key' | 'device' | 'none';
  org: string | null;
  credentials?: Credentials;
}

/** Where the CLI points by default: flag > RGSTR_URL > saved config > rgstr.org. */
export async function resolveBaseUrl(opts: { baseUrl?: string }): Promise<string> {
  const cfg = await loadConfig();
  return normalizeBaseUrl(opts.baseUrl || process.env.RGSTR_URL || cfg.baseUrl || DEFAULT_BASE_URL);
}

export function assertHostAllowed(baseUrl: string, allowUntrustedHost?: boolean): void {
  if (!allowUntrustedHost && !isTrustedHost(baseUrl)) {
    throw new RgstrCliError(
      'untrusted_host',
      `Refusing to talk to ${baseUrl} — it is not rgstr.org, computesdk.com or a localhost host. ` +
        'If this is a self-hosted/dev deployment you trust, pass --allow-untrusted-host.',
    );
  }
  if (!isSecureTransport(baseUrl)) {
    throw new RgstrCliError(
      'insecure_transport',
      `Refusing to send credentials over plaintext HTTP to ${baseUrl}. ` +
        'Use an https:// base URL; http:// is only allowed for localhost/loopback.',
    );
  }
}

/**
 * Pick the credential for this invocation. Public commands pass
 * `{ optional: true }` and get `kind: 'none'` instead of an error.
 */
export async function resolveAuth(
  opts: GlobalOptions & { optional?: boolean },
  io: { loadCredentials?: typeof loadCredentials; fetchImpl?: typeof fetch } = {},
): Promise<ResolvedAuth> {
  const baseUrl = await resolveBaseUrl(opts);
  assertHostAllowed(baseUrl, opts.allowUntrustedHost);
  const cfg = await loadConfig();
  const org = opts.org || process.env.RGSTR_ORG || cfg.org || null;

  const explicit = opts.token || process.env.RGSTR_TOKEN || undefined;
  if (explicit) return { baseUrl, token: explicit, kind: 'api_key', org };

  // Stored device logins are bound to the origin they were made against and
  // are never replayed to an untrusted host, even with --allow-untrusted-host.
  if (isTrustedHost(baseUrl)) {
    const stored = await (io.loadCredentials ?? loadCredentials)();
    if (stored && normalizeBaseUrl(stored.baseUrl) === baseUrl) {
      const fresh = await ensureFresh(stored, io.fetchImpl ?? fetch);
      return { baseUrl, token: fresh.token, kind: 'device', org, credentials: fresh };
    }
  }

  if (opts.optional) return { baseUrl, token: null, kind: 'none', org };
  throw new RgstrCliError(
    'no_credentials',
    isTrustedHost(baseUrl)
      ? 'Not logged in. Run `rgstr login`, or set RGSTR_TOKEN to an org API key.'
      : `No credentials for ${baseUrl}: stored logins are not sent to untrusted hosts. Set RGSTR_TOKEN explicitly.`,
  );
}

async function ensureFresh(stored: Credentials, fetchImpl: typeof fetch): Promise<Credentials> {
  const expiresSoon = stored.tokenExpiresAt && stored.tokenExpiresAt - Date.now() < 60_000;
  if (!expiresSoon || !stored.refreshToken) return stored;
  try {
    const t = await refreshAccessToken({ authBaseUrl: stored.authBaseUrl, resource: stored.resource }, stored.refreshToken, stored.clientId, fetchImpl);
    const next: Credentials = {
      ...stored,
      token: t.access_token,
      refreshToken: t.refresh_token ?? stored.refreshToken,
      tokenExpiresAt: Date.now() + t.expires_in * 1000,
    };
    await saveCredentials(next);
    return next;
  } catch (err) {
    if (err instanceof AuthError) {
      throw new RgstrCliError('no_credentials', `Your login has expired (${err.message}). Run \`rgstr login\` again.`);
    }
    throw err;
  }
}

export class RgstrClient {
  constructor(
    public readonly auth: ResolvedAuth,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get baseUrl(): string {
    return this.auth.baseUrl;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.auth.token) headers.authorization = `Bearer ${this.auth.token}`;
    if (this.auth.org) headers['x-org-slug'] = this.auth.org;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchImpl(`${this.auth.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const message =
        (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string'
          ? (parsed as { error: string }).error
          : null) ?? `${res.status} ${res.statusText}`;
      throw new RgstrApiError(res.status, message, parsed);
    }
    return parsed as T;
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, body ?? {});
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }
}

/** Shape commands print when something goes wrong; same envelope as `compute`. */
export function toErrorEnvelope(err: unknown): { error: string; code?: string; status?: number } {
  if (err instanceof RgstrCliError) return { error: err.message, code: err.code };
  if (err instanceof RgstrApiError) return { error: err.message, status: err.status };
  if (err instanceof Error) return { error: err.message };
  return { error: String(err) };
}
