/**
 * Kernel Browser Provider - Factory-based Implementation
 *
 * Cloud browser sessions with stealth mode, GPU acceleration,
 * profiles, and extensions via the Kernel platform.
 */

import Kernel from '@onkernel/sdk';
import { defineBrowserProvider } from '@computesdk/provider';

import type {
  CreateBrowserSessionOptions,
  CreateBrowserProfileOptions,
  CreateBrowserExtensionOptions,
  BrowserProfile,
  BrowserExtension,

  BrowserRecording,
} from '@computesdk/provider';

import type { BrowserCreateResponse } from '@onkernel/sdk/resources/browsers';

/**
 * Kernel-specific configuration options
 */
export interface KernelConfig {
  /** Kernel API key — falls back to KERNEL_API_KEY env var */
  apiKey?: string;
}

/**
 * Resolve config values from explicit config or environment variables
 */
function resolveConfig(config: KernelConfig) {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.KERNEL_API_KEY) || '';

  if (!apiKey) {
    throw new Error(
      `Missing Kernel API key. Provide 'apiKey' in config or set KERNEL_API_KEY environment variable. ` +
      `Get your API key from https://app.onkernel.com`
    );
  }

  return { apiKey };
}

/**
 * Create a Kernel SDK client from config
 */
function createClient(config: KernelConfig): Kernel {
  const { apiKey } = resolveConfig(config);
  return new Kernel({ apiKey });
}

/**
 * Map ComputeSDK session options to Kernel create browser params.
 */
function mapSessionOptions(options?: CreateBrowserSessionOptions) {
  const params: Record<string, any> = {};

  if (!options) return params;

  if (options.stealth !== undefined) params.stealth = options.stealth;
  if (options.timeout !== undefined) params.timeout_seconds = options.timeout;

  // Viewport
  if (options.viewport) {
    params.viewport = {
      width: options.viewport.width,
      height: options.viewport.height,
    };
  }

  // Profile — map profileId to Kernel's profile object
  if (options.profileId) {
    params.profile = { id: options.profileId };
  }

  // Extensions — map extensionIds to Kernel's extensions array
  if (options.extensionIds?.length) {
    params.extensions = options.extensionIds.map((id: string) => ({ id }));
  }

  return params;
}

/**
 * Normalize a Kernel browser response into our standard shape
 */
function normalizeSession(browser: BrowserCreateResponse) {
  return {
    session: browser,
    sessionId: browser.session_id,
    connectUrl: browser.cdp_ws_url,
  };
}

/**
 * Create a Kernel browser provider instance
 *
 * @example
 * ```ts
 * import { kernel } from '@computesdk/kernel';
 *
 * const k = kernel({ apiKey: 'k_...' });
 *
 * // Create a browser session
 * const session = await k.session.create({ stealth: true });
 * console.log(session.connectUrl);
 *
 * // Connect with Playwright
 * const browser = await chromium.connectOverCDP(session.connectUrl);
 * const page = browser.contexts()[0].pages()[0];
 * await page.goto('https://example.com');
 * ```
 */
export const kernel = defineBrowserProvider<BrowserCreateResponse, KernelConfig>({
  name: 'kernel',
  methods: {
    // ─── Session Lifecycle ─────────────────────────────────────────────
    session: {
      create: async (config, options) => {
        const client = createClient(config);
        const params = mapSessionOptions(options);
        const browser = await client.browsers.create(params as any);
        return normalizeSession(browser);
      },

      getById: async (config, sessionId) => {
        const client = createClient(config);
        try {
          const browser = await client.browsers.retrieve(sessionId);
          return {
            session: browser as BrowserCreateResponse,
            sessionId: browser.session_id,
            connectUrl: browser.cdp_ws_url,
          };
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const sessions: { session: BrowserCreateResponse; sessionId: string; connectUrl: string }[] = [];
        for await (const browser of client.browsers.list()) {
          sessions.push({
            session: browser as BrowserCreateResponse,
            sessionId: browser.session_id,
            connectUrl: browser.cdp_ws_url,
          });
        }
        return sessions;
      },

      destroy: async (config, sessionId) => {
        const client = createClient(config);
        await (client.browsers as any).deleteByID(sessionId);
      },

      getConnectUrl: async (config, sessionId) => {
        const client = createClient(config);
        const browser = await client.browsers.retrieve(sessionId);
        return browser.cdp_ws_url;
      },
    },

    // ─── Profiles ─────────────────────────────────────────────────────
    profile: {
      create: async (config, options) => {
        const client = createClient(config);
        const params: { name?: string } = {};
        if (options?.name) params.name = options.name;
        const result = await client.profiles.create(params);
        return {
          profileId: result.id,
          name: result.name ?? options?.name,
          createdAt: result.created_at ? new Date(result.created_at) : undefined,
          metadata: options?.metadata as Record<string, unknown> | undefined,
        } satisfies BrowserProfile;
      },

      get: async (config, profileId) => {
        const client = createClient(config);
        try {
          const result = await client.profiles.retrieve(profileId);
          return {
            profileId: result.id,
            name: result.name ?? undefined,
            createdAt: result.created_at ? new Date(result.created_at) : undefined,
          } satisfies BrowserProfile;
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const client = createClient(config);
        const profiles: BrowserProfile[] = [];
        for await (const result of client.profiles.list()) {
          profiles.push({
            profileId: result.id,
            name: result.name ?? undefined,
            createdAt: result.created_at ? new Date(result.created_at) : undefined,
          } satisfies BrowserProfile);
        }
        return profiles;
      },

      delete: async (config, profileId) => {
        const client = createClient(config);
        await client.profiles.delete(profileId);
      },
    },

    // ─── Extensions ───────────────────────────────────────────────────
    extension: {
      create: async (config, options) => {
        const client = createClient(config);
        const blob = typeof options.file === 'string'
          ? new Blob([options.file])
          : new Blob([new Uint8Array(options.file).buffer as ArrayBuffer]);
        const file = new File([blob], options.name ?? 'extension.zip');
        const result = await client.extensions.upload({
          file,
          name: options.name,
        });
        return {
          extensionId: result.id,
          name: result.name ?? options.name,
        } satisfies BrowserExtension;
      },

      get: async (config, extensionId) => {
        const client = createClient(config);
        const extensions = await client.extensions.list();
        const result = extensions.find((ext) => ext.id === extensionId);
        if (!result) return null;
        return {
          extensionId: result.id,
          name: result.name ?? undefined,
        } satisfies BrowserExtension;
      },

      delete: async (config, extensionId) => {
        const client = createClient(config);
        await client.extensions.delete(extensionId);
      },
    },

    // ─── Logs ─────────────────────────────────────────────────────────
    logs: {
      list: async (config, sessionId) => {
        const client = createClient(config);
        const response = await (client.browsers as any).fs.readFile(sessionId, {
          path: '/var/log/supervisord/chromium',
        });
        const text = await response.text();
        const retrievedAt = new Date();
        const lines = text.split('\n').filter((line: string) => line.trim()).slice(-1000);
        return lines.map((line: string) => ({
          timestamp: retrievedAt,
          level: 'info' as const,
          message: line,
        }));
      },
    },
  },
});
