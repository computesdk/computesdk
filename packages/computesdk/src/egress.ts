/**
 * Egress router helpers for instances created with
 * `CreateInstanceOptions.egress`.
 */

import type { InstanceEgressInfo } from './types/universal-instance';

/**
 * Environment variables a job container needs to route traffic through the
 * instance's egress router and trust its generated CA: proxy vars for
 * HTTP(S)_PROXY-aware tooling plus the per-runtime CA-bundle knobs for tools
 * that manage their own trust stores.
 */
export function instanceEgressEnvVars(egress: InstanceEgressInfo): Record<string, string> {
  // CA vars that REPLACE the default trust store get the combined bundle so
  // passthrough hosts' public certs still verify; NODE_EXTRA_CA_CERTS only
  // appends to Node's store, so the CA alone is enough there.
  const replaceBundle = egress.caBundlePath ?? egress.caCertPath;
  return {
    HTTPS_PROXY: egress.proxyUrl,
    https_proxy: egress.proxyUrl,
    HTTP_PROXY: egress.proxyUrl,
    http_proxy: egress.proxyUrl,
    ALL_PROXY: egress.proxyUrl,
    all_proxy: egress.proxyUrl,
    GIT_SSL_CAINFO: replaceBundle,
    NODE_EXTRA_CA_CERTS: egress.caCertPath,
    REQUESTS_CA_BUNDLE: replaceBundle,
    SSL_CERT_FILE: replaceBundle,
  };
}

/** @deprecated Use {@link instanceEgressEnvVars}. */
export const sandboxEgressEnvVars = instanceEgressEnvVars;
