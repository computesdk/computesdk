// Host rules shared by the client and the login flow.

export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1' || h === '::1';
}

/** https anywhere; plaintext http only to loopback. */
export function isSecureTransport(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && isLoopbackHost(url.hostname);
}

export function isTrustedHost(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  return host === 'rgstr.org' || host.endsWith('.rgstr.org') || host === 'computesdk.com' || host.endsWith('.computesdk.com') || isLoopbackHost(host);
}
