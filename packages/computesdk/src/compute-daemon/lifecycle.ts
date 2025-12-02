/**
 * Compute daemon lifecycle management
 *
 * Handles health checks and waiting for the compute daemon
 * to become ready after installation.
 */

import { ComputeClient } from '@computesdk/client';

/**
 * Wait for compute daemon to be ready by polling the health endpoint
 */
export async function waitForComputeReady(
  client: ComputeClient,
  maxRetries = 30,
  delayMs = 2000
): Promise<void> {
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await client.health();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Only log on last attempt to avoid noise
      if (i === maxRetries - 1) {
        throw new Error(
          `Compute daemon failed to start after ${maxRetries} attempts (${maxRetries * delayMs / 1000}s).\n` +
          `Last error: ${lastError.message}\n` +
          `This could indicate:\n` +
          `  1. The compute daemon failed to start in the sandbox\n` +
          `  2. The sandbox_url is incorrect or unreachable\n` +
          `  3. The sandbox is taking longer than expected to initialize`
        );
      }

      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
