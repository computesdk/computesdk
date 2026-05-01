/**
 * Notte Browser Provider - Factory-based Implementation
 *
 * Cloud browser sessions with proxies and profiles via the Notte platform
 * (https://notte.cc).
 */

import {
  createClient as buildNotteClient,
  sessionStart,
  sessionStatus,
  sessionStop,
  listSessions,
  profileCreate,
  profileGet,
  profileList,
  profileDelete,
} from 'notte-sdk';
import type {
  ApiSessionStartRequest,
  SessionResponse,
  ProfileResponse,
} from 'notte-sdk';

import { defineBrowserProvider } from '@computesdk/provider';

import type {
  CreateBrowserSessionOptions,
  BrowserProfile,
  BrowserSession,
} from '@computesdk/provider';

/**
 * Notte-specific configuration options
 */
export interface NotteConfig {
  /** Notte API key — falls back to NOTTE_API_KEY env var */
  apiKey?: string;
  /** Override the default API base URL (default: https://api.notte.cc) */
  baseUrl?: string;
}

/**
 * Resolve config values from explicit config or environment variables
 */
function resolveConfig(config: NotteConfig) {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.NOTTE_API_KEY) || '';

  if (!apiKey) {
    throw new Error(
      `Missing Notte API key. Provide 'apiKey' in config or set NOTTE_API_KEY environment variable. ` +
      `Get your API key from https://console.notte.cc`
    );
  }

  const baseUrl = config.baseUrl
    || (typeof process !== 'undefined' && process.env?.NOTTE_API_URL)
    || 'https://api.notte.cc';

  return { apiKey, baseUrl };
}

/**
 * Create a Notte SDK client from config. Each provider call constructs a fresh
 * client so per-config overrides (apiKey, baseUrl) compose cleanly.
 */
function createClient(config: NotteConfig) {
  const { apiKey, baseUrl } = resolveConfig(config);
  return buildNotteClient({ baseUrl, token: apiKey });
}

/**
 * Map Notte session status onto our standard set.
 */
function mapStatus(status: SessionResponse['status'] | undefined): BrowserSession['status'] {
  switch (status) {
    case 'active': return 'running';
    case 'closed': return 'completed';
    case 'error': return 'failed';
    case 'timed_out': return 'timed_out';
    default: return 'created';
  }
}

/**
 * Map ComputeSDK session options to Notte's ApiSessionStartRequest body.
 *
 * Mapped: `viewport`, `timeout` (sec → max_duration_minutes), `proxies` (boolean only),
 * `profileId`. Unmapped (no Notte equivalent yet): `stealth`, `keepAlive`, `recording`,
 * `logging`, `userMetadata`, `extensionIds`, `region`.
 */
function mapSessionOptions(options?: CreateBrowserSessionOptions): ApiSessionStartRequest {
  const body: ApiSessionStartRequest = {};

  if (!options) return body;

  // Viewport — Notte takes width/height as separate fields
  if (options.viewport) {
    body.viewport_width = options.viewport.width;
    body.viewport_height = options.viewport.height;
  }

  // Timeout — ComputeSDK uses seconds, Notte uses minutes (round up to >=1)
  if (options.timeout !== undefined) {
    body.max_duration_minutes = Math.max(1, Math.ceil(options.timeout / 60));
  }

  // Proxies — ComputeSDK's `ProxyConfig[]` shape doesn't 1:1 map onto Notte's
  // `(NotteProxy | ExternalProxy)[]`. For first-pass support we forward only the
  // `boolean` form (Notte's "default proxies"); per-proxy custom config can land
  // in a follow-up via Notte-specific config keys (`web_bot_auth`, etc.).
  if (typeof options.proxies === 'boolean') {
    body.proxies = options.proxies;
  } else if (Array.isArray(options.proxies)) {
    throw new Error(
      `@computesdk/notte: ProxyConfig[] proxies are not yet supported — pass proxies: true ` +
      `to use Notte's default proxies, or omit to disable.`
    );
  }

  // Profile — map profileId to Notte's session profile config.
  //
  // Policy choice: persist=true (write profile state back on session close).
  // ComputeSDK's option doesn't carry persist intent, so we pick the "make
  // your changes stick" default that matches how Hyperbrowser/Browseruse map
  // profileId. Pass profileId via session.create() and the profile updates;
  // create the profile via provider.profile.create() if it doesn't exist yet.
  if (options.profileId) {
    body.profile = { id: options.profileId, persist: true };
  }

  return body;
}

