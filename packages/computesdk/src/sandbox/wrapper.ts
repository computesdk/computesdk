/**
 * Sandbox wrapper with ComputeClient enhancement
 *
 * Wraps provider sandboxes with ComputeClient to add powerful features
 * like WebSocket terminals, file watchers, and signals while preserving
 * access to the original provider-specific instance.
 */

import { ComputeClient } from '@computesdk/client';
import type { Sandbox, ComputeEnhancedSandbox } from '../types';
import type { AuthorizationResponse } from '../auth/license';
import { waitForComputeReady } from '../compute-daemon/lifecycle';

/**
 * Wrap a provider sandbox with ComputeClient while preserving the original sandbox
 * This adds powerful features like WebSocket terminals, file watchers, and signals
 */
export async function wrapWithComputeClient(
  originalSandbox: Sandbox,
  authResponse: AuthorizationResponse
): Promise<ComputeEnhancedSandbox> {
  const client = new ComputeClient({
    sandboxUrl: authResponse.sandbox_url,
    sandboxId: originalSandbox.sandboxId,
    provider: originalSandbox.provider,
    token: authResponse.access_token,
    WebSocket: globalThis.WebSocket
  });

  // Wait for compute daemon to be ready before returning
  await waitForComputeReady(client);

  // Store the original sandbox for getInstance() and getProvider() calls
  // We create a proxy-like object that delegates most calls to ComputeClient
  // but preserves access to the original provider sandbox
  const wrappedSandbox = Object.assign(client, {
    __originalSandbox: originalSandbox,

    // Override getInstance to return the original provider's instance
    getInstance: () => originalSandbox.getInstance(),

    // Override getProvider to return the original provider
    getProvider: () => originalSandbox.getProvider()
  });

  return wrappedSandbox as ComputeEnhancedSandbox;
}
