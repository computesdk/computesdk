/**
 * Browser Use Cloud Browser Provider - Factory-based Implementation
 *
 * Cloud browser sessions with stealth mode, residential proxies, persistent
 * profiles, and session recordings via the Browser Use Cloud platform.
 */

import { BrowserUse, type BrowserSessionItemView, type BrowserSessionView, type CreateBrowserSessionRequest, type ProfileView, type ProxyCountryCode } from 'browser-use-sdk/v3';
import { defineBrowserProvider } from '@computesdk/provider';

import type {
  BrowserSession,
  CreateBrowserSessionOptions,
  BrowserProfile,
  BrowserRecording,
  ProxyConfig,
} from '@computesdk/provider';

/**
 * Browser Use Cloud-specific configuration options
 */
export interface BrowserUseConfig {
  /** Browser Use API key — falls back to BROWSER_USE_API_KEY env var */
  apiKey?: string;
  /** Optional API base URL override */
  baseUrl?: string;
  /** Optional request timeout (ms) */
  timeout?: number;
  /** Optional max retries */
  maxRetries?: number;
}

/**
 * The native Browser Use cloud session object returned by their SDK.
 * The list endpoint returns the same shape (BrowserSessionItemView ⊆ BrowserSessionView).
 */
type BrowserUseSession = BrowserSessionView | BrowserSessionItemView;

/**
 * Resolve config values from explicit config or environment variables
 */
function resolveConfig(config: BrowserUseConfig) {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.BROWSER_USE_API_KEY) || '';

  if (!apiKey) {
    throw new Error(
      `Missing Browser Use API key. Provide 'apiKey' in config or set BROWSER_USE_API_KEY environment variable. ` +
      `Get your API key from https://cloud.browser-use.com/settings?tab=api-keys`
    );
  }

  return { apiKey, baseUrl: config.baseUrl, timeout: config.timeout, maxRetries: config.maxRetries };
}

/**
 * Create a Browser Use SDK client from config
 */
function createClient(config: BrowserUseConfig): BrowserUse {
  const { apiKey, baseUrl, timeout, maxRetries } = resolveConfig(config);
  return new BrowserUse({ apiKey, baseUrl, timeout, maxRetries });
}

/**
 * Apply a single ProxyConfig entry to the create-browser request.
 * Browser Use supports residential proxies via country code, or custom HTTP/SOCKS5
 * proxies via host/port. When given a custom proxy, we honor that; otherwise we
 * fall back to the residential proxy + country code.
 */
function applyProxy(params: Partial<CreateBrowserSessionRequest>, proxy: ProxyConfig) {
  if (proxy.type === 'custom' && proxy.server) {
    const { host, port } = parseProxyServer(proxy.server);
    if (host && port) {
      params.customProxy = {
        host,
        port,
        username: proxy.username ?? null,
        password: proxy.password ?? null,
      };
      return;
    }
  }
  if (proxy.geolocation?.country) {
    params.proxyCountryCode = proxy.geolocation.country.toLowerCase() as ProxyCountryCode;
  }
}

/**
 * Parse a proxy URL or `host:port` string into its host and port parts.
 */
function parseProxyServer(server: string): { host?: string; port?: number } {
  try {
    const url = new URL(server.includes('://') ? server : `http://${server}`);
    const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
    return { host: url.hostname, port };
  } catch {
    const [host, portStr] = server.split(':');
    const port = portStr ? Number(portStr) : undefined;
    return { host, port };
  }
}

/**
 * Map ComputeSDK session options to Browser Use create-browser params
 */
function mapSessionOptions(options?: CreateBrowserSessionOptions): Partial<CreateBrowserSessionRequest> {
  if (!options) return {};

  const params: Partial<CreateBrowserSessionRequest> = {};

  if (options.viewport) {
    params.browserScreenWidth = options.viewport.width;
    params.browserScreenHeight = options.viewport.height;
  }
  if (options.recording !== undefined) params.enableRecording = options.recording;
  if (options.profileId) params.profileId = options.profileId;
  // Browser Use accepts session timeout in minutes (default 60, max 240)
  if (options.timeout !== undefined) params.timeout = Math.max(1, Math.ceil(options.timeout / 60));

  // Stealth is enabled by default on Browser Use and not configurable per request.
  // We accept the option for parity with other providers but it is a no-op.

  if (options.proxies === false) {
    // Explicit opt-out: disable proxy.
    params.proxyCountryCode = null;
  } else if (Array.isArray(options.proxies) && options.proxies.length > 0) {
    applyProxy(params, options.proxies[0]!);
  }

  return params;
}