/**
 * Normalize a Notte session response into ComputeSDK's standard shape.
 *
 * `connectUrl` is intentionally surfaced here — Notte's CDP URL embeds a
 * short-lived JWT (not the API key), so it does not require the same
 * "treat as secret" handling as anchorbrowser/steel.
 */
function normalizeSession(response: SessionResponse) {
  if (!response.cdp_url) {
    throw new Error(`Notte session ${response.session_id} has no cdp_url; the session may not be ready.`);
  }
  return {
    session: response,
    sessionId: response.session_id,
    connectUrl: response.cdp_url,
    status: mapStatus(response.status),
  };
}

/**
 * Normalize a Notte profile response into ComputeSDK's standard shape.
 */
function normalizeProfile(response: ProfileResponse): BrowserProfile {
  return {
    profileId: response.profile_id,
    name: response.name ?? undefined,
    createdAt: response.created_at ? new Date(response.created_at) : undefined,
  };
}

/**
 * Create a Notte browser provider instance
 *
 * @example
 * ```ts
 * import { notte } from '@computesdk/notte';
 * import { chromium } from 'playwright-core';
 *
 * const n = notte({ apiKey: 'sk-notte-...' });
 *
 * // Create a browser session
 * const session = await n.session.create();
 * console.log(session.connectUrl);
 *
 * // Connect with Playwright
 * const browser = await chromium.connectOverCDP(session.connectUrl);
 * const page = browser.contexts()[0].pages()[0];
 * await page.goto('https://example.com');
 *
 * // Release the session
 * await n.session.destroy(session.sessionId);
 * ```
 */
export const notte = defineBrowserProvider<SessionResponse, NotteConfig>({
  name: 'notte',
  methods: {
    // ─── Session Lifecycle ─────────────────────────────────────────────
    session: {
      create: async (config, options) => {
        const client = createClient(config);
        const { data } = await sessionStart({ client, body: mapSessionOptions(options), throwOnError: true });
        return normalizeSession(data);
      },

      getById: async (config, sessionId) => {
        const client = createClient(config);
        try {
          const { data } = await sessionStatus({ client, path: { session_id: sessionId }, throwOnError: true });
          return normalizeSession(data);
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        // Notte's list endpoint omits `cdp_url` on summary items; surface
        // `connectUrl: undefined` (allowed by BrowserSession on list returns)
        // and let callers reach for `getConnectUrl(sessionId)` on demand.
        const sessions: {
          session: SessionResponse;
          sessionId: string;
          connectUrl: string | undefined;
          status: BrowserSession['status'];
        }[] = [];
        let page = 1;
        while (true) {
          const { data } = await listSessions({ client, query: { page }, throwOnError: true });
          const items = data.items ?? [];
          for (const item of items) {
            sessions.push({
              session: item,
              sessionId: item.session_id,
              connectUrl: item.cdp_url ?? undefined,
              status: mapStatus(item.status),
            });
          }
          if (items.length === 0 || !data.has_next) break;
          page += 1;
        }
        return sessions;
      },

      destroy: async (config, sessionId) => {
        const client = createClient(config);
        await sessionStop({ client, path: { session_id: sessionId }, throwOnError: true });
      },

      getConnectUrl: async (config, sessionId) => {
        const client = createClient(config);
        const { data } = await sessionStatus({ client, path: { session_id: sessionId }, throwOnError: true });
        if (!data.cdp_url) {
          throw new Error(`Notte session ${sessionId} has no cdp_url; status=${data.status}`);
        }
        return data.cdp_url;
      },
    },

    // ─── Profiles ─────────────────────────────────────────────────────
    profile: {
      create: async (config, options) => {
        const client = createClient(config);
        const body = options?.name ? { name: options.name } : {};
        const { data } = await profileCreate({ client, body, throwOnError: true });
        return {
          ...normalizeProfile(data),
          metadata: options?.metadata as Record<string, unknown> | undefined,
        };
      },

      get: async (config, profileId) => {
        const client = createClient(config);
        try {
          const { data } = await profileGet({ client, path: { profile_id: profileId }, throwOnError: true });
          return normalizeProfile(data);
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const profiles: BrowserProfile[] = [];
        let page = 1;
        while (true) {
          const { data } = await profileList({ client, query: { page }, throwOnError: true });
          const items = data.items ?? [];
          for (const item of items) {
            profiles.push(normalizeProfile(item));
          }
          if (items.length === 0 || !data.has_next) break;
          page += 1;
        }
        return profiles;
      },

      delete: async (config, profileId) => {
        const client = createClient(config);
        await profileDelete({ client, path: { profile_id: profileId }, throwOnError: true });
      },
    },
  },
});
