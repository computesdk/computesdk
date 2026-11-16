/** Browser-assisted RFC 8628 login, using the shared compute/bench session. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  BENCH_OAUTH_CLIENT_ID,
  BENCH_OAUTH_SCOPE,
  getMe,
  saveCredentials,
  setActiveOrganization,
  type CliAuth,
} from '@benchsdk/cli';
import { DEFAULT_BASE_URL, isSecurePlatformTransport, isTrustedPlatformHost } from '@computesdk/platform';
import { envBaseUrl } from './session.js';

/** No shell: a verification URL must never be interpreted as a command. */
export function openBrowser(url: string): Promise<boolean> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore', timeout: 5000 });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

interface OAuthResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  expires_in?: number;
  interval?: number;
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

async function postForm(url: string, params: Record<string, string>, timeoutMs = 30_000): Promise<OAuthResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, timeoutMs))),
    redirect: 'error',
  });
  const body = await response.json() as OAuthResponse;
  if (!response.ok && !body.error) throw new Error(`Sign-in failed (${response.status}). Run compute login to retry.`);
  return body;
}

interface PendingLogin {
  baseUrl: string;
  device: OAuthResponse;
  expiresAt: number;
}
function stateDir(): string {
  return process.env.BENCHSDK_STATE_DIR ?? join(homedir(), '.benchsdk');
}
function pendingPath(baseUrl: string): string {
  return join(stateDir(), `compute-login-${createHash('sha256').update(baseUrl).digest('hex')}.json`);
}
function readPending(baseUrl: string, includeExpired = false): PendingLogin | undefined {
  try {
    const pending = JSON.parse(readFileSync(pendingPath(baseUrl), 'utf8')) as PendingLogin;
    if (pending.baseUrl === baseUrl && pending.device && Number.isFinite(pending.expiresAt) && (includeExpired || pending.expiresAt > Date.now())) return pending;
  } catch { /* no pending login */ }
  return undefined;
}
function savePending(pending: PendingLogin): void {
  mkdirSync(stateDir(), { recursive: true });
  const file = pendingPath(pending.baseUrl);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(pending), { mode: 0o600 });
  renameSync(tmp, file);
}
function removePending(baseUrl: string, deviceCode: string): void {
  // A completed/denied attempt must not erase a newer login.
  if (readPending(baseUrl, true)?.device.device_code === deviceCode) rmSync(pendingPath(baseUrl), { force: true });
}
export function clearPendingLogins(): void {
  let files: string[];
  try { files = readdirSync(stateDir()); } catch { return; }
  for (const file of files) {
    if (/^compute-login-[a-f0-9]{64}\.json$/.test(file)) rmSync(join(stateDir(), file), { force: true });
  }
}

export interface LoginOptions {
  baseUrl?: string;
  browser?: boolean;
  org?: string;
  json?: boolean;
  wait?: boolean;
  new?: boolean;
}

