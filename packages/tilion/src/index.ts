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
    'https://tilion-control.fly.dev'
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

function normalize(baseUrl: string, s: TilionSession) {
  const connectUrl = fixScheme(baseUrl, s.connect_url || '');
  return { session: s, sessionId: s.session_id, connectUrl };
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
        const s = (await r.json()) as TilionSession;
        if (!s.session_id || !s.connect_url) {
          throw new Error('tilion: response missing session_id or connect_url');
        }
        return normalize(baseUrl, s);
      },

      getById: async (config: TilionConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        const r = await fetch(`${baseUrl}/v1/session/${sessionId}`, { headers: headers(apiKey) });
        if (!r.ok) return null;
        return normalize(baseUrl, (await r.json()) as TilionSession);
      },

      list: async (config: TilionConfig) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        const r = await fetch(`${baseUrl}/v1/sessions`, { headers: headers(apiKey) });
        if (!r.ok) return [];
        const rows = (await r.json()) as TilionSession[];
        return rows.map((s) => normalize(baseUrl, s));
      },

      destroy: async (config: TilionConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        await fetch(`${baseUrl}/v1/session/${sessionId}`, {
          method: 'DELETE',
          headers: headers(apiKey),
        }).catch(() => {});
      },

      getConnectUrl: async (config: TilionConfig, sessionId: string) => {
        const { apiKey, baseUrl } = resolveConfig(config);
        const r = await fetch(`${baseUrl}/v1/session/${sessionId}/connect`, {
          headers: headers(apiKey),
        });
        if (!r.ok) throw new Error(`tilion connect ${r.status}: ${await r.text()}`);
        const { connect_url } = (await r.json()) as { connect_url: string };
        return fixScheme(baseUrl, connect_url);
      },
    },
  },
});
