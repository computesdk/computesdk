/**
 * Steel Browser Provider - Factory-based Implementation
 *
 * Cloud browser sessions with stealth mode, proxies, persistent profiles,
 * extensions, and session recordings via the Steel platform.
 */

import Steel, { toFile } from 'steel-sdk';
import type {
  Session as SteelSession,
  SessionCreateParams,
  Sessionslist,
} from 'steel-sdk/resources/sessions';
import { defineBrowserProvider } from '@computesdk/provider';

import type {
  BrowserSession,
  CreateBrowserSessionOptions,
  BrowserExtension,
  BrowserLog,
  BrowserRecording,
  ProxyConfig,
} from '@computesdk/provider';

/**
 * Steel-specific configuration options
 */
export interface SteelConfig {
  /** Steel API key — falls back to STEEL_API_KEY env var */
  apiKey?: string;
  /** Optional API base URL override (defaults to https://api.steel.dev) */
  baseUrl?: string;
}

/**
 * The native Steel session object returned by their SDK
 */
type NativeSteelSession = SteelSession;

/**
 * Resolve config values from explicit config or environment variables
 */
function resolveConfig(config: SteelConfig) {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.STEEL_API_KEY) || '';

  if (!apiKey) {
    throw new Error(
      `Missing Steel API key. Provide 'apiKey' in config or set STEEL_API_KEY environment variable. ` +
      `Get your API key from https://app.steel.dev/settings/api-keys`
    );
  }

  return { apiKey, baseUrl: config.baseUrl };
}

/**
 * Create a Steel SDK client from config
 */
function createClient(config: SteelConfig): Steel {
  const { apiKey, baseUrl } = resolveConfig(config);
  return new Steel({ steelAPIKey: apiKey, baseURL: baseUrl ?? undefined });
}

/**
 * Steel's `useProxy` field accepts either a boolean, a geolocation object,
 * or a custom server. Apply a single ProxyConfig onto the create-session params.
 * Steel only supports one proxy per session, so when multiple are passed
 * we honor the first one.
 */
function applyProxy(params: SessionCreateParams, proxy: ProxyConfig) {
  if (proxy.type === 'custom' && proxy.server) {
    // Steel uses a separate proxyUrl field for custom proxies; this overrides
    // useProxy and disables Steel-provided proxies in favor of the user's.
    const url = new URL(proxy.server);
    if (proxy.username) url.username = proxy.username;
    if (proxy.password) url.password = proxy.password;
    params.proxyUrl = url.toString();
    return;
  }

  if (proxy.geolocation?.country || proxy.geolocation?.state || proxy.geolocation?.city) {
    params.useProxy = {
      geolocation: {
        country: proxy.geolocation.country as any,
        ...(proxy.geolocation.state ? { state: proxy.geolocation.state as any } : {}),
        ...(proxy.geolocation.city ? { city: proxy.geolocation.city as any } : {}),
      },
    };
    return;
  }

  params.useProxy = true;
}

const warnedUnsupported = new Set<string>();
function warnOnce(field: string, reason: string) {
  if (warnedUnsupported.has(field)) return;
  warnedUnsupported.add(field);
  console.warn(`[@computesdk/steel] '${field}' is ignored: ${reason}`);
}

/**
 * Map ComputeSDK session options to Steel create-session params.
 *
 * The following CreateBrowserSessionOptions fields are intentionally not
 * forwarded because Steel's API has no equivalent knob:
 * - `recording`: Steel always records sessions; fetch via the recording manager.
 * - `logging`:   Steel always captures console logs; fetch via the logs manager.
 * - `keepAlive`: Steel sessions run until `timeout` elapses or are released
 *                explicitly; there is no separate keep-alive flag. Use a long
 *                `timeout` to approximate the behavior.
 * - `userMetadata`: Steel does not support arbitrary user metadata on sessions.
 *
 * If a caller passes a non-default value for any of these, we warn once per
 * field so the silent drop is at least visible in logs.
 */
