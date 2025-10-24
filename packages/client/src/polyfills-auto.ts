/**
 * Auto-setup polyfills
 *
 * Import this file to automatically setup polyfills for Node.js environments.
 *
 * @example
 * ```typescript
 * import '@computesdk/client/polyfills/auto'
 * import { ComputeClient } from '@computesdk/client'
 *
 * const client = new ComputeClient({ apiUrl: '...' });
 * ```
 */

import { setupPolyfills } from './polyfills';

// Automatically setup polyfills when this module is imported
setupPolyfills();
