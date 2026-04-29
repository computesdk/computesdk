/**
 * Anchor Browser Provider - Factory-based Implementation
 *
 * Cloud browser sessions with stealth mode, proxies, captcha solving,
 * profiles, extensions, and session recordings via the Anchor Browser platform.
 */

import Anchorbrowser from 'anchorbrowser';
import type {
  SessionCreateParams,
  SessionCreateResponse,
} from 'anchorbrowser/resources/sessions/sessions';
import { defineBrowserProvider } from '@computesdk/provider';

import type {
  BrowserSession,
  CreateBrowserSessionOptions,
  BrowserProfile,
  BrowserExtension,
  BrowserRecording,
  ProxyConfig,
} from '@computesdk/provider';

const DEFAULT_BASE_URL = 'https://api.anchorbrowser.io';

/**
 * Anchor Browser-specific configuration options
 */
export interface AnchorBrowserConfig {
  /** Anchor Browser API key — falls back to ANCHORBROWSER_API_KEY env var */
  apiKey?: string;
  /** Override the default API base URL */
  baseURL?: string;
  /** Optional request timeout (ms) */
  timeout?: number;
}

/**
 * The native Anchor session object returned by their SDK.
 * The retrieve endpoint returns a richer shape than create — we keep both
 * fields available on the union so consumers can read whichever they need.
 */
export type AnchorBrowserSession = NonNullable<SessionCreateResponse['data']>;

/**
 * Resolve config values from explicit config or environment variables
 */
function resolveConfig(config: AnchorBrowserConfig) {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.ANCHORBROWSER_API_KEY) || '';
  const baseURL = config.baseURL || (typeof process !== 'undefined' && process.env?.ANCHORBROWSER_BASE_URL) || DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new Error(
      `Missing Anchor Browser API key. Provide 'apiKey' in config or set ANCHORBROWSER_API_KEY environment variable. ` +
      `Get your API key from https://app.anchorbrowser.io`
    );
  }

  return { apiKey, baseURL, timeout: config.timeout };
}

/**
 * Create an Anchor Browser SDK client from config
 */
function createClient(config: AnchorBrowserConfig): Anchorbrowser {
  const { apiKey, baseURL, timeout } = resolveConfig(config);
  return new Anchorbrowser({ apiKey, baseURL, timeout });
}

/**
 * Build a CDP websocket URL from base URL, sessionId, and apiKey.
 *
 * Mirrors the `getCdpUrl` helper in the upstream SDK (lib/browser):
 *   https://api.anchorbrowser.io  →  wss://connect.anchorbrowser.io
 *   ?apiKey={apiKey}&sessionId={sessionId}
 */
function buildCdpUrl(baseURL: string, sessionId: string, apiKey: string): string {
  const wsBase = baseURL
    .replace('https://', 'wss://')
    .replace('http://', 'ws://')
    .replace('api.', 'connect.');
  return `${wsBase}?apiKey=${apiKey}&sessionId=${sessionId}`;
}

/**
 * Apply a single ProxyConfig entry onto Anchor's session.proxy params.
 * Anchor only accepts one proxy per session — when multiple are passed
 * we honor the first one.
 */
function buildProxyParams(proxy: ProxyConfig): NonNullable<NonNullable<SessionCreateParams['session']>['proxy']> {
  if (proxy.type === 'custom' && proxy.server) {
    return {
      active: true,
      type: 'custom',
      server: proxy.server,
      username: proxy.username ?? '',
      password: proxy.password ?? '',
    };
  }
  const anchorProxy: Record<string, unknown> = {
    active: true,
    type: 'anchor_proxy',
  };
  if (proxy.geolocation?.country) {
    anchorProxy.country_code = proxy.geolocation.country.toLowerCase();
  }
  if (proxy.geolocation?.state) {
    anchorProxy.region = proxy.geolocation.state;
  }
  if (proxy.geolocation?.city) {
    anchorProxy.city = proxy.geolocation.city;
  }
  return anchorProxy as unknown as NonNullable<NonNullable<SessionCreateParams['session']>['proxy']>;
}

/**
 * Map ComputeSDK session options to Anchor Browser create-session params
 */
