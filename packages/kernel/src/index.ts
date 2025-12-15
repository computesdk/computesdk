/**
 * Kernel Provider - Factory-based Implementation
 * 
 * Kernel API provides browser automation sessions via their cloud infrastructure.
 * Core API endpoints:
 * - POST /browsers - Create a new browser session
 * - DELETE /browsers/{session_id} - Destroy a browser session
 * - GET /browsers - List all browser sessions
 * - GET /browsers/{session_id} - Get browser session details
 */

import { createProvider } from 'computesdk';
import type { Runtime, CreateSandboxOptions, RunCommandOptions } from 'computesdk';

/**
 * Kernel browser session interface matching the API response structure
 */
export interface KernelSession {
  /** Unique identifier for the browser session */
  session_id: string;
  /** URL to view and interact with the browser session in real-time via web interface */
  browser_live_view_url: string;
  /** WebSocket URL for Chrome DevTools Protocol (CDP) connection - use with Puppeteer/Playwright */
  cdp_ws_url: string;
  /** ISO 8601 timestamp of when the session was created */
  created_at: string;
  /** Whether the browser is running in headless mode (no GUI/VNC) */
  headless: boolean;
  /** Whether the browser is running in stealth mode to avoid bot detection */
  stealth: boolean;
  /** Session timeout in seconds */
  timeout_seconds: number;
}

/**
 * Kernel-specific configuration options
 */
export interface KernelConfig {
  /** Kernel API key - if not provided, will fallback to KERNEL_API_KEY environment variable */
  apiKey?: string;
}

/**
 * Extended create options for Kernel browser sessions
 */
export interface KernelCreateOptions extends CreateSandboxOptions {
  /** Session timeout in seconds (default: 300) */
  timeout_seconds?: number;
  /** Launch browser in headless mode (no VNC/GUI). Defaults to false. */
  headless?: boolean;
  /** Launch browser in stealth mode to reduce bot detection. Defaults to false. */
  stealth?: boolean;
}

/**
 * Validate and retrieve Kernel API credentials
 */
export const getAndValidateCredentials = (config: KernelConfig) => {
  const apiKey = config.apiKey || (typeof process !== 'undefined' && process.env?.KERNEL_API_KEY) || '';

  if (!apiKey) {
    throw new Error(
      'Missing Kernel API key. Provide apiKey in config or set KERNEL_API_KEY environment variable.'
    );
  }

  return { apiKey };
};

/**
 * Fetch helper for Kernel API calls
 */