export async function login(options: LoginOptions = {}): Promise<void> {
  const baseUrl = (options.baseUrl || envBaseUrl() || DEFAULT_BASE_URL).replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  if (!isTrustedPlatformHost(baseUrl) || !isSecurePlatformTransport(baseUrl)) {
    throw new Error('Sign in against a trusted ComputeSDK HTTPS host (or localhost for development).');
  }
  const resource = `${baseUrl}/api/v1`;
  const authUrl = `${baseUrl}/api/auth`;
  const pending = options.new ? undefined : readPending(baseUrl);
  if (options.json && options.wait && !pending) {
    throw new Error('No pending sign-in. Run compute login --json first to get the sign-in URL.');
  }
  const device = pending?.device ?? await postForm(`${authUrl}/device/code`, {
    client_id: BENCH_OAUTH_CLIENT_ID, scope: BENCH_OAUTH_SCOPE, resource,
  });
  if (device.error) throw new Error(device.error_description || device.error);
  const verificationUrl = device.verification_uri_complete || device.verification_uri;
  if (!device.device_code || !device.user_code || !verificationUrl ||
      !Number.isFinite(device.expires_in) || device.expires_in! <= 0 ||
      (device.interval !== undefined && (!Number.isFinite(device.interval) || device.interval <= 0))) {
    throw new Error('Invalid sign-in response. Run compute login to retry.');
  }
  const parsedUrl = new URL(verificationUrl);
  if (parsedUrl.origin !== new URL(baseUrl).origin || parsedUrl.username || parsedUrl.password) {
    throw new Error('The sign-in server returned an unexpected verification URL.');
  }
  const expiresAt = pending?.expiresAt ?? Date.now() + device.expires_in! * 1000;
  savePending({ baseUrl, device, expiresAt });
  if (options.json && !options.wait) {
    console.log(JSON.stringify({ verificationUrl, code: device.user_code, expiresAt: new Date(expiresAt).toISOString() }));
    return;
  }
  if (!options.json) {
    console.error(`Sign in to ComputeSDK: ${verificationUrl}`);
    console.error(`Confirm code: ${device.user_code}`);
    console.error('Waiting for approval. Press Ctrl-C to cancel.');
    if (options.browser !== false && !(await openBrowser(verificationUrl))) {
      console.error('Could not open a browser. Open the sign-in URL above to continue.');
    }
  }

  let intervalMs = (device.interval ?? 5) * 1000;
  while (Date.now() + intervalMs < expiresAt) {
    await delay(intervalMs);
    const token = await postForm(`${authUrl}/oauth2/token`, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: device.device_code, client_id: BENCH_OAUTH_CLIENT_ID, resource,
    }, expiresAt - Date.now());
    if (token.error === 'authorization_pending') continue;
    if (token.error === 'slow_down') {
      intervalMs += 5000;
      device.interval = intervalMs / 1000;
      savePending({ baseUrl, device, expiresAt });
      continue;
    }
    if (token.error === 'access_denied') {
      removePending(baseUrl, device.device_code);
      throw new Error('Sign-in was denied. Run compute login to try again.');
    }
    if (token.error === 'expired_token') break;
    if (token.error) throw new Error(token.error_description || token.error);
    if (!token.access_token || !Number.isFinite(token.expires_in) || token.expires_in! <= 0) {
      throw new Error('Invalid sign-in token response. Run compute login to retry.');
    }
    const credentials = {
      baseUrl, token: token.access_token, refreshToken: token.refresh_token,
      tokenExpiresAt: Date.now() + token.expires_in! * 1000,
      kind: 'oauth' as const, clientId: BENCH_OAUTH_CLIENT_ID,
    };
    await saveCredentials(credentials);
    removePending(baseUrl, device.device_code);
    // Approval normally binds the org server-side. Keep the shared store's
    // org cache current too, so directory-scoped sandbox selection is correct.
    // Use the token just issued, regardless of API keys in the environment.
    const auth: CliAuth = { ...credentials, apiBaseUrl: resource, authBaseUrl: authUrl };
    const me = await getMe(auth);
    const requestedOrg = options.org || process.env.COMPUTE_ORG;
    const override = requestedOrg ? me.organizations.find((o) => o.slug === requestedOrg) : undefined;
    if (requestedOrg && !override) {
      throw new Error(`Signed in, but not a member of organization ${requestedOrg}. Run compute org list.`);
    }
    let active = me.organizations.find((o) => o.id === me.activeOrganizationId);
    if (!me.activeOrganizationId && me.organizations.length === 1) {
      active = (await setActiveOrganization(auth, me.organizations[0].slug)).organization ?? undefined;
    }
    const effective = override ?? active;
    if (!effective) throw new Error('Signed in, but no active organization. Run compute org list, then compute org use <slug>.');
    // A one-off override must not change the server's shared active org or
    // cache it as the default for subsequent commands on this machine.
    await saveCredentials({
      ...credentials, ...(active ? { orgSlug: active.slug, orgId: active.id } : {}),
    });
    if (options.json) console.log(JSON.stringify({ signedIn: true, organization: effective.slug }));
    else console.error(`Signed in. ${override ? 'Using' : 'Active'} organization: ${effective.slug}.`);
    return;
  }
  removePending(baseUrl, device.device_code);
  throw new Error('Sign-in code expired. Run compute login to get a new code.');
}
