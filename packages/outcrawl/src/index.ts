/**
 * Outcrawl Browser Provider - Factory-based Implementation
 *
 * Cloud browser sessions via Outcrawl (https://outcrawl.ai). A session is
 * allocated with one authenticated call, `GET /connect`, which answers with a
 * CDP websocket endpoint (`wsEndpoint`) and the expiry of that connect ticket
 * (not of the session). The caller drives it with Playwright, Puppeteer or any
 * CDP client. `destroy()` ends the session and its billing with
 * `DELETE /v1/sessions/{id}`; the recording is kept.
 *
 * Re-attaching to a session (`getConnectUrl`) works only for a session created
 * held, with `keepAlive: true`, which maps to Outcrawl's `idle_timeout`.
 */

import { createHash } from 'node:crypto';

import { defineBrowserProvider } from '@computesdk/provider';

import type { CreateBrowserSessionOptions } from '@computesdk/provider';

/** Answer of `GET /connect`. */
interface OutcrawlAllocation {
  sessionId: string;
  wsEndpoint: string;
  expiresAt?: string;
}

/**
 * A session as returned by `GET /v1/sessions` and `GET /v1/sessions/{id}`.
 * Only the fields this provider reads are typed.
 */
export interface OutcrawlSession {
  id: string;
  status?: 'running' | 'completed' | 'partial' | 'failed';
  replayUrl?: string;
  duration?: number;
  [key: string]: unknown;
}

/**
 * Outcrawl-specific configuration options.
 */
export interface OutcrawlConfig {
  /** Outcrawl API key — falls back to OUTCRAWL_API_KEY env var */
  apiKey?: string;
  /** API base URL — falls back to OUTCRAWL_URL env var, then https://api.outcrawl.ai */
  baseUrl?: string;
}

/** Outcrawl accepts an idle timeout of 10 to 21600 seconds for a held session. */
const MIN_IDLE_TIMEOUT_S = 10;
const MAX_IDLE_TIMEOUT_S = 21600;
const DEFAULT_IDLE_TIMEOUT_S = 300;

function resolveConfig(config: OutcrawlConfig) {
  const apiKey =
    config.apiKey || (typeof process !== 'undefined' && process.env?.OUTCRAWL_API_KEY) || '';
  if (!apiKey) {
    throw new Error(
      `Missing Outcrawl API key. Provide 'apiKey' in config or set OUTCRAWL_API_KEY environment variable. ` +
        `Get your API key from https://outcrawl.ai/sign-in`,
    );
  }
  const baseUrl = (
    config.baseUrl ||
    (typeof process !== 'undefined' && process.env?.OUTCRAWL_URL) ||
    'https://api.outcrawl.ai'
  ).replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

const warnedUnsupported = new Set<string>();
function warnOnce(field: string, reason: string) {
  if (warnedUnsupported.has(field)) return;
  warnedUnsupported.add(field);
  console.warn(`[@computesdk/outcrawl] '${field}' is ignored: ${reason}`);
}

/**
 * Connect tickets handed out by `create()`, by session id. A session that was
 * allocated but not yet opened over CDP has no record on Outcrawl's side, so
 * `session=<id>` cannot re-attach to it; until the ticket expires,
 * `getConnectUrl()` returns the one `create()` gave. A ticket is a bearer
 * credential, so each entry is scoped to the API key and base URL that
 * allocated it and is never returned to another client. Same-process only;
 * entries expire with the ticket and are dropped on destroy.
 */
const issuedTickets = new Map<string, { wsEndpoint: string; expiresAt: number }>();

function ticketKey(baseUrl: string, apiKey: string, sessionId: string): string {
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  return `${baseUrl}\n${keyHash}\n${sessionId}`;
}

/** Strip the API key from provider error bodies before throwing. */
function redact(body: string, apiKey: string): string {
  return body.split(apiKey).join('***');
}

/** Build the `/connect` query for a new session from the shared create options. */
function connectParams(options?: CreateBrowserSessionOptions): Record<string, string> {
  const params: Record<string, string> = {};
  if (!options) return params;

  if (options.profileId) params.profile = options.profileId;
  if (options.recording === false) params.record = 'false';
  if (options.keepAlive === true) {
    const seconds = options.timeout ?? DEFAULT_IDLE_TIMEOUT_S;
    params.idle_timeout = String(Math.min(MAX_IDLE_TIMEOUT_S, Math.max(MIN_IDLE_TIMEOUT_S, Math.round(seconds))));
  }

  if (Array.isArray(options.proxies) && options.proxies.length > 0) {
    const [first] = options.proxies;
    if (options.proxies.length > 1) {
      warnOnce('proxies', 'Outcrawl takes one proxy per session; only the first entry is used.');
    }
    if (first.type === 'custom' && first.server) {
      const url = new URL(first.server);
      if (first.username) url.username = first.username;
      if (first.password) url.password = first.password;
      params.proxy = url.toString();
    } else if (first.geolocation?.country) {
      params.proxy_country = first.geolocation.country;
      if (first.geolocation.state) params.proxy_region = first.geolocation.state;
      if (first.geolocation.city) params.proxy_city = first.geolocation.city;
    }
    if (first.domainPattern) {
      warnOnce('proxies.domainPattern', 'Outcrawl routes the whole session through one exit; no per-domain proxy rules.');
    }
  }
  // proxies === true needs no param: every Outcrawl session already leaves from a residential exit.

  if (options.viewport) {
    warnOnce('viewport', 'The browser window follows the page; no viewport option on /connect.');
  }
  if (options.timeout !== undefined && options.keepAlive !== true) {
    warnOnce('timeout', 'Outcrawl has no per-session timeout; with keepAlive the value sets the idle timeout instead.');
  }
  if (options.logging === false) {
    warnOnce('logging', 'Session logging is managed server-side; no per-session toggle.');
  }
  if (options.extensionIds && options.extensionIds.length > 0) {
    warnOnce('extensionIds', 'Outcrawl does not load custom browser extensions.');
  }
  if (options.region !== undefined) {
    warnOnce('region', 'Outcrawl picks the browser location; choose a proxy geolocation for the exit instead.');
  }
  if (options.saveDownloads === true) {
    warnOnce('saveDownloads', 'Downloads are always kept for 7 days and read through the Outcrawl sessions API.');
  }
  if (options.userMetadata && Object.keys(options.userMetadata).length > 0) {
    warnOnce('userMetadata', 'Outcrawl does not support arbitrary user metadata on sessions.');
  }
  // stealth: every Outcrawl session is a stealth browser; nothing to switch on.

  return params;
}

/** Allocate a session (or re-attach to a held one with `session`) and return its CDP endpoint. */
async function connect(
  baseUrl: string,
  apiKey: string,
  params: Record<string, string>,
): Promise<OutcrawlAllocation> {
  const url = new URL(`${baseUrl}/connect`);
  url.searchParams.set('token', apiKey);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`outcrawl /connect ${r.status}: ${redact(await r.text(), apiKey)}`);
  const body = (await r.json()) as OutcrawlAllocation;
  if (!body?.sessionId || !body?.wsEndpoint) {
    throw new Error('outcrawl /connect answered without a sessionId and wsEndpoint');
  }
  return body;
}