function mapSessionOptions(options?: CreateBrowserSessionOptions): SessionCreateParams {
  if (!options) return {};

  const params: SessionCreateParams = {};
  const session: NonNullable<SessionCreateParams['session']> = {};
  const browser: NonNullable<SessionCreateParams['browser']> = {};

  if (options.viewport) {
    browser.viewport = { width: options.viewport.width, height: options.viewport.height };
  }
  if (options.stealth !== undefined) {
    browser.extra_stealth = { active: options.stealth };
  }
  if (options.extensionIds && options.extensionIds.length > 0) {
    browser.extensions = options.extensionIds;
  }
  if (options.profileId) {
    browser.profile = { name: options.profileId, persist: true };
  }
  if (options.recording !== undefined) {
    session.recording = { active: options.recording };
  }
  // Anchor only accepts a session timeout (max_duration) in minutes.
  if (options.timeout !== undefined) {
    session.timeout = { max_duration: Math.max(1, Math.ceil(options.timeout / 60)) };
  }
  if (options.userMetadata) {
    session.tags = Object.entries(options.userMetadata).map(([k, v]) => `${k}:${v}`);
  }

  if (options.proxies === true) {
    session.proxy = { active: true, type: 'anchor_proxy' };
  } else if (Array.isArray(options.proxies) && options.proxies.length > 0) {
    session.proxy = buildProxyParams(options.proxies[0]!);
  }

  if (Object.keys(browser).length > 0) params.browser = browser;
  if (Object.keys(session).length > 0) params.session = session;

  return params;
}

/**
 * Map Anchor session status onto our standard set
 */
function mapStatus(status: string | undefined): BrowserSession['status'] {
  switch (status) {
    case 'active':
    case 'running': return 'running';
    case 'completed':
    case 'closed': return 'completed';
    case 'failed':
    case 'error': return 'failed';
    case 'timed_out':
    case 'timeout': return 'timed_out';
    default: return 'created';
  }
}

/**
 * Create an Anchor Browser provider instance
 *
 * @example
 * ```ts
 * import { anchorbrowser } from '@computesdk/anchorbrowser';
 * import { chromium } from 'playwright-core';
 *
 * const ab = anchorbrowser({ apiKey: process.env.ANCHORBROWSER_API_KEY });
 *
 * // Create a stealth browser session
 * const session = await ab.session.create({ stealth: true, proxies: true });
 * console.log(session.connectUrl); // CDP websocket URL
 *
 * // Connect with Playwright
 * const browser = await chromium.connectOverCDP(session.connectUrl);
 * const page = browser.contexts()[0].pages()[0];
 * await page.goto('https://example.com');
 *
 * // Stop the session
 * await session.destroy();
 * ```
 */
