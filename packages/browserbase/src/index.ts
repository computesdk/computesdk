/**
 * Browserbase Browser Provider - Factory-based Implementation
 *
 * Cloud browser sessions with stealth mode, proxies, session replay,
 * and persistent contexts via the Browserbase platform.
 */

import Browserbase from '@browserbasehq/sdk';
import { defineBrowserProvider } from '@computesdk/provider';

import type {
  CreateBrowserSessionOptions,
  BrowserProfile,
  BrowserExtension,
  BrowserLog,
  BrowserRecording,
} from '@computesdk/provider';

/**
 * Browserbase-specific configuration options
 */
export interface BrowserbaseConfig {
  /** Browserbase API key — falls back to BROWSERBASE_API_KEY env var */
  apiKey?: string;
  /** Browserbase project ID — falls back to BROWSERBASE_PROJECT_ID env var */
  projectId?: string;
}

/**
 * The native Browserbase session object returned by their SDK
 */
type BrowserbaseSession = Awaited<ReturnType<InstanceType<typeof Browserbase>['sessions']['create']>>;

/**
 * Resolve config values from explicit config or environment variables
 */
function resolveConfig(config: BrowserbaseConfig) {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.BROWSERBASE_API_KEY) || '';
  const projectId = config.projectId || (typeof process !== 'undefined' && process.env?.BROWSERBASE_PROJECT_ID) || '';

  if (!apiKey) {
    throw new Error(
      `Missing Browserbase API key. Provide 'apiKey' in config or set BROWSERBASE_API_KEY environment variable. ` +
      `Get your API key from https://www.browserbase.com/settings`
    );
  }

  return { apiKey, projectId };
}

/**
 * Create a Browserbase SDK client from config
 */
function createClient(config: BrowserbaseConfig): Browserbase {
  const { apiKey } = resolveConfig(config);
  return new Browserbase({ apiKey });
}

/**
 * Map ComputeSDK session options to Browserbase create session params
 */
function mapSessionOptions(config: BrowserbaseConfig, options?: CreateBrowserSessionOptions) {
  const { projectId } = resolveConfig(config);

  if (!options) {
    return projectId ? { projectId } : {};
  }

  const params: Record<string, any> = {};
  if (projectId) params.projectId = projectId;
  if (options.region) params.region = options.region;
  if (options.keepAlive !== undefined) params.keepAlive = options.keepAlive;
  if (options.timeout !== undefined) params.timeout = options.timeout;
  // Browserbase accepts a single extensionId per session
  if (options.extensionIds?.[0]) params.extensionId = options.extensionIds[0];
  if (options.userMetadata) params.userMetadata = options.userMetadata;

  // Proxy configuration
  if (options.proxies === true) {
    params.proxies = true;
  } else if (Array.isArray(options.proxies)) {
    params.proxies = options.proxies.map((p: any) => {
      if (p.type === 'custom' && p.server) {
        return {
          type: 'external' as const,
          server: p.server,
          username: p.username,
          password: p.password,
          domainPattern: p.domainPattern,
        };
      }
      return {
        type: 'browserbase' as const,
        geolocation: p.geolocation,
        domainPattern: p.domainPattern,
      };
    });
  }

  // Browser settings
  const browserSettings: Record<string, any> = {};
  if (options.viewport) browserSettings.viewport = options.viewport;
  if (options.stealth !== undefined) browserSettings.advancedStealth = options.stealth;
  if (options.recording !== undefined) browserSettings.recordSession = options.recording;
  if (options.logging !== undefined) browserSettings.logSession = options.logging;
  if (options.profileId) {
    browserSettings.context = { id: options.profileId, persist: true };
  }

  if (Object.keys(browserSettings).length > 0) {
    params.browserSettings = browserSettings;
  }

  return params;
}

/**
 * Normalize a Browserbase session into our standard shape
 */
function normalizeSession(session: BrowserbaseSession) {
  return {
    session,
    sessionId: session.id,
    connectUrl: session.connectUrl,
    status: mapStatus(session.status),
  };
}

function mapStatus(status: string): 'created' | 'running' | 'completed' | 'failed' | 'timed_out' {
  switch (status) {
    case 'RUNNING': return 'running';
    case 'COMPLETED': return 'completed';
    case 'FAILED':
    case 'ERROR': return 'failed';
    case 'TIMED_OUT': return 'timed_out';
    default: return 'created';
  }
}