async function apiGet(baseUrl: string, apiKey: string, path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
  });
}

/** Item answers come either bare or wrapped in `{ data }`. */
function unwrap<T>(body: unknown): T {
  const record = body as { data?: unknown } | null;
  return (record && typeof record === 'object' && record.data && !Array.isArray(record.data)
    ? record.data
    : body) as T;
}

function toStatus(status: OutcrawlSession['status']): 'running' | 'completed' | 'failed' {
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  return 'completed';
}

function toEntry(s: OutcrawlSession) {
  return { session: s, sessionId: s.id, status: toStatus(s.status) };
}

/**
 * Create an Outcrawl browser provider instance.
 *
 * @example
 * ```ts
 * import { outcrawl } from '@computesdk/outcrawl';
 * import { chromium } from 'playwright-core';
 *
 * const oc = outcrawl({ apiKey: process.env.OUTCRAWL_API_KEY });
 *
 * const session = await oc.session.create();
 *
 * const browser = await chromium.connectOverCDP(session.connectUrl);
 * const page = await browser.newPage();
 * await page.goto('https://example.com');
 *
 * await session.destroy();
 * ```
 */
export const outcrawl = defineBrowserProvider<OutcrawlSession, OutcrawlConfig>({
  name: 'outcrawl',
  methods: {
    session: {
      create: async (config: OutcrawlConfig, options?: CreateBrowserSessionOptions) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        const allocation = await connect(baseUrl, apiKey, connectParams(options));
        const expiresAt = Date.parse(allocation.expiresAt ?? '');
        if (Number.isFinite(expiresAt)) {
          issuedTickets.set(ticketKey(baseUrl, apiKey, allocation.sessionId), { wsEndpoint: allocation.wsEndpoint, expiresAt });
        }
        return {
          session: { id: allocation.sessionId, status: 'running' as const },
          sessionId: allocation.sessionId,
          connectUrl: allocation.wsEndpoint,
          status: 'running' as const,
        };
      },

      getById: async (config: OutcrawlConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        const r = await apiGet(baseUrl, apiKey, `/v1/sessions/${encodeURIComponent(sessionId)}`);
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`outcrawl sessions.get ${r.status}: ${redact(await r.text(), apiKey)}`);
        const session = unwrap<OutcrawlSession>(await r.json());
        // A session read carries no live endpoint: use getConnectUrl() for a held session.
        return { ...toEntry({ ...session, id: session.id ?? sessionId }), connectUrl: '' };
      },

      list: async (config: OutcrawlConfig) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        const r = await apiGet(baseUrl, apiKey, '/v1/sessions');
        if (!r.ok) throw new Error(`outcrawl sessions.list ${r.status}: ${redact(await r.text(), apiKey)}`);
        const body = (await r.json()) as { data?: OutcrawlSession[] };
        return (Array.isArray(body?.data) ? body.data : []).map(toEntry);
      },

      destroy: async (config: OutcrawlConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        const r = await fetch(`${baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}`, {
          method: 'DELETE',
          headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
        });
        issuedTickets.delete(ticketKey(baseUrl, apiKey, sessionId));
        // A session that no longer exists has nothing left to end.
        if (!r.ok && r.status !== 404) {
          throw new Error(`outcrawl destroy ${r.status}: ${redact(await r.text(), apiKey)}`);
        }
      },

      getConnectUrl: async (config: OutcrawlConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        // A session allocated here but not yet opened has no server-side record to re-attach to:
        // hand back its own unexpired ticket.
        const issued = issuedTickets.get(ticketKey(baseUrl, apiKey, sessionId));
        if (issued && issued.expiresAt > Date.now()) return issued.wsEndpoint;
        // Otherwise re-attach with session=<id>: valid only for a held session (create with keepAlive).
        return (await connect(baseUrl, apiKey, { session: sessionId })).wsEndpoint;
      },
    },
  },
});
