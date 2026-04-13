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
  BrowserLog,
  BrowserRecording,
} from '@computesdk/provider';

import type { BrowserCreateResponse } from '@onkernel/sdk/resources/browsers';

/**
 * Kernel-specific configuration options
 */
export interface KernelConfig {
  /** Kernel API key — falls back to KERNEL_API_KEY env var */
  apiKey?: string;
  /** Invocation ID for the Kernel action context */
  invocationId?: string;
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

  return { apiKey, invocationId: config.invocationId };
}

/**
 * Create a Kernel SDK client from config
 */
function createClient(config: KernelConfig): Kernel {
  const { apiKey } = resolveConfig(config);
  return new Kernel({ apiKey });
}

const KERNEL_API_BASE = 'https://api.onkernel.com';

/**
 * Make a direct API call to Kernel for endpoints not yet in the SDK
 */
async function kernelFetch(config: KernelConfig, path: string, options: RequestInit = {}) {
  const { apiKey } = resolveConfig(config);
  const response = await fetch(`${KERNEL_API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Kernel API ${options.method ?? 'GET'} ${path} failed (${response.status}): ${body}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

/**
 * Map ComputeSDK session options to Kernel create browser params.
 *
 * The SDK types currently only require invocation_id, but the API
 * accepts additional fields (stealth, viewport, etc.) so we pass
 * them through via a type assertion.
 */
function mapSessionOptions(config: KernelConfig, options?: CreateBrowserSessionOptions) {
  const { invocationId } = resolveConfig(config);
  const params: Record<string, any> = {};

  if (invocationId) params.invocation_id = invocationId;

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
        const params = mapSessionOptions(config, options);
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
        const browsers = await (client.browsers as any).list();
        return (browsers as any[]).map((browser: any) => ({
          session: browser as BrowserCreateResponse,
          sessionId: browser.session_id,
          connectUrl: browser.cdp_ws_url,
        }));
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
        const params: Record<string, any> = {};
        if (options?.name) params.name = options.name;
        const result = await kernelFetch(config, '/profiles', {
          method: 'POST',
          body: JSON.stringify(params),
        });
        return {
          profileId: result.id,
          name: result.name ?? options?.name,
          createdAt: result.created_at ? new Date(result.created_at) : undefined,
          metadata: options?.metadata as Record<string, unknown> | undefined,
        } satisfies BrowserProfile;
      },

      get: async (config, profileId) => {
        try {
          const result = await kernelFetch(config, `/profiles/${profileId}`);
          return {
            profileId: result.id,
            name: result.name,
            createdAt: result.created_at ? new Date(result.created_at) : undefined,
          } satisfies BrowserProfile;
        } catch {
          return null;
        }
      },

      list: async (config) => {
        const results = await kernelFetch(config, '/profiles');
        return (results as any[]).map((result) => ({
          profileId: result.id,
          name: result.name,
          createdAt: result.created_at ? new Date(result.created_at) : undefined,
        } satisfies BrowserProfile));
      },

      delete: async (config, profileId) => {
        await kernelFetch(config, `/profiles/${profileId}`, { method: 'DELETE' });
      },
    },

    // ─── Extensions ───────────────────────────────────────────────────
    extension: {
      create: async (config, options) => {
        const { apiKey } = resolveConfig(config);
        const blob = typeof options.file === 'string'
          ? new Blob([options.file])
          : new Blob([new Uint8Array(options.file).buffer as ArrayBuffer]);
        const formData = new FormData();
        formData.append('file', new File([blob], options.name ?? 'extension.zip'));
        if (options.name) formData.append('name', options.name);
        const response = await fetch(`${KERNEL_API_BASE}/extensions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}` },
          body: formData,
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Failed to upload Kernel extension (${response.status}): ${body}`);
        }
        const result = await response.json();
        return {
          extensionId: result.id,
          name: result.name ?? options.name,
        } satisfies BrowserExtension;
      },

      get: async (config, extensionId) => {
        try {
          const result = await kernelFetch(config, `/extensions/${extensionId}`);
          return {
            extensionId: result.id,
            name: result.name,
          } satisfies BrowserExtension;
        } catch {
          return null;
        }
      },

      delete: async (config, extensionId) => {
        await kernelFetch(config, `/extensions/${extensionId}`, { method: 'DELETE' });
      },
    },

    // ─── Logs ─────────────────────────────────────────────────────────
    logs: {
      list: async (config, sessionId) => {
        const { apiKey } = resolveConfig(config);
        const url = `${KERNEL_API_BASE}/browsers/${sessionId}/logs/stream?source=supervisor&follow=false`;
        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'text/event-stream' },
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Failed to fetch Kernel logs (${response.status}): ${body}`);
        }
        const text = await response.text();
        const logs: BrowserLog[] = [];
        for (const block of text.split(/\r?\n\r?\n/)) {
          const lines = block.split(/\r?\n/).filter((l) => l.startsWith('data:'));
          if (!lines.length) continue;
          const data = lines.map((l) => l.slice(5).trim()).join('');
          try {
            const event = JSON.parse(data);
            logs.push({
              timestamp: new Date(event.timestamp),
              level: 'info',
              message: event.message ?? '',
            });
          } catch {
            // skip malformed events
          }
        }
        return logs;
      },
    },

    // ─── Recordings (Replays) ─────────────────────────────────────────
    recording: {
      get: async (config, sessionId) => {
        try {
          const result = await kernelFetch(config, `/browsers/${sessionId}/replays`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          return {
            recordingId: result.replay_id,
            sessionId,
            format: 'mp4',
            url: result.replay_view_url,
          } satisfies BrowserRecording;
        } catch {
          return null;
        }
      },
    },
  },
});
