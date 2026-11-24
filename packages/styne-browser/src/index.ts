/**
 * Styne Browser Provider - Factory-based Implementation
 *
 * Cloud browser sessions via Styne (https://styne.ai). Each session runs Chromium in its own
 * microVM; `POST /browsers` returns a CDP websocket URL (`cdp_url`) with a page already open in
 * the default context. Profiles keep cookies and storage between sessions.
 */

import { randomUUID } from 'node:crypto';
import { defineBrowserProvider } from '@computesdk/provider';

import type {
  BrowserProfile,
  BrowserSession,
  CreateBrowserProfileOptions,
  CreateBrowserSessionOptions,
  ProxyConfig,
} from '@computesdk/provider';

/**
 * Shape of a browser session as returned by the REST API.
 */
export interface StyneBrowserSession {
  id: string;
  /** `running`; `paused`, `standby` or `archived` while it sleeps; `expired` or `stopped` once it ended */
  state: string;
  /** CDP websocket URL. Carries an auth token, don't log it. */
  cdp_url: string;
  expires_at?: number;
  region?: string;
  profile?: string;
}

interface StyneProfile {
  id: string;
  end_user: string;
  label?: string;
  state?: string;
  created?: number;
}

/**
 * Styne-specific configuration options.
 */
export interface StyneBrowserConfig {
  /** Styne API key - falls back to STYNE_API_KEY env var */
  apiKey?: string;
  /** API base URL - falls back to STYNE_API_URL env var, then https://api.styne.ai */
  apiUrl?: string;
}

/** Non-2xx response from the Styne API. */
export class StyneApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'StyneApiError';
  }
}

const DEFAULT_API_URL = 'https://api.styne.ai';
const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 5_000;
const CALL_DEADLINE_MS = 60_000;
const ATTEMPT_TIMEOUT_MS = 30_000;
const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const QUOTA_CODES = new Set(['quota_exceeded', 'resident_limit', 'storage_limit']);
const NOT_FOUND_CODES = new Set(['not_found', 'profile_not_found']);

function resolveConfig(config: StyneBrowserConfig) {
  const apiKey =
    config.apiKey || (typeof process !== 'undefined' && process.env?.STYNE_API_KEY) || '';
  if (!apiKey) {
    throw new Error(
      `Missing Styne API key. Provide 'apiKey' in config or set STYNE_API_KEY environment variable. ` +
        `Get your API key from https://app.styne.ai`,
    );
  }
  const url = new URL(
    (config.apiUrl || (typeof process !== 'undefined' && process.env?.STYNE_API_URL) || DEFAULT_API_URL).trim(),
  );
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error(`Styne apiUrl must use https (got ${url.protocol}//${url.host})`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Styne apiUrl must not contain credentials, a query or a fragment');
  }
  return { apiKey, apiUrl: `${url.origin}${url.pathname.replace(/\/+$/, '')}` };
}

const warnedUnsupported = new Set<string>();
function warnOnce(field: string, reason: string) {
  if (warnedUnsupported.has(field)) return;
  warnedUnsupported.add(field);
  console.warn(`[@computesdk/styne-browser] '${field}' is ignored: ${reason}`);
}

/** Strip the API key from error text before throwing. */
function redact(text: string, apiKey: string): string {
  return text.split(apiKey).join('***');
}

function mapProxies(proxies: boolean | ProxyConfig[] | undefined, body: Record<string, unknown>) {
  if (proxies === true) {
    body.egress = 'residential';
    return;
  }
  if (!Array.isArray(proxies) || proxies.length === 0) return;

  const [first] = proxies;
  if (proxies.length > 1) warnOnce('proxies', 'Styne uses one exit per session; only the first entry is applied.');
  if (first.type === 'custom') {
    warnOnce('proxies.custom', 'Styne does not support custom proxy servers.');
    return;
  }
  // isp -> residential exit, datacenter -> Mullvad exit
  body.egress = first.type === 'datacenter' ? 'mullvad' : 'residential';
  if (first.geolocation?.country) body.country = first.geolocation.country.toLowerCase();
  if (first.geolocation?.state || first.geolocation?.city) {
    warnOnce('proxies.geolocation', 'Styne picks the exit by country only.');
  }
  if (first.domainPattern) warnOnce('proxies.domainPattern', 'Styne has no per-domain proxy rules.');
}

