/**
 * Utility functions for ComputeSDK
 */

/**
 * Calculate exponential backoff delay with jitter
 * 
 * Uses exponential backoff (2^attempt) multiplied by base delay,
 * plus random jitter to prevent thundering herd.
 * 
 * @param attempt - Current retry attempt (0-indexed)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @param jitterMax - Maximum random jitter in milliseconds (default: 100)
 * @returns Delay in milliseconds
 * 
 * @example
 * ```typescript
 * // First retry: 1000-1100ms
 * calculateBackoff(0);
 * 
 * // Second retry: 2000-2100ms
 * calculateBackoff(1);
 * 
 * // Third retry: 4000-4100ms
 * calculateBackoff(2);
 * ```
 */
export function calculateBackoff(
  attempt: number,
  baseDelay: number = 1000,
  jitterMax: number = 100
): number {
  return baseDelay * Math.pow(2, attempt) + Math.random() * jitterMax;
}