/**
 * Create a Browserbase browser provider instance
 *
 * @example
 * ```ts
 * import { browserbase } from '@computesdk/browserbase';
 *
 * const bb = browserbase({ apiKey: 'bb_live_...' });
 *
 * // Create a stealth browser session
 * const session = await bb.session.create({ stealth: true, proxies: true });
 * console.log(session.connectUrl);
 *
 * // Connect with Playwright
 * const browser = await chromium.connectOverCDP(session.connectUrl);
 * const page = browser.contexts()[0].pages()[0];
 * await page.goto('https://example.com');
 *
 * // Get session recording after
 * const recording = await session.getRecording();
 * ```
 */
export const browserbase = defineBrowserProvider<BrowserbaseSession, BrowserbaseConfig>({
  name: 'browserbase',
  methods: {
    // ─── Session Lifecycle ─────────────────────────────────────────────
    session: {
      create: async (config, options) => {
        const client = createClient(config);
        const params = mapSessionOptions(config, options);
        const session = await client.sessions.create(params);
        return normalizeSession(session);
      },

      getById: async (config, sessionId) => {
        const client = createClient(config);
        try {
          const session = await client.sessions.retrieve(sessionId);
          return normalizeSession(session as BrowserbaseSession);
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const response = await client.sessions.list();
        return (response as BrowserbaseSession[]).map(normalizeSession);
      },

      destroy: async (config, sessionId) => {
        const client = createClient(config);
        await client.sessions.update(sessionId, { status: 'REQUEST_RELEASE' });
      },

      getConnectUrl: async (config, sessionId) => {
        const client = createClient(config);
        const session = await client.sessions.retrieve(sessionId);
        return (session as BrowserbaseSession).connectUrl;
      },
    },

    // ─── Profiles (Browserbase Contexts) ───────────────────────────────
    profile: {
      create: async (config, options) => {
        const client = createClient(config);
        const { projectId } = resolveConfig(config);
        const result = await client.contexts.create(projectId ? { projectId } : {});
        return {
          profileId: result.id,
          name: options?.name,
          metadata: options?.metadata as Record<string, unknown> | undefined,
        } satisfies BrowserProfile;
      },

      get: async (config, profileId) => {
        const client = createClient(config);
        try {
          const result = await client.contexts.retrieve(profileId);
          return { profileId: result.id } satisfies BrowserProfile;
        } catch {
          return null;
        }
      },

      list: async (_config) => {
        // Browserbase API doesn't expose a list contexts endpoint
        // Return empty — users track their own context IDs
        return [];
      },

      delete: async (config, profileId) => {
        const client = createClient(config);
        await client.contexts.delete(profileId);
      },
    },

    // ─── Extensions ────────────────────────────────────────────────────
    extension: {
      create: async (config, options) => {
        const client = createClient(config);
        const blob = typeof options.file === 'string'
          ? new Blob([options.file])
          : new Blob([new Uint8Array(options.file).buffer as ArrayBuffer]);
        const file = new File([blob], options.name ?? 'extension.zip');
        const result = await client.extensions.create({ file });
        return {
          extensionId: result.id,
          name: options.name,
        } satisfies BrowserExtension;
      },

      get: async (config, extensionId) => {
        const client = createClient(config);
        try {
          const result = await client.extensions.retrieve(extensionId);
          return { extensionId: result.id } satisfies BrowserExtension;
        } catch {
          return null;
        }
      },

      delete: async (config, extensionId) => {
        const client = createClient(config);
        await client.extensions.delete(extensionId);
      },
    },

    // ─── Logs ──────────────────────────────────────────────────────────
    logs: {
      list: async (config, sessionId) => {
        const client = createClient(config);
        const response = await client.sessions.logs.list(sessionId);
        return (response as any[]).map(log => ({
          timestamp: new Date(log.timestamp),
          level: (log.level ?? 'info') as BrowserLog['level'],
          message: log.message ?? '',
          data: log.params,
        }));
      },
    },

    // ─── Recordings ────────────────────────────────────────────────────
    recording: {
      get: async (config, sessionId) => {
        const client = createClient(config);
        try {
          const data = await client.sessions.recording.retrieve(sessionId);
          return {
            recordingId: sessionId,
            sessionId,
            format: 'rrweb',
            data,
          } satisfies BrowserRecording;
        } catch {
          return null;
        }
      },
    },
  },
});
