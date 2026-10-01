/**
 * Egress router helpers for sandboxes created with
 * `CreateSandboxOptions.egress`.
 */

import type { SandboxEgressInfo } from './types/universal-sandbox';

/**
 * Environment variables a job container needs to route traffic through the
 * sandbox's egress router and trust its generated CA: proxy vars for
 * HTTP(S)_PROXY-aware tooling plus the per-runtime CA-bundle knobs for tools
 * that manage their own trust stores.
 */
export function sandboxEgressEnvVars(egress: SandboxEgressInfo): Record<string, string> {
  return {
    HTTPS_PROXY: egress.proxyUrl,
    https_proxy: egress.proxyUrl,
    HTTP_PROXY: egress.proxyUrl,
    http_proxy: egress.proxyUrl,
    ALL_PROXY: egress.proxyUrl,
    all_proxy: egress.proxyUrl,
    GIT_SSL_CAINFO: egress.caCertPath,
    NODE_EXTRA_CA_CERTS: egress.caCertPath,
    REQUESTS_CA_BUNDLE: egress.caCertPath,
    SSL_CERT_FILE: egress.caCertPath,
  };
}
