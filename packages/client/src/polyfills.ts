/**
 * Polyfills for Node.js and older browser environments
 *
 * This module sets up fetch and WebSocket polyfills to ensure the client
 * works in any environment (Node.js, older browsers, etc.)
 */

// Import polyfills
import crossFetch from 'cross-fetch';
import WebSocketPolyfill from 'isomorphic-ws';

/**
 * Setup polyfills for Node.js and older environments
 *
 * This function should be called before using the ComputeClient in Node.js
 * or environments without native fetch/WebSocket support.
 *
 * @example
 * ```typescript
 * import { setupPolyfills } from '@computesdk/client/polyfills'
 * import { ComputeClient } from '@computesdk/client'
 *
 * // Setup polyfills first
 * setupPolyfills();
 *
 * // Now create and use the client
 * const client = new ComputeClient({ apiUrl: '...' });
 * ```
 */
export function setupPolyfills(): void {
  // Setup fetch polyfill if not available
  if (typeof globalThis.fetch === 'undefined') {
    globalThis.fetch = crossFetch as any;
  }

  // Setup WebSocket polyfill if not available
  if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = WebSocketPolyfill as any;
  }
}

/**
 * Auto-setup polyfills
 *
 * Automatically sets up polyfills when this module is imported.
 * Use this for convenience in Node.js environments.
 *
 * @example
 * ```typescript
 * // Polyfills are automatically set up
 * import '@computesdk/client/polyfills/auto'
 * import { ComputeClient } from '@computesdk/client'
 *
 * const client = new ComputeClient({ apiUrl: '...' });
 * ```
 */
export function autoSetupPolyfills(): void {
  setupPolyfills();
}

// Export polyfill libraries for advanced use cases
export { crossFetch as fetch, WebSocketPolyfill as WebSocket };