function mapSessionOptions(options?: CreateBrowserSessionOptions): SessionCreateParams {
  if (!options) return {};

  if (options.keepAlive === true) {
    warnOnce('keepAlive', 'Steel has no keep-alive flag; use a long `timeout` instead.');
  }
  if (options.recording === false) {
    warnOnce('recording', 'Steel always records sessions and cannot be disabled per session.');
  }
  if (options.logging === false) {
    warnOnce('logging', 'Steel always captures console logs and cannot be disabled per session.');
  }
  if (options.userMetadata && Object.keys(options.userMetadata).length > 0) {
    warnOnce('userMetadata', 'Steel does not support user metadata on sessions.');
  }

  const params: SessionCreateParams = {};

  if (options.viewport) params.dimensions = { width: options.viewport.width, height: options.viewport.height };
  if (options.extensionIds && options.extensionIds.length > 0) params.extensionIds = options.extensionIds;
  if (options.region) params.region = options.region as SessionCreateParams['region'];
  // Steel session timeout is in milliseconds (default 5 minutes)
  if (options.timeout !== undefined) params.timeout = options.timeout * 1000;
  if (options.profileId) {
    params.profileId = options.profileId;
    params.persistProfile = true;
  }

  // Stealth wraps a few related flags. We toggle humanizeInteractions as the
  // most user-visible knob; advanced users can override via options pass-through.
  if (options.stealth) {
    params.stealthConfig = { humanizeInteractions: true };
  }

  if (options.proxies === true) {
    params.useProxy = true;
  } else if (Array.isArray(options.proxies) && options.proxies.length > 0) {
    applyProxy(params, options.proxies[0]!);
  }

  return params;
}

/**
 * Map Steel's session status onto our standard set
 */
function mapStatus(status: string | undefined): BrowserSession['status'] {
  switch (status) {
    case 'live': return 'running';
    case 'released': return 'completed';
    case 'failed': return 'failed';
    default: return 'created';
  }
}

/**
 * Append the apiKey (and sessionId if missing) to Steel's websocketUrl so
 * callers can pass it directly to playwright/puppeteer. Steel returns
 * `wss://connect.steel.dev?sessionId=...` and requires `apiKey` to be
 * appended for authentication.
 *
 * SECURITY: the returned URL embeds the account-wide Steel API key as a
 * query parameter. Treat it as a secret — do not log it, persist it, or
 * forward it to systems that retain URLs (access logs, error trackers,
 * tracing). Anyone with this URL has full access to the Steel account, not
 * just this session.
 */
function buildConnectUrl(websocketUrl: string, apiKey: string, sessionId: string): string {
  const url = new URL(websocketUrl);
  if (!url.searchParams.has('apiKey')) url.searchParams.set('apiKey', apiKey);
  if (!url.searchParams.has('sessionId')) url.searchParams.set('sessionId', sessionId);
  return url.toString();
}

/**
 * Create a Steel browser provider instance
 *
 * SECURITY NOTE: Steel's CDP endpoint authenticates via an `apiKey` query
 * parameter on the WebSocket URL. As a result, every `connectUrl` returned
 * by this provider (from `session.create()` and `session.getById()`, and
 * `provider.getConnectUrl()`) embeds the account-wide Steel API key. Treat
 * `connectUrl` as a secret: do not log, persist, or forward it to systems
 * that retain URLs. `session.list()` deliberately omits `connectUrl` to
 * avoid amplifying this leak surface — call `provider.getConnectUrl(id)` on
 * demand instead.
 *
 * @example
 * ```ts
 * import { steel } from '@computesdk/steel';
 * import { chromium } from 'playwright-core';
 *
 * const st = steel({ apiKey: process.env.STEEL_API_KEY });
 *
 * // Create a stealth browser session
 * const session = await st.session.create({ stealth: true, proxies: true });
 *
 * // Connect with Playwright (do not log session.connectUrl — it contains the API key)
 * const browser = await chromium.connectOverCDP(session.connectUrl);
 * const page = browser.contexts()[0].pages()[0];
 * await page.goto('https://example.com');
 *
 * // Release the session
 * await session.destroy();
 * ```
 */
