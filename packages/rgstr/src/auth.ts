// RFC 8628 device-code login, the same flow `compute login` uses. The
// authorization server is discovered from the rgstr origin's RFC 9728
// protected-resource metadata, so a login against rgstr.org talks to the
// platform issuer without the CLI hard-coding a second host.

import { saveCredentials, type Credentials } from './config.js';
import { isSecureTransport } from './hosts.js';

/** First-party client shared with `compute` / `bench`; the platform seeds it. */
export const RGSTR_OAUTH_CLIENT_ID = 'benchsdk-cli';
// org:admin: claims and routes are owner/admin writes (resolveActionsApiOrg requireAdmin).
export const RGSTR_OAUTH_SCOPE = 'packages:read packages:write org:read org:admin offline_access';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export class DeviceFlowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceFlowError';
  }
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthServer {
  /** better-auth mount, e.g. https://platform.computesdk.com/api/auth */
  authBaseUrl: string;
  /** Token audience, e.g. https://platform.computesdk.com/api/v1 */
  resource: string;
}

/** `<origin>/.well-known/oauth-protected-resource/api/v1` names the issuer and resource. */
export async function discoverAuthServer(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthServer> {
  const res = await fetchImpl(`${baseUrl}/.well-known/oauth-protected-resource/api/v1`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new AuthError(`Could not discover the login server at ${baseUrl} (${res.status})`);
  const meta = (await res.json()) as { resource?: string; authorization_servers?: string[] };
  const authBaseUrl = meta.authorization_servers?.[0];
  if (!authBaseUrl || !meta.resource) {
    throw new AuthError(`Unexpected protected-resource metadata from ${baseUrl}`);
  }
  // Tokens go to the discovered issuer, so it gets the same transport rule as the origin.
  if (!isSecureTransport(authBaseUrl)) {
    throw new AuthError(`Refusing to log in: ${baseUrl} advertises a plaintext authorization server (${authBaseUrl}).`);
  }
  return { authBaseUrl: authBaseUrl.replace(/\/+$/, ''), resource: meta.resource };
}

function formPost(url: string, params: Record<string, string>, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
}

async function errorDescription(response: Response, text: string): Promise<{ code: string; description: string }> {
  let body: { error?: string; error_description?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON
  }
  return {
    code: body.error ?? 'server_error',
    description: body.error_description ?? `Request failed: ${response.status} ${response.statusText}`,
  };
}

export async function requestDeviceCode(
  server: AuthServer,
  clientId: string,
  scope: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeviceCodeResponse> {
  const response = await formPost(
    `${server.authBaseUrl}/device/code`,
    { client_id: clientId, resource: server.resource, scope },
    fetchImpl,
  );
  const text = await response.text();
  if (!response.ok) {
    const { description } = await errorDescription(response, text);
    throw new DeviceFlowError('server_error', description);
  }
  return JSON.parse(text) as DeviceCodeResponse;
}

export async function exchangeDeviceToken(
  server: AuthServer,
  deviceCode: string,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const response = await formPost(
    `${server.authBaseUrl}/oauth2/token`,
    {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: clientId,
      resource: server.resource,
    },
    fetchImpl,
  );
  const text = await response.text();
  if (!response.ok) {
    const { code, description } = await errorDescription(response, text);
    if (['authorization_pending', 'slow_down', 'expired_token', 'access_denied', 'invalid_grant'].includes(code)) {
      throw new DeviceFlowError(code, description);
    }
    throw new Error(description);
  }
  return JSON.parse(text) as TokenResponse;
}

export async function refreshAccessToken(
  server: AuthServer,
  refreshToken: string,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const response = await formPost(
    `${server.authBaseUrl}/oauth2/token`,
    { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId },
    fetchImpl,
  );
  const text = await response.text();
  if (!response.ok) {
    const { description } = await errorDescription(response, text);
    throw new AuthError(description);
  }
  return JSON.parse(text) as TokenResponse;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function pollDeviceToken(
  server: AuthServer,
  code: DeviceCodeResponse,
  clientId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
  const start = Date.now();
  let interval = code.interval * 1000;
  const expiresIn = code.expires_in * 1000;
  while (Date.now() - start < expiresIn) {
    await sleep(interval);
    try {
      return await exchangeDeviceToken(server, code.device_code, clientId, fetchImpl);
    } catch (err) {
      if (err instanceof DeviceFlowError) {
        if (err.code === 'authorization_pending') continue;
        if (err.code === 'slow_down') {
          interval += 5000;
          continue;
        }
      }
      throw err;
    }
  }
  throw new DeviceFlowError('expired_token', 'Device code expired before authorization completed.');
}

export interface DeviceLoginOptions {
  baseUrl: string;
  clientId?: string;
  scope?: string;
  /** Called once the user has somewhere to go. */
  onPrompt?: (code: DeviceCodeResponse) => void;
  fetchImpl?: typeof fetch;
}

/** Run the whole device flow and persist the credentials for `baseUrl`. */
export async function deviceLogin(options: DeviceLoginOptions): Promise<Credentials> {
  const clientId = options.clientId ?? RGSTR_OAUTH_CLIENT_ID;
  const scope = options.scope ?? RGSTR_OAUTH_SCOPE;
  const fetchImpl = options.fetchImpl ?? fetch;
  const server = await discoverAuthServer(options.baseUrl, fetchImpl);
  const code = await requestDeviceCode(server, clientId, scope, fetchImpl);
  options.onPrompt?.(code);
  const token = await pollDeviceToken(server, code, clientId, fetchImpl);
  const credentials: Credentials = {
    baseUrl: options.baseUrl,
    token: token.access_token,
    refreshToken: token.refresh_token,
    tokenExpiresAt: Date.now() + token.expires_in * 1000,
    clientId,
    authBaseUrl: server.authBaseUrl,
    resource: server.resource,
  };
  await saveCredentials(credentials);
  return credentials;
}