/**
 * Map Browser Use session status to our standard set
 */
function mapStatus(status: BrowserUseSession['status']): BrowserSession['status'] {
  switch (status) {
    case 'active': return 'running';
    case 'stopped': return 'completed';
    default: return 'created';
  }
}

/**
 * Create a Browser Use Cloud browser provider instance
 *
 * @example
 * ```ts
 * import { browseruse } from '@computesdk/browseruse';
 * import { chromium } from 'playwright-core';
 *
 * const bu = browseruse({ apiKey: process.env.BROWSER_USE_API_KEY });
 *
 * // Create a stealth browser session (stealth is enabled by default)
 * const session = await bu.session.create({
 *   proxies: [{ type: 'residential', geolocation: { country: 'us' } }],
 * });
 *
 * // Connect with Playwright via CDP
 * const browser = await chromium.connectOverCDP(session.connectUrl);
 * const page = browser.contexts()[0].pages()[0];
 * await page.goto('https://example.com');
 *
 * await session.destroy();
 * ```
 */
export const browseruse = defineBrowserProvider<BrowserUseSession, BrowserUseConfig>({
  name: 'browseruse',
  methods: {
    // ─── Session Lifecycle ─────────────────────────────────────────────
    session: {
      create: async (config, options) => {
        const client = createClient(config);
        const session = await client.browsers.create(mapSessionOptions(options));
        if (!session.cdpUrl) {
          throw new Error(
            `Browser Use returned session ${session.id} without a cdpUrl. ` +
            `The session may not be ready yet — try fetching it again with provider.session.getById('${session.id}').`
          );
        }
        return {
          session,
          sessionId: session.id,
          connectUrl: session.cdpUrl,
          status: mapStatus(session.status),
        };
      },

      getById: async (config, sessionId) => {
        const client = createClient(config);
        try {
          const session = await client.browsers.get(sessionId);
          if (!session.cdpUrl) return null;
          return {
            session,
            sessionId: session.id,
            connectUrl: session.cdpUrl,
            status: mapStatus(session.status),
          };
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const response = await client.browsers.list();
        return response.items.map((s) => ({
          session: s,
          sessionId: s.id,
          connectUrl: s.cdpUrl ?? undefined,
          status: mapStatus(s.status),
        }));
      },

      destroy: async (config, sessionId) => {
        const client = createClient(config);
        await client.browsers.stop(sessionId);
      },

      getConnectUrl: async (config, sessionId) => {
        const client = createClient(config);
        const session = await client.browsers.get(sessionId);
        if (!session.cdpUrl) {
          throw new Error(
            `Browser Use session ${sessionId} has no cdpUrl ` +
            `(status: ${session.status}). The session may already be stopped.`
          );
        }
        return session.cdpUrl;
      },
    },

    // ─── Profiles (Persistent Browser Contexts) ────────────────────────
    profile: {
      create: async (config, options) => {
        const client = createClient(config);
        const result = await client.profiles.create({
          name: options?.name,
          // userId can be passed via metadata.userId
          userId: typeof options?.metadata?.userId === 'string' ? options.metadata.userId : undefined,
        });
        const mapped = mapProfile(result);
        if (options?.metadata) {
          mapped.metadata = { ...options.metadata, ...mapped.metadata };
        }
        return mapped;
      },

      get: async (config, profileId) => {
        const client = createClient(config);
        try {
          const result = await client.profiles.get(profileId);
          return mapProfile(result);
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const response = await client.profiles.list();
        return response.items.map(mapProfile);
      },

      delete: async (config, profileId) => {
        const client = createClient(config);
        await client.profiles.delete(profileId);
      },
    },

    // ─── Recordings ────────────────────────────────────────────────────
    // Browser Use exposes the recording URL on the session itself once the
    // session ends. We fetch the session and surface its presigned URL.
    recording: {
      get: async (config, sessionId) => {
        const client = createClient(config);
        try {
          const session = await client.browsers.get(sessionId);
          if (!session.recordingUrl) return null;
          return {
            recordingId: sessionId,
            sessionId,
            format: 'mp4',
            url: session.recordingUrl,
          } satisfies BrowserRecording;
        } catch {
          return null;
        }
      },
    },
  },
});

/**
 * Map a Browser Use profile to our standard shape
 */
function mapProfile(p: ProfileView): BrowserProfile {
  return {
    profileId: p.id,
    name: p.name ?? undefined,
    createdAt: p.createdAt ? new Date(p.createdAt) : undefined,
    metadata: p.userId ? { userId: p.userId } : undefined,
  };
}