/** Map ComputeSDK session options to Styne create-session params. */
function toCreateBody(options: CreateBrowserSessionOptions = {}) {
  const body: Record<string, unknown> = {};
  if (options.timeout !== undefined) {
    if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
      throw new Error(`Styne timeout must be a positive number of seconds (got ${options.timeout})`);
    }
    body.timeout = Math.ceil(options.timeout);
  }
  if (options.region) body.region = options.region;
  if (options.profileId) {
    body.profile = options.profileId;
    body.persist = true;
  }
  if (options.viewport) body.viewport = { width: options.viewport.width, height: options.viewport.height };
  if (options.userMetadata && Object.keys(options.userMetadata).length > 0) body.metadata = options.userMetadata;
  if (options.saveDownloads) body.downloads = true;
  // keepAlive: don't sleep while no client is connected.
  if (options.keepAlive === true) body.idle_timeout_seconds = 0;
  // Unblocking and CAPTCHA clicks are on by default.
  if (options.stealth === true) body.captcha = 'solve';
  if (options.stealth === false) {
    body.unblock = 'off';
    body.captcha = 'off';
  }
  // Console logs and network events come from the same capture as the recording.
  if (options.recording === false || options.logging === false) body.recording = false;
  mapProxies(options.proxies, body);

  if (options.keepAlive === false) {
    warnOnce('keepAlive', 'Styne sessions run until timeout or destroy(), not until disconnect.');
  }
  if (options.extensionIds?.length) warnOnce('extensionIds', 'Styne does not load custom extensions.');
  return body;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const backoff = (attempt: number) => Math.min(1000 * 2 ** attempt + Math.random() * 250, MAX_RETRY_WAIT_MS);

/** Wait before the next attempt, or null when Retry-After asks for more than we wait. */
function retryDelay(attempt: number, retryAfter: string | null): number | null {
  const value = retryAfter?.trim();
  if (value) {
    const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
    if (!Number.isNaN(ms)) return ms <= MAX_RETRY_WAIT_MS ? Math.max(ms, 100) : null;
  }
  return backoff(attempt);
}

function toApiError(response: Response, raw: string, label: string, apiKey: string) {
  const text = redact(raw, apiKey);
  let body: { message?: unknown; error_code?: unknown; request_id?: string } = {};
  try {
    body = JSON.parse(text) ?? {};
  } catch {
    // plain-text body
  }
  const message = typeof body.message === 'string' ? body.message : text.slice(0, 500) || response.statusText;
  const code = typeof body.error_code === 'string' ? body.error_code : undefined;
  const requestId = body.request_id ?? response.headers.get('x-request-id') ?? undefined;
  return new StyneApiError(
    response.status,
    `Styne ${label} failed (${response.status}${code ? ` ${code}` : ''}): ${message}`,
    code,
    requestId,
  );
}

interface RequestOptions {
  body?: unknown;
  /** Return null on a confirmed 404 instead of throwing */
  allowNotFound?: boolean;
  /** Sent as Idempotency-Key; makes a POST retryable */
  idempotencyKey?: string;
  /** Override the default: GET, DELETE and keyed POSTs retry */
  retry?: boolean;
}

/**
 * Retries on network errors, unreadable 2xx bodies, 429 (not quotas), 502/503/504 and
 * 409 `conflict` while the same Idempotency-Key is in flight, within one deadline per call.
 */
