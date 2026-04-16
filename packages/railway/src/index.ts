/**
 * Railway package placeholder.
 *
 * Railway support previously depended on the hosted control-plane transport,
 * which has been removed from computesdk.
 */

/**
 * Railway configuration (kept for compile-time compatibility of callers).
 */
export interface RailwayConfig {
  /** Railway API key */
  apiKey?: string;
  /** Railway project ID */
  projectId?: string;
  /** Railway environment ID */
  environmentId?: string;
}

/**
 * Railway provider entrypoint.
 *
 * This package no longer provides a direct provider implementation.
 */
export function railway(_config: RailwayConfig): never {
  throw new Error(
    '@computesdk/railway is no longer supported after control-plane removal. ' +
      'Use a direct provider package (for example @computesdk/e2b, @computesdk/modal, @computesdk/vercel, or @computesdk/daytona) with computesdk provider/providers config.'
  );
}
