/**
 * Hyperbrowser Browser Provider - Factory-based Implementation
 *
 * Cloud browser sessions with stealth mode, proxies, profiles,
 * extensions, event logs, and session recordings via the Hyperbrowser platform.
 */

import { Hyperbrowser } from '@hyperbrowser/sdk';
import type {
  CreateSessionParams,
  SessionDetail,
  SessionEventLog,
} from '@hyperbrowser/sdk/types';
import { defineBrowserProvider } from '@computesdk/provider';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type {
  BrowserSession,
  CreateBrowserSessionOptions,
  BrowserProfile,
  BrowserExtension,
  BrowserLog,
  BrowserRecording,
  ProxyConfig,
} from '@computesdk/provider';

/**
 * Hyperbrowser-specific configuration options
 */
export interface HyperbrowserConfig {
  /** Hyperbrowser API key — falls back to HYPERBROWSER_API_KEY env var */
  apiKey?: string;
  /** Optional API base URL override */
  baseUrl?: string;
  /** Optional request timeout (ms) */
  timeout?: number;
}

/**
 * The native Hyperbrowser session object returned by their SDK.
 * SessionDetail includes wsEndpoint and live URLs; the list endpoint
 * returns a leaner Session shape without wsEndpoint.
 */
type HyperbrowserSession = SessionDetail;

/**
 * Resolve config values from explicit config or environment variables
 */
function resolveConfig(config: HyperbrowserConfig) {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.HYPERBROWSER_API_KEY) || '';

  if (!apiKey) {
    throw new Error(
      `Missing Hyperbrowser API key. Provide 'apiKey' in config or set HYPERBROWSER_API_KEY environment variable. ` +
      `Get your API key from https://app.hyperbrowser.ai/quickstart`
    );
  }

  return { apiKey, baseUrl: config.baseUrl, timeout: config.timeout };
}

/**
 * Create a Hyperbrowser SDK client from config
 */
function createClient(config: HyperbrowserConfig): Hyperbrowser {
  const { apiKey, baseUrl, timeout } = resolveConfig(config);
  return new Hyperbrowser({ apiKey, baseUrl, timeout });
}

/**
 * Apply a single ProxyConfig entry onto the Hyperbrowser create-session params.
 * Hyperbrowser only supports one proxy per session, so when multiple are passed
 * we honor the first one.
 */
function applyProxy(params: CreateSessionParams, proxy: ProxyConfig) {
  params.useProxy = true;
  if (proxy.type === 'custom' && proxy.server) {
    params.proxyServer = proxy.server;
    if (proxy.username) params.proxyServerUsername = proxy.username;
    if (proxy.password) params.proxyServerPassword = proxy.password;
  }
  if (proxy.geolocation?.country) params.proxyCountry = proxy.geolocation.country as CreateSessionParams['proxyCountry'];
  if (proxy.geolocation?.state) params.proxyState = proxy.geolocation.state as CreateSessionParams['proxyState'];
  if (proxy.geolocation?.city) params.proxyCity = proxy.geolocation.city;
}

/**
 * Map ComputeSDK session options to Hyperbrowser create session params
 */
function mapSessionOptions(options?: CreateBrowserSessionOptions): CreateSessionParams {
  if (!options) return {};

  const params: CreateSessionParams = {};

  if (options.stealth !== undefined) params.useStealth = options.stealth;
  if (options.viewport) params.screen = { width: options.viewport.width, height: options.viewport.height };
  if (options.recording !== undefined) params.enableWebRecording = options.recording;
  if (options.logging !== undefined) params.enableLogCapture = options.logging;
  if (options.extensionIds && options.extensionIds.length > 0) params.extensionIds = options.extensionIds;
  if (options.region) params.region = options.region as CreateSessionParams['region'];
  if (options.profileId) {
    params.profile = { id: options.profileId, persistChanges: true };
  }
  // Hyperbrowser only accepts a session timeout in minutes
  if (options.timeout !== undefined) params.timeoutMinutes = Math.max(1, Math.ceil(options.timeout / 60));

  if (options.proxies === true) {
    params.useProxy = true;
  } else if (Array.isArray(options.proxies) && options.proxies.length > 0) {
    applyProxy(params, options.proxies[0]!);
  }

  return params;
}

/**
 * Map Hyperbrowser session status onto our standard set
 */
function mapStatus(status: string | undefined): BrowserSession['status'] {
  switch (status) {
    case 'active': return 'running';
    case 'closed': return 'completed';
    case 'error': return 'failed';
    default: return 'created';
  }
}

/**
 * Map a Hyperbrowser session event log type to a log level
 */
function mapLogLevel(type: SessionEventLog['type']): BrowserLog['level'] {
  return type === 'captcha_error' ? 'error' : 'info';
}

/**
 * Hyperbrowser's extension API only accepts a file path on disk. If a buffer
 * or raw string of bytes is provided, write it to a temp file first.
 */
