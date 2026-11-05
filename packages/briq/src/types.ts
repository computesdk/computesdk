export interface BriqConfig {
  /** Briq API key. Falls back to the `BRIQ_API_KEY` environment variable. */
  apiKey?: string;
  /** API address. Falls back to `BRIQ_API_URL`, then `https://api.briq.cloud`. */
  baseUrl?: string;
  /** Stack that holds the instances. Default `computesdk`. */
  stack?: string;
  /** Custom HTTP transport must honor AbortSignal. Redirects remain forbidden. */
  fetch?: typeof fetch;
}
/** Credentials and transport remain in the provider closure. */
export interface BriqInstance {
  id: string;
}
