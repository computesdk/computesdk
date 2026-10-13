/**
 * Preview URL scheme shared by the provider's `getUrl` and the gateway's Caddy
 * routing: `<port>-<instanceId>.<region>.<previewDomain>`. Port and instance
 * share one label so a single `*.<region>.<previewDomain>` certificate covers them.
 */

/** Matches a preview hostname's first label; group 1 is the port, group 2 the instance id. */
export const PREVIEW_LABEL_PATTERN = '^(\\d{4,5})-(i-[0-9a-f]{8,17})\\.';

export function normalizePreviewDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(normalized)) {
    throw new Error(`Invalid preview domain "${domain}": expected a DNS name like "preview.example.com".`);
  }
  return normalized;
}

/** Wildcard-covered zone for one region, e.g. "us-east-2.preview.example.com". */
export function previewRegionDomain(previewDomain: string, region: string): string {
  return `${region}.${normalizePreviewDomain(previewDomain)}`;
}

export function previewHostname(previewDomain: string, region: string, instanceId: string, port: number): string {
  if (!Number.isInteger(port) || port < 1000 || port > 65535) {
    throw new Error(`Invalid preview port ${port}: expected an integer between 1000 and 65535.`);
  }
  return `${port}-${instanceId}.${previewRegionDomain(previewDomain, region)}`;
}

/** Resource-name private DNS suffix EC2 uses in a region. */
export function privateDnsSuffix(region: string): string {
  return region === 'us-east-1' ? 'ec2.internal' : `${region}.compute.internal`;
}