function materializeExtensionFile(file: Uint8Array | string, name?: string): { filePath: string; cleanup: () => void } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperbrowser-ext-'));
  const filePath = path.join(tmpDir, name ?? 'extension.zip');
  if (typeof file === 'string') {
    fs.writeFileSync(filePath, file);
  } else {
    fs.writeFileSync(filePath, Buffer.from(file));
  }
  return {
    filePath,
    cleanup: () => {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

/**
 * Create a Hyperbrowser browser provider instance
 *
 * @example
 * ```ts
 * import { hyperbrowser } from '@computesdk/hyperbrowser';
 * import { chromium } from 'playwright-core';
 *
 * const hb = hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY });
 *
 * // Create a stealth browser session
 * const session = await hb.session.create({ stealth: true, proxies: true });
 * console.log(session.connectUrl); // wsEndpoint
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
export const hyperbrowser = defineBrowserProvider<HyperbrowserSession, HyperbrowserConfig>({
  name: 'hyperbrowser',
  methods: {
    // ─── Session Lifecycle ─────────────────────────────────────────────
    session: {
      create: async (config, options) => {
        const client = createClient(config);
        const session = await client.sessions.create(mapSessionOptions(options));
        return {
          session,
          sessionId: session.id,
          connectUrl: session.wsEndpoint,
          status: mapStatus(session.status),
        };
      },

      getById: async (config, sessionId) => {
        const client = createClient(config);
        try {
          const session = await client.sessions.get(sessionId);
          return {
            session,
            sessionId: session.id,
            connectUrl: session.wsEndpoint,
            status: mapStatus(session.status),
          };
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const response = await client.sessions.list();
        // The list response returns a lean Session shape without wsEndpoint;
        // callers needing the connect URL should use getConnectUrl(sessionId).
        return response.sessions.map((s) => ({
          session: s as HyperbrowserSession,
          sessionId: s.id,
          connectUrl: '',
          status: mapStatus(s.status),
        }));
      },

      destroy: async (config, sessionId) => {
        const client = createClient(config);
        await client.sessions.stop(sessionId);
      },

      getConnectUrl: async (config, sessionId) => {
        const client = createClient(config);
        const session = await client.sessions.get(sessionId);
        return session.wsEndpoint;
      },
    },

    // ─── Profiles (Persistent Browser Contexts) ────────────────────────
    profile: {
      create: async (config, options) => {
        const client = createClient(config);
        const result = await client.profiles.create(options?.name ? { name: options.name } : {});
        return {
          profileId: result.id,
          name: result.name ?? options?.name,
          metadata: options?.metadata as Record<string, unknown> | undefined,
        } satisfies BrowserProfile;
      },

      get: async (config, profileId) => {
        const client = createClient(config);
        try {
          const result = await client.profiles.get(profileId);
          return {
            profileId: result.id,
            name: result.name ?? undefined,
            createdAt: result.createdAt ? new Date(result.createdAt) : undefined,
          } satisfies BrowserProfile;
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const response = await client.profiles.list();
        return response.profiles.map((p) => ({
          profileId: p.id,
          name: p.name ?? undefined,
          createdAt: p.createdAt ? new Date(p.createdAt) : undefined,
        } satisfies BrowserProfile));
      },

      delete: async (config, profileId) => {
        const client = createClient(config);
        await client.profiles.delete(profileId);
      },
    },

    // ─── Extensions ────────────────────────────────────────────────────
    extension: {
      create: async (config, options) => {
        const client = createClient(config);
        const { filePath, cleanup } = materializeExtensionFile(options.file, options.name);
        try {
          const result = await client.extensions.create({ filePath, name: options.name });
          return {
            extensionId: result.id,
            name: result.name,
          } satisfies BrowserExtension;
        } finally {
          cleanup();
        }
      },

      get: async (config, extensionId) => {
        const client = createClient(config);
        // Hyperbrowser exposes only a list endpoint — filter the result.
        const extensions = await client.extensions.list();
        const found = extensions.find((e) => e.id === extensionId);
        if (!found) return null;
        return { extensionId: found.id, name: found.name } satisfies BrowserExtension;
      },

      delete: async () => {
        throw new Error(
          `Hyperbrowser does not expose an extension delete endpoint. ` +
          `Manage extensions from the Hyperbrowser dashboard instead.`
        );
      },
    },

    // ─── Logs (Session Event Logs) ─────────────────────────────────────
    logs: {
      list: async (config, sessionId) => {
        const client = createClient(config);
        const response = await client.sessions.eventLogs.list(sessionId);
        return response.data.map((log) => ({
          timestamp: new Date(log.timestamp),
          level: mapLogLevel(log.type),
          message: log.type,
          data: { ...log.metadata, targetId: log.targetId, pageUrl: log.pageUrl },
        } satisfies BrowserLog));
      },
    },

    // ─── Recordings ────────────────────────────────────────────────────
    recording: {
      get: async (config, sessionId) => {
        const client = createClient(config);
        try {
          const [urlResponse, data] = await Promise.all([
            client.sessions.getRecordingURL(sessionId).catch(() => null),
            client.sessions.getRecording(sessionId).catch(() => null),
          ]);
          if (!urlResponse?.recordingUrl && !data) return null;
          return {
            recordingId: sessionId,
            sessionId,
            format: 'rrweb',
            url: urlResponse?.recordingUrl ?? undefined,
            data: data ?? undefined,
          } satisfies BrowserRecording;
        } catch {
          return null;
        }
      },
    },
  },
});