async function request<T>(
  config: StyneBrowserConfig,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<T | null> {
  const { apiKey, apiUrl } = resolveConfig(config);
  const label = `${method} ${path}`;
  const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${apiKey}` };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  const retryable = options.retry ?? (method !== 'POST' || options.idempotencyKey !== undefined);
  const deadline = Date.now() + CALL_DEADLINE_MS;

  for (let attempt = 0; ; attempt++) {
    const retryAfter = async (delay: number | null) => {
      if (!retryable || attempt >= MAX_RETRIES || delay === null || Date.now() + delay >= deadline) return false;
      await sleep(delay);
      return true;
    };
    let response: Response;
    let text: string;
    try {
      response = await fetch(`${apiUrl}${path}`, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(Math.max(1, Math.min(ATTEMPT_TIMEOUT_MS, deadline - Date.now()))),
      });
      text = await response.text();
    } catch (error) {
      if (await retryAfter(backoff(attempt))) continue;
      const reason = error instanceof Error ? error.message : String(error);
      throw Object.assign(new Error(`Styne ${label} failed: ${redact(reason, apiKey)}`), { cause: error });
    }

    if (response.ok) {
      if (!text.trim()) return null;
      try {
        return JSON.parse(text) as T;
      } catch (error) {
        if (await retryAfter(backoff(attempt))) continue;
        const requestId = response.headers.get('x-request-id') ?? undefined;
        const message = `Styne ${label} failed: unreadable ${response.status} response`;
        throw Object.assign(new StyneApiError(response.status, message, undefined, requestId), { cause: error });
      }
    }

    const error = toApiError(response, text, label, apiKey);
    if (response.status === 404 && options.allowNotFound && NOT_FOUND_CODES.has(error.code ?? '')) return null;
    const transient =
      (RETRY_STATUSES.has(response.status) && !QUOTA_CODES.has(error.code ?? '')) ||
      (response.status === 409 && error.code === 'conflict' && options.idempotencyKey !== undefined);
    if (transient && (await retryAfter(retryDelay(attempt, response.headers.get('retry-after'))))) continue;
    throw error;
  }
}

const browserPath = (id: string) => `/browsers/${encodeURIComponent(id)}`;
const profilePath = (id: string) => `/profiles/${encodeURIComponent(id)}`;

const STATUSES: Record<string, BrowserSession['status']> = {
  running: 'running',
  standby: 'running',
  paused: 'created',
  archived: 'created',
  expired: 'timed_out',
  stopped: 'completed',
};
const ASLEEP = new Set(['paused', 'archived']);

function toEntry(session: StyneBrowserSession) {
  const status = STATUSES[session.state] ?? 'failed';
  return { session, sessionId: session.id, connectUrl: session.cdp_url, status };
}

/** Read a session, resuming it first when it sleeps so its cdp_url connects. */
async function readAwake(config: StyneBrowserConfig, sessionId: string, allowNotFound = false) {
  const session = await request<StyneBrowserSession>(config, 'GET', browserPath(sessionId), { allowNotFound });
  if (!session || !ASLEEP.has(session.state)) return session;
  const left = session.expires_at ? session.expires_at - Math.floor(Date.now() / 1000) : 0;
  await request(config, 'POST', `/sandboxes/${encodeURIComponent(sessionId)}/resume`, {
    body: left > 0 ? { timeout: left } : {},
    retry: true,
  }).catch((error) => {
    if (!(error instanceof StyneApiError && error.status === 409)) throw error;
  });
  return request<StyneBrowserSession>(config, 'GET', browserPath(sessionId), { allowNotFound });
}

function toProfile(profile: StyneProfile): BrowserProfile {
  return {
    profileId: profile.id,
    name: profile.label || profile.end_user,
    createdAt: profile.created ? new Date(profile.created * 1000) : undefined,
    metadata: { ...profile },
  };
}

/** Sessions started from a profile, saved back into it on destroy. */
const profileSessions = new Map<string, string>();

/**
 * Create a Styne browser provider instance.
 */
export const styneBrowser = defineBrowserProvider<StyneBrowserSession, StyneBrowserConfig>({
  name: 'styne-browser',
  methods: {
    session: {
      create: async (config: StyneBrowserConfig, options?: CreateBrowserSessionOptions) => {
        const body = toCreateBody(options);
        const idempotencyKey = randomUUID();
        const post = (retry?: boolean) =>
          request<StyneBrowserSession>(config, 'POST', '/browsers', { body, idempotencyKey, retry });
        let session: StyneBrowserSession | null;
        try {
          session = await post();
        } catch (error) {
          // A refused create started nothing; otherwise the replay returns the session the key started, if any.
          if (error instanceof StyneApiError && error.status >= 400 && error.status < 500 && error.status !== 409) throw error;
          session = await post(false).catch(() => {
            const failure = error instanceof Error ? error : new Error(String(error));
            failure.message += ` (a session may have started: replay POST /browsers with Idempotency-Key ${idempotencyKey})`;
            throw Object.assign(failure, { idempotencyKey });
          });
        }
        if (!session?.id || typeof session.cdp_url !== 'string' || !session.cdp_url) {
          const id = session?.id;
          const cleanup = id
            ? await request(config, 'DELETE', browserPath(id), { allowNotFound: true }).then(
                () => `session ${id} deleted`,
                (error: Error) => `session ${id} could not be deleted: ${error.message}`,
              )
            : 'no session id returned';
          throw Object.assign(new Error(`Styne POST /browsers: response missing id or cdp_url (${cleanup})`), {
            sessionId: id,
            idempotencyKey,
          });
        }
        if (options?.profileId) profileSessions.set(session.id, options.profileId);
        return toEntry(session);
      },

      getById: async (config: StyneBrowserConfig, sessionId: string) => {
        const session = await readAwake(config, sessionId, true);
        return session ? toEntry(session) : null;
      },

      list: async (config: StyneBrowserConfig) => {
        const body = await request<{ sessions?: StyneBrowserSession[] }>(config, 'GET', '/browsers');
        return (body?.sessions ?? []).map((session) => {
          const entry = toEntry(session);
          return entry.status === 'running' ? entry : { ...entry, connectUrl: undefined };
        });
      },

      destroy: async (config: StyneBrowserConfig, sessionId: string) => {
        const profileId = profileSessions.get(sessionId);
        try {
          if (profileId) {
            await request(config, 'POST', `${profilePath(profileId)}/save`, {
              body: { browser_id: sessionId },
              allowNotFound: true,
              retry: true,
            });
          }
        } finally {
          await request(config, 'DELETE', browserPath(sessionId), { allowNotFound: true });
        }
        profileSessions.delete(sessionId);
      },

      getConnectUrl: async (config: StyneBrowserConfig, sessionId: string) => {
        const session = await readAwake(config, sessionId);
        if (!session?.cdp_url || STATUSES[session.state] !== 'running') {
          throw new Error(`Styne session ${sessionId} is ${session?.state ?? 'unknown'}, not connectable`);
        }
        return session.cdp_url;
      },
    },

    profile: {
      create: async (config: StyneBrowserConfig, options?: CreateBrowserProfileOptions) => {
        const { end_user: endUser, ...rest } = options?.metadata ?? {};
        if (Object.keys(rest).length > 0) {
          warnOnce('profile.metadata', 'Styne keeps only `end_user` from profile metadata.');
        }
        const profile = await request<StyneProfile>(config, 'POST', '/profiles', {
          body: { end_user: endUser || options?.name || 'default', label: options?.name },
        });
        if (!profile?.id) throw new Error('Styne POST /profiles: response missing id');
        return toProfile(profile);
      },

      get: async (config: StyneBrowserConfig, profileId: string) => {
        const profile = await request<StyneProfile>(config, 'GET', profilePath(profileId), { allowNotFound: true });
        return profile ? toProfile(profile) : null;
      },

      list: async (config: StyneBrowserConfig) => {
        const body = await request<{ profiles?: StyneProfile[] }>(config, 'GET', '/profiles');
        return (body?.profiles ?? []).map(toProfile);
      },

      delete: async (config: StyneBrowserConfig, profileId: string) => {
        await request(config, 'DELETE', profilePath(profileId), { allowNotFound: true });
      },
    },
  },
});