export const fetchKernel = async (
  apiKey: string,
  endpoint: string,
  options: RequestInit = {}
) => {
  const url = `https://api.onkernel.com${endpoint}`;
  const requestOptions: RequestInit = {
    method: 'GET',
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      ...(options.headers || {})
    }
  };
  
  const response = await fetch(url, requestOptions);

  if (!response.ok) {
    let errorMessage = `${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.code && errorData.message) {
        errorMessage = `[${errorData.code}] ${errorData.message}`;
      }
    } catch {
      // If JSON parsing fails, use status text
    }
    throw new Error(`Kernel API error: ${errorMessage}`);
  }

  // Handle 204 No Content responses (like DELETE operations)
  if (response.status === 204) {
    return {};
  }

  return response.json();
};

/**
 * Create a Kernel provider instance using the factory pattern
 */
export const kernel = createProvider<KernelSession, KernelConfig>({
  name: 'kernel',
  methods: {
    sandbox: {
      // Collection operations (compute.sandbox.*)
      create: async (config: KernelConfig, options?: KernelCreateOptions) => {
        const { apiKey } = getAndValidateCredentials(config);

        try {
          const createSessionData: any = {
            timeout_seconds: options?.timeout_seconds || 300
          };
          
          // Add optional headless and stealth options if provided
          if (options?.headless !== undefined) {
            createSessionData.headless = options.headless;
          }
          if (options?.stealth !== undefined) {
            createSessionData.stealth = options.stealth;
          }

          const responseData = await fetchKernel(apiKey, '/browsers', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(createSessionData)
          });
          
          if (!responseData || !responseData.session_id) {
            throw new Error(`Session ID is undefined. Full response: ${JSON.stringify(responseData, null, 2)}`);
          }

          const kernelSession: KernelSession = {
            session_id: responseData.session_id,
            browser_live_view_url: responseData.browser_live_view_url,
            cdp_ws_url: responseData.cdp_ws_url,
            created_at: responseData.created_at,
            headless: responseData.headless,
            stealth: responseData.stealth,
            timeout_seconds: responseData.timeout_seconds
          };

          return {
            sandbox: kernelSession,
            sandboxId: responseData.session_id
          };
        } catch (error) {
          throw new Error(
            `Failed to create Kernel browser session: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      getById: async (config: KernelConfig, sessionId: string) => {
        const { apiKey } = getAndValidateCredentials(config);

        try {
          const responseData = await fetchKernel(apiKey, `/browsers/${sessionId}`);
          
          if (!responseData) {
            return null;
          }
          
          const kernelSession: KernelSession = {
            session_id: responseData.session_id,
            browser_live_view_url: responseData.browser_live_view_url,
            cdp_ws_url: responseData.cdp_ws_url,
            created_at: responseData.created_at,
            headless: responseData.headless,
            stealth: responseData.stealth,
            timeout_seconds: responseData.timeout_seconds
          };
          
          return {
            sandbox: kernelSession,
            sandboxId: sessionId
          };
        } catch (error) {
          // If it's a 404 or not_found error, return null to indicate session not found
          if (error instanceof Error && (error.message.includes('404') || error.message.includes('not_found'))) {
            return null;
          }
          throw new Error(
            `Failed to get Kernel browser session: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },
      
      list: async (config: KernelConfig) => {
        const { apiKey } = getAndValidateCredentials(config);

        try {
          const responseData = await fetchKernel(apiKey, '/browsers');
          
          // API returns a direct array of sessions
          const items = responseData;
          
          // Transform each session into the expected format
          const sessions = items.map((session: any) => {
            const kernelSession: KernelSession = {
              session_id: session.session_id,
              browser_live_view_url: session.browser_live_view_url,
              cdp_ws_url: session.cdp_ws_url,
              created_at: session.created_at,
              headless: session.headless,
              stealth: session.stealth,
              timeout_seconds: session.timeout_seconds
            };

            return {
              sandbox: kernelSession,
              sandboxId: session.session_id
            };
          });

          return sessions;
        } catch (error) {
          throw new Error(
            `Failed to list Kernel browser sessions: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      destroy: async (config: KernelConfig, sessionId: string) => {
        const { apiKey } = getAndValidateCredentials(config);

        try {
          await fetchKernel(apiKey, `/browsers/${sessionId}`, {
            method: 'DELETE'
          });
        } catch (error) {
          // For destroy operations, we typically don't throw if the session is already gone
          if (error instanceof Error && error.message.includes('404')) {
            console.warn(`Kernel session ${sessionId} already destroyed`);
            return;
          }
          throw new Error(
            `Failed to destroy Kernel browser session: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      },

      // Instance operations (minimal stubs - not implemented yet)
      runCode: async (_sandbox: KernelSession, _code: string, _runtime?: Runtime) => {
        throw new Error('Kernel runCode method not implemented yet');
      },

      runCommand: async (_sandbox: KernelSession, _command: string, _args?: string[], _options?: RunCommandOptions) => {
        throw new Error('Kernel runCommand method not implemented yet');
      },

      getInfo: async (_sandbox: KernelSession) => {
        throw new Error('Kernel getInfo method not implemented yet');
      },

      getUrl: async (_sandbox: KernelSession, _options: { port: number; protocol?: string }) => {
        throw new Error('Kernel getUrl method not implemented yet');
      },

    },
  },
});
