/**
 * Browserless Browser Provider - Factory-based Implementation
 *
 * Cloud browser sessions via Browserless (https://browserless.io). Browserless
 * has no create-session REST call on the shared fleet: a session materializes
 * when the client opens the CDP websocket. `session.create()` therefore mints
 * a `trackingId` and returns the connect URL for it; the session starts when
 * `chromium.connectOverCDP(connectUrl)` opens, and ends on disconnect or via
 * `session.destroy()` (`/kill/<trackingId>`).
 */

import { randomUUID } from 'node:crypto';
import { defineBrowserProvider } from '@computesdk/provider';

import type { CreateBrowserSessionOptions } from '@computesdk/provider';

/**
 * Shape of a running session as returned by `GET /sessions`.
 * `/sessions` is available on private/enterprise fleets; on the shared fleet
 * it may return 401 — list/getById surface that error rather than masking it.
 */
export interface BrowserlessSession {
  browserId: string;
  trackingId: string | null;
  running: boolean;
  startedOn: number;
  timeAliveMs?: number;
  browser?: string;
  type?: string;
}

/**
 * Browserless-specific configuration options.
 */
export interface BrowserlessConfig {
  /** Browserless API token — falls back to BROWSERLESS_API_KEY env var */
  apiKey?: string;
  /**
   * Fleet base URL — falls back to BROWSERLESS_URL env var, then the shared
   * US West fleet. Shared fleet: production-sfo|lon|ams.browserless.io.
   * Private fleet: chrome.browserless.io or chrome-<region>.browserless.io
   * (a private-fleet token against a shared-fleet host returns 401).
   */
  baseUrl?: string;
}

function resolveConfig(config: BrowserlessConfig) {
  const apiKey =
    config.apiKey || (typeof process !== 'undefined' && process.env?.BROWSERLESS_API_KEY) || '';
  if (!apiKey) {
    throw new Error(
      `Missing Browserless API key. Provide 'apiKey' in config or set BROWSERLESS_API_KEY environment variable. ` +
        `Get your API key from https://account.browserless.io`,
    );
  }
  const baseUrl = (
    config.baseUrl ||
    (typeof process !== 'undefined' && process.env?.BROWSERLESS_URL) ||
    'https://production-sfo.browserless.io'
  ).replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

/** http(s) base URL → ws(s) equivalent for the websocket endpoint. */
function wsBase(baseUrl: string): string {
  return baseUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

const warnedUnsupported = new Set<string>();
function warnOnce(field: string, reason: string) {
  if (warnedUnsupported.has(field)) return;
  warnedUnsupported.add(field);
  console.warn(`[@computesdk/browserless] '${field}' is ignored: ${reason}`);
}

/**
 * Build the CDP connect URL for a session. The token authenticates the
 * websocket; `trackingId` is the session handle used by list/destroy.
 * `launch` query params are only meaningful if they land before the client
 * connects — they live on the connect URL by Browserless design.
 *
 * SECURITY: the returned URL embeds the account API token as a query
 * parameter. Treat it as a secret — do not log or persist it.
 */
function buildConnectUrl(baseUrl: string, apiKey: string, trackingId: string, options?: CreateBrowserSessionOptions): string {
  const url = new URL(`${wsBase(baseUrl)}/chromium`);
  url.searchParams.set('token', apiKey);
  url.searchParams.set('trackingId', trackingId);
  if (!options) return url.toString();

  if (options.stealth) url.searchParams.set('stealth', 'true');
  if (options.viewport) {
    url.searchParams.set('launch', JSON.stringify({
      defaultViewport: { width: options.viewport.width, height: options.viewport.height },
    }));
  }
  if (options.proxies === true) url.searchParams.set('proxy', 'residential');

  if (options.keepAlive === true) {
    warnOnce('keepAlive', 'Browserless sessions live until disconnect or /kill; no keep-alive flag.');
  }
  if (options.recording === false) {
    warnOnce('recording', 'Session recording is managed server-side; no per-session toggle on the connect URL.');
  }
  if (options.userMetadata && Object.keys(options.userMetadata).length > 0) {
    warnOnce('userMetadata', 'Browserless does not support arbitrary user metadata on sessions.');
  }
  if (Array.isArray(options.proxies) && options.proxies.length > 0) {
    warnOnce('proxies', 'Custom proxy servers are a Browserless enterprise feature; only proxies=true maps (residential).');
  }

  return url.toString();
}

async function listSessions(baseUrl: string, apiKey: string): Promise<BrowserlessSession[]> {
  const r = await fetch(`${baseUrl}/sessions?token=${enc(apiKey)}`);
  if (!r.ok) throw new Error(`browserless /sessions ${r.status}: ${await r.text()}`);
  return (await r.json()) as BrowserlessSession[];
}

function toEntry(s: BrowserlessSession) {
  return {
    session: s,
    sessionId: s.trackingId ?? s.browserId,
    status: (s.running ? 'running' : 'created') as 'running' | 'created',
  };
}

/**
 * Create a Browserless browser provider instance.
 *
 * @example
 * ```ts
 * import { browserless } from '@computesdk/browserless';
 * import { chromium } from 'playwright-core';
 *
 * const bl = browserless({ apiKey: process.env.BROWSERLESS_API_KEY });
 *
 * // Mints a trackingId; the session starts when the socket opens.
 * const session = await bl.session.create();
 *
 * const browser = await chromium.connectOverCDP(session.connectUrl);
 * const page = browser.contexts()[0].pages()[0];
 * await page.goto('https://example.com');
 *
 * await session.destroy(); // or just browser.close() — disconnect ends it
 * ```
 */
export const browserless = defineBrowserProvider<BrowserlessSession, BrowserlessConfig>({
  name: 'browserless',
  methods: {
    session: {
      create: async (config: BrowserlessConfig, options?: CreateBrowserSessionOptions) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        // No REST create call — the trackingId becomes the session identity
        // and the browser allocates when the client connects to the URL.
        const trackingId = randomUUID();
        return {
          session: { browserId: trackingId, trackingId, running: true, startedOn: Date.now() },
          sessionId: trackingId,
          connectUrl: buildConnectUrl(baseUrl, apiKey, trackingId, options),
          status: 'created',
        };
      },

      getById: async (config: BrowserlessConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        const found = (await listSessions(baseUrl, apiKey)).find(
          (s) => s.trackingId === sessionId || s.browserId === sessionId,
        );
        if (!found) return null;
        return { ...toEntry(found), connectUrl: buildConnectUrl(baseUrl, apiKey, found.trackingId ?? sessionId) };
      },

      list: async (config: BrowserlessConfig) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        return (await listSessions(baseUrl, apiKey)).map(toEntry);
      },

      destroy: async (config: BrowserlessConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        // /kill accepts a browserId or trackingId; a missing session is a no-op.
        const r = await fetch(`${baseUrl}/kill/${enc(sessionId)}?token=${enc(apiKey)}`);
        if (!r.ok && r.status !== 404) {
          throw new Error(`browserless destroy ${r.status}: ${await r.text()}`);
        }
      },

      getConnectUrl: async (config: BrowserlessConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        return buildConnectUrl(baseUrl, apiKey, sessionId);
      },
    },
  },
});
