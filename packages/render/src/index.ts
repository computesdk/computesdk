/**
 * Render package placeholder.
 *
 * Render support previously depended on the hosted control-plane transport,
 * which has been removed from computesdk.
 */

/**
 * Render configuration (kept for compile-time compatibility of callers).
 */
export interface RenderConfig {
  /** Render API key */
  apiKey?: string;
  /** Render owner ID */
  ownerId?: string;
}

/**
 * Render provider entrypoint.
 *
 * This package no longer provides a direct provider implementation.
 */
export function render(_config: RenderConfig): never {
  throw new Error(
    '@computesdk/render is no longer supported after control-plane removal. ' +
      'Use a direct provider package (for example @computesdk/e2b, @computesdk/modal, @computesdk/vercel, or @computesdk/daytona) with computesdk provider/providers config.'
  );
}
