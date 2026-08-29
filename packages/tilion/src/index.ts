/**
 * Tilion Browser Provider - Factory-based Implementation
 *
 * Cloud browser sessions via the Tilion platform (https://tilion.dev). Tilion's API returns an
 * authenticated CDP websocket url inline on create, so `connectOverCDP` works with no extra round
 * trip. Sessions here are created non-stealth with direct egress, to match how the other providers
 * are benchmarked.
 */

import { defineBrowserProvider } from '@computesdk/provider';

import type { CreateBrowserSessionOptions } from '@computesdk/provider';

/**
 * Shape of a Tilion session as returned by the REST API.
 */
interface TilionSession {
  session_id: string;
  connect_url?: string;
  state?: string;
  region?: string | null;
}

/**
 * Tilion-specific configuration options.
 */
export interface TilionConfig {
  /** Tilion API key — falls back to TILION_API_KEY env var. Get one at https://tilion.dev */
  apiKey?: string;
  /** Control-plane base URL — falls back to TILION_BASE_URL, then the public endpoint. */
  baseUrl?: string;
}

function resolveConfig(config: TilionConfig) {
  const apiKey =
    config.apiKey || (typeof process !== 'undefined' && process.env?.TILION_API_KEY) || '';
  if (!apiKey) {
    throw new Error(
      `Missing Tilion API key. Provide 'apiKey' in config or set TILION_API_KEY environment variable. ` +
        `Get your API key from https://tilion.dev`,
    );
  }
  const baseUrl = (
    config.baseUrl ||
    (typeof process !== 'undefined' && process.env?.TILION_BASE_URL) ||
    'https://api.tilion.dev'
  ).replace(/\/+$/, '');
  return { apiKey, baseUrl };
}

function headers(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

/** The API may hand back ws://; the public endpoint terminates TLS, so upgrade to wss://. */
function fixScheme(baseUrl: string, url: string): string {
  return baseUrl.startsWith('https') && url.startsWith('ws://') ? 'wss://' + url.slice(5) : url;
}

/** Encode a session id before interpolating it into a request path so it can't alter the route. */
function enc(sessionId: string): string {
  return encodeURIComponent(sessionId);
}

/**
 * Shape a session that is guaranteed to carry a connect url (create / getById). Throws if the API
 * omitted it, rather than handing back a present-but-empty connectUrl that would fail a CDP connect.
 */
function toSession(baseUrl: string, s: TilionSession) {
  if (!s.session_id || !s.connect_url) {
    throw new Error('tilion: response missing session_id or connect_url');
  }
  return { session: s, sessionId: s.session_id, connectUrl: fixScheme(baseUrl, s.connect_url) };
}

/**
 * Shape a session where the connect url may legitimately be absent (e.g. list entries). Leaves
 * connectUrl undefined — not "" — so callers don't attempt a CDP connect with an empty url.
 */
function toListEntry(baseUrl: string, s: TilionSession) {
  const connectUrl = s.connect_url ? fixScheme(baseUrl, s.connect_url) : undefined;
  return { session: s, sessionId: s.session_id, connectUrl };
}

/**
 * Mint a fresh CDP connect url for a session. Tilion connect tokens are single-use and issued on
 * demand, so the create response and this endpoint carry a `connect_url` while plain session reads
 * (getById / list) return `connect_url: null`.
 */
async function mintConnectUrl(baseUrl: string, apiKey: string, sessionId: string): Promise<string> {
  const r = await fetch(`${baseUrl}/v1/session/${enc(sessionId)}/connect`, {
    headers: headers(apiKey),
  });
  if (!r.ok) throw new Error(`tilion connect ${r.status}: ${await r.text()}`);
  const { connect_url } = (await r.json()) as { connect_url: string };
  return fixScheme(baseUrl, connect_url);
}

/**
 * Create a Tilion browser provider instance.
 *
 * @example
 * ```ts
 * import { tilion } from '@computesdk/tilion';
 * import { chromium } from 'playwright-core';
 *
 * const t = tilion({ apiKey: 'ph_live_...' });
 * const s = await t.session.create();
 * const browser = await chromium.connectOverCDP(s.connectUrl);
 * const page = browser.contexts()[0].pages()[0];
 * await page.goto('https://example.com');
 * ```
 */
export const tilion = defineBrowserProvider<TilionSession, TilionConfig>({
  name: 'tilion',
  methods: {
    session: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      create: async (config: TilionConfig, _options?: CreateBrowserSessionOptions) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        // Tilion runs non-stealth with direct egress by default; residential egress is an opt-in
        // premium path not exercised by the benchmark. `stealth`/`proxies` from options are not
        // mapped here so every provider is compared on the same session shape.
        const r = await fetch(`${baseUrl}/v1/session`, {
          method: 'POST',
          headers: headers(apiKey),
          body: JSON.stringify({ residential: false }),
        });
        if (!r.ok) throw new Error(`tilion create ${r.status}: ${await r.text()}`);
        return toSession(baseUrl, (await r.json()) as TilionSession);
      },

      getById: async (config: TilionConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        const r = await fetch(`${baseUrl}/v1/session/${enc(sessionId)}`, {
          headers: headers(apiKey),
        });
        // 404 means no such session — a null return, not an error.
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`tilion getById ${r.status}: ${await r.text()}`);
        const s = (await r.json()) as TilionSession;
        // Session reads don't re-issue a connect url; mint a fresh one so callers get a usable
        // connectUrl (the BrowserSession contract requires it) rather than an empty string.
        const connectUrl = s.connect_url
          ? fixScheme(baseUrl, s.connect_url)
          : await mintConnectUrl(baseUrl, apiKey, s.session_id);
        return { session: s, sessionId: s.session_id, connectUrl };
      },

      list: async (config: TilionConfig) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        const r = await fetch(`${baseUrl}/v1/sessions`, { headers: headers(apiKey) });
        // Surface failures (e.g. auth) rather than masking them as an empty list.
        if (!r.ok) throw new Error(`tilion list ${r.status}: ${await r.text()}`);
        const rows = (await r.json()) as TilionSession[];
        return rows.map((s) => toListEntry(baseUrl, s));
      },

      destroy: async (config: TilionConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        const r = await fetch(`${baseUrl}/v1/session/${enc(sessionId)}`, {
          method: 'DELETE',
          headers: headers(apiKey),
        });
        // Deleting an already-gone session (404) is a no-op; surface any other failure so
        // callers can detect e.g. invalid credentials or leaked sessions.
        if (!r.ok && r.status !== 404) {
          throw new Error(`tilion destroy ${r.status}: ${await r.text()}`);
        }
      },

      getConnectUrl: async (config: TilionConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        return mintConnectUrl(baseUrl, apiKey, sessionId);
      },
    },
  },
});