export const anchorbrowser = defineBrowserProvider<AnchorBrowserSession, AnchorBrowserConfig>({
  name: 'anchorbrowser',
  methods: {
    // ─── Session Lifecycle ─────────────────────────────────────────────
    session: {
      create: async (config, options) => {
        const client = createClient(config);
        const { apiKey, baseURL } = resolveConfig(config);
        const response = await client.sessions.create(mapSessionOptions(options));
        const data = response.data;
        if (!data?.id) {
          throw new Error('Anchor Browser session creation returned no session id');
        }
        return {
          session: data,
          sessionId: data.id,
          connectUrl: data.cdp_url ?? buildCdpUrl(baseURL, data.id, apiKey),
          status: 'running',
        };
      },

      getById: async (config, sessionId) => {
        const client = createClient(config);
        const { apiKey, baseURL } = resolveConfig(config);
        try {
          const response = await client.sessions.retrieve(sessionId);
          const data = response.data;
          if (!data?.session_id) return null;
          return {
            // Normalize onto the create-shape so callers can rely on `id`.
            session: { ...data, id: data.session_id } as AnchorBrowserSession,
            sessionId: data.session_id,
            connectUrl: buildCdpUrl(baseURL, data.session_id, apiKey),
            status: mapStatus(data.status),
          };
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const response = await client.sessions.all.status();
        const items = response.data?.items ?? [];
        // Anchor's list endpoint returns lean items without a CDP URL.
        // Callers that need a connectable URL should use provider.getConnectUrl(sessionId).
        return items.map((item) => ({
          session: { id: item.session_id } as AnchorBrowserSession,
          sessionId: item.session_id,
          status: mapStatus(item.status),
        }));
      },

      destroy: async (config, sessionId) => {
        const client = createClient(config);
        await client.sessions.delete(sessionId);
      },

      getConnectUrl: async (config, sessionId) => {
        const { apiKey, baseURL } = resolveConfig(config);
        return buildCdpUrl(baseURL, sessionId, apiKey);
      },
    },

    // ─── Profiles (Persistent Browser Contexts) ────────────────────────
    //
    // Anchor identifies profiles by `name`, not an opaque ID — `profileId`
    // in our abstraction maps directly onto Anchor's profile name.
    //
    // Anchor profiles are created *from* a running session. Pass the source
    // session id via `metadata.sessionId` on the create options.
    profile: {
      create: async (config, options) => {
        const client = createClient(config);
        const name = options?.name;
        if (!name) {
          throw new Error(
            `Anchor Browser requires a profile name. Pass 'name' on the create options.`
          );
        }
        const sessionId = options?.metadata?.sessionId as string | undefined;
        if (!sessionId) {
          throw new Error(
            `Anchor Browser profiles are derived from an existing session. ` +
            `Pass the source session id via 'metadata.sessionId' on the create options.`
          );
        }
        await client.profiles.create({
          name,
          source: 'session',
          session_id: sessionId,
          description: options?.metadata?.description as string | undefined,
        });
        return {
          profileId: name,
          name,
          metadata: options?.metadata as Record<string, unknown> | undefined,
        } satisfies BrowserProfile;
      },

      get: async (config, profileId) => {
        const client = createClient(config);
        try {
          const response = await client.profiles.retrieve(profileId);
          const data = response.data;
          if (!data?.name) return null;
          return {
            profileId: data.name,
            name: data.name,
            createdAt: data.created_at ? new Date(data.created_at) : undefined,
            metadata: data.description ? { description: data.description } : undefined,
          } satisfies BrowserProfile;
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const response = await client.profiles.list();
        const items = response.data?.items ?? [];
        return items
          .filter((p): p is typeof p & { name: string } => Boolean(p.name))
          .map((p) => ({
            profileId: p.name,
            name: p.name,
            createdAt: p.created_at ? new Date(p.created_at) : undefined,
            metadata: p.description ? { description: p.description } : undefined,
          } satisfies BrowserProfile));
      },

      delete: async (config, profileId) => {
        const client = createClient(config);
        await client.profiles.delete(profileId);
      },
    },

    // ─── Extensions ────────────────────────────────────────────────────
    //
    // Anchor exposes a list-only extensions API in the SDK (uploads happen
    // via the dashboard). We surface get/list-style access; create/delete
    // throw with a pointer to the dashboard.
    extension: {
      create: async () => {
        throw new Error(
          `Anchor Browser does not expose an extension upload endpoint via the SDK. ` +
          `Upload extensions from the Anchor Browser dashboard, then reference them ` +
          `by extension id via 'extensionIds' on session create.`
        );
      },

      get: async (config, extensionId) => {
        const client = createClient(config);
        const response = await client.extensions.list();
        const found = (response.data ?? []).find((e) => e.id === extensionId);
        if (!found?.id) return null;
        return {
          extensionId: found.id,
          name: found.name ?? found.manifest?.name,
        } satisfies BrowserExtension;
      },

      delete: async () => {
        throw new Error(
          `Anchor Browser does not expose an extension delete endpoint via the SDK. ` +
          `Manage extensions from the Anchor Browser dashboard instead.`
        );
      },
    },

    // ─── Recordings ────────────────────────────────────────────────────
    recording: {
      get: async (config, sessionId) => {
        const client = createClient(config);
        try {
          const response = await client.sessions.recordings.list(sessionId);
          const items = response.data?.items ?? [];
          if (items.length === 0) return null;
          // Prefer the primary recording; fall back to the first item.
          const recording = items.find((r) => r.is_primary) ?? items[0]!;
          return {
            recordingId: recording.id ?? sessionId,
            sessionId,
            format: 'mp4',
            url: recording.file_link,
          } satisfies BrowserRecording;
        } catch {
          return null;
        }
      },
    },
  },
});
