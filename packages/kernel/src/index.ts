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
  BrowserProfile,
  BrowserExtension,
  ProxyConfig,
} from '@computesdk/provider';
import type { ProxyCreateParams } from '@onkernel/sdk/resources/proxies';

import type { BrowserCreateResponse } from '@onkernel/sdk/resources/browsers';

const warnedUnsupported = new Set<string>();
function warnOnce(field: string, reason: string) {
  if (warnedUnsupported.has(field)) return;
  warnedUnsupported.add(field);
  console.warn(`[@computesdk/kernel] '${field}' is ignored: ${reason}`);
}

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
 * Inactivity timeout used for `keepAlive: true` when no explicit `timeout` is
 * given. Kernel keeps a disconnected browser in standby (no usage charges)
 * until `timeout_seconds` elapses; the API default is 60 s.
 */
const KEEP_ALIVE_TIMEOUT_SECONDS = 3600;

/**
 * Map ComputeSDK session options to Kernel create browser params.
 */
function mapSessionOptions(options?: CreateBrowserSessionOptions) {
  const params: Record<string, any> = {};

  if (!options) return params;

  if (options.stealth !== undefined) params.stealth = options.stealth;
  if (options.timeout !== undefined) {
    params.timeout_seconds = options.timeout;
  } else if (options.keepAlive === true) {
    params.timeout_seconds = KEEP_ALIVE_TIMEOUT_SECONDS;
  }

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
 * Map `proxies` to the Kernel proxy to create, if any. `true` means a managed
 * US residential proxy, like the other browser providers' `proxies: true`.
 * `false` keeps Kernel's default egress.
 */
function proxyParams(proxies: CreateBrowserSessionOptions['proxies']): ProxyCreateParams | undefined {
  if (proxies === undefined || proxies === false) return undefined;
  if (proxies === true) return { type: 'residential', name: 'computesdk-residential-us', config: { country: 'US' } };
  if (proxies.length > 1) warnOnce('proxies[1]', 'Kernel attaches one proxy per session; only the first entry is used.');
  const [proxy] = proxies as ProxyConfig[];
  if (!proxy) return undefined;
  if (proxy.type === 'custom') {
    warnOnce('proxies.custom', 'custom proxies need a Kernel proxy created with credentials; create one and pass its proxy_id through the Kernel SDK.');
    return undefined;
  }
  const country = proxy.geolocation?.country?.toUpperCase();
  return {
    type: proxy.type,
    name: `computesdk-${proxy.type}-${(country ?? 'any').toLowerCase()}`,
    config: country ? { country } : {},
  };
}

const proxyIds = new Map<string, Promise<string>>();

/**
 * Reuse the org's proxy with this name, creating it on first use. Kernel
 * proxies are org resources referenced by `proxy_id`, so one is shared across
 * sessions instead of created per session.
 */
function resolveProxyId(client: Kernel, apiKey: string, params: ProxyCreateParams): Promise<string> {
  const key = `${apiKey}:${params.name}`;
  let id = proxyIds.get(key);
  if (!id) {
    id = (async () => {
      const existing = (await client.proxies.list()).find((p) => p.name === params.name && p.type === params.type);
      return existing?.id ?? (await client.proxies.create(params)).id!;
    })();
    id.catch(() => proxyIds.delete(key));
    proxyIds.set(key, id);
  }
  return id;
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
        const proxy = proxyParams(options?.proxies);
        if (proxy) {
          try {
            params.proxy_id = await resolveProxyId(client, resolveConfig(config).apiKey, proxy);
          } catch (err) {
            console.warn(`[@computesdk/kernel] could not resolve a ${proxy.type} proxy, using Kernel's default egress: ${err}`);
          }
        }
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