export const steel = defineBrowserProvider<NativeSteelSession, SteelConfig>({
  name: 'steel',
  methods: {
    // ─── Session Lifecycle ─────────────────────────────────────────────
    session: {
      create: async (config, options) => {
        const { apiKey } = resolveConfig(config);
        const client = createClient(config);
        const session = await client.sessions.create(mapSessionOptions(options));
        return {
          session,
          sessionId: session.id,
          connectUrl: buildConnectUrl(session.websocketUrl, apiKey, session.id),
          status: mapStatus(session.status),
        };
      },

      getById: async (config, sessionId) => {
        const { apiKey } = resolveConfig(config);
        const client = createClient(config);
        try {
          const session = await client.sessions.retrieve(sessionId);
          return {
            session,
            sessionId: session.id,
            connectUrl: buildConnectUrl(session.websocketUrl, apiKey, session.id),
            status: mapStatus(session.status),
          };
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const page = await client.sessions.list();
        const sessions = (page as unknown as { sessions: Sessionslist['sessions'] }).sessions ?? [];
        // We deliberately omit connectUrl from list entries: the URL would
        // need to embed the account-wide Steel API key, and emitting it once
        // per session inflates the leak surface (logs, traces, etc.). Callers
        // that need a connectable URL should use getConnectUrl(sessionId).
        return sessions.map((s) => ({
          session: s as NativeSteelSession,
          sessionId: s.id,
          status: mapStatus(s.status),
        }));
      },

      destroy: async (config, sessionId) => {
        const client = createClient(config);
        await client.sessions.release(sessionId);
      },

      getConnectUrl: async (config, sessionId) => {
        const { apiKey } = resolveConfig(config);
        const client = createClient(config);
        const session = await client.sessions.retrieve(sessionId);
        return buildConnectUrl(session.websocketUrl, apiKey, session.id);
      },
    },

    // ─── Extensions ────────────────────────────────────────────────────
    extension: {
      create: async (config, options) => {
        const client = createClient(config);
        const buf = typeof options.file === 'string'
          ? Buffer.from(options.file, 'utf-8')
          : Buffer.from(options.file);
        const file = await toFile(buf, options.name ?? 'extension.zip');
        const result = await client.extensions.upload({ file });
        return {
          extensionId: result.id,
          name: result.name,
        } satisfies BrowserExtension;
      },

      get: async (config, extensionId) => {
        const client = createClient(config);
        // Steel exposes only a list endpoint for extension lookup — filter the result.
        const response = await client.extensions.list();
        const found = response.extensions.find((e) => e.id === extensionId);
        if (!found) return null;
        return { extensionId: found.id, name: found.name } satisfies BrowserExtension;
      },

      delete: async (config, extensionId) => {
        const client = createClient(config);
        await client.extensions.delete(extensionId);
      },
    },

    // ─── Logs (RRWeb session events) ───────────────────────────────────
    // Steel doesn't expose a console-log endpoint — the closest equivalent
    // is the RRWeb event stream from `sessions.events`. We surface those as
    // log entries so callers have a uniform shape.
    logs: {
      list: async (config, sessionId) => {
        const client = createClient(config);
        const events = await client.sessions.events(sessionId);
        return (events as Array<Record<string, unknown>>).map((event) => {
          const ts = typeof event.timestamp === 'number' ? event.timestamp : Date.now();
          return {
            timestamp: new Date(ts),
            level: 'info' as BrowserLog['level'],
            message: typeof event.type === 'string' || typeof event.type === 'number'
              ? `event:${String(event.type)}`
              : 'event',
            data: event,
          } satisfies BrowserLog;
        });
      },
    },

    // ─── Recordings ────────────────────────────────────────────────────
    recording: {
      get: async (config, sessionId) => {
        const client = createClient(config);
        try {
          const events = await client.sessions.events(sessionId);
          if (!events || (Array.isArray(events) && events.length === 0)) return null;
          return {
            recordingId: sessionId,
            sessionId,
            format: 'rrweb',
            data: events,
          } satisfies BrowserRecording;
        } catch {
          return null;
        }
      },
    },
  },
});
