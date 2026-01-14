/**
 * Compute daemon lifecycle management
 *
 * Handles health checks and waiting for the compute daemon
 * to become ready after installation.
 */

import { Sandbox } from '../client';

/**
 * Options for waiting for compute daemon to be ready
 */
export interface WaitForComputeReadyOptions {
  /** Maximum number of retry attempts (default: 30) */
  maxRetries?: number;
  /** Initial delay between retries in milliseconds (default: 500) */
  initialDelayMs?: number;
  /** Maximum delay between retries in milliseconds (default: 5000) */
  maxDelayMs?: number;
  /** Backoff multiplier for exponential backoff (default: 1.5) */
  backoffFactor?: number;
}

/**
 * Wait for compute daemon to be ready by polling the health endpoint
 * with exponential backoff for faster success and less noise
 */
export async function waitForComputeReady(
  client: Sandbox,
  options: WaitForComputeReadyOptions = {}
): Promise<void> {
  const maxRetries = options.maxRetries ?? 30;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const backoffFactor = options.backoffFactor ?? 1.5;

  let lastError: Error | null = null;
  let currentDelay = initialDelayMs;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await client.health();
      
      // Success! Log if in debug mode
      if (process.env.COMPUTESDK_DEBUG) {
        console.log(`[Lifecycle] Sandbox ready after ${i + 1} attempt${i === 0 ? '' : 's'}`);
      }
      
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // On last attempt, throw detailed error
      if (i === maxRetries - 1) {
        throw new Error(
          `Sandbox failed to become ready after ${maxRetries} attempts.\n` +
          `Last error: ${lastError.message}\n\n` +
          `Possible causes:\n` +
          `  1. Sandbox failed to start (check provider dashboard for errors)\n` +
          `  2. Network connectivity issues between your app and the sandbox\n` +
          `  3. Sandbox is taking longer than expected to initialize\n` +
          `  4. Invalid sandbox URL or authentication credentials\n\n` +
          `Troubleshooting:\n` +
          `  - Check sandbox logs in your provider dashboard\n` +
          `  - Verify your network connection\n` +
          `  - Try increasing maxRetries if initialization is slow\n` +
          `  - Enable debug mode: export COMPUTESDK_DEBUG=1`
        );
      }

      // Wait with exponential backoff before next attempt
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      
      // Increase delay for next attempt (exponential backoff with cap)
      currentDelay = Math.min(currentDelay * backoffFactor, maxDelayMs);
    }
  }
}
