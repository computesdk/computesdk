import type { Command } from '../types.js';

/**
 * Download file with curl
 * @example curl('https://example.com/file.tar.gz')
 * @example curl('https://example.com/file.tar.gz', { output: 'file.tar.gz' })
 */
export const curl = (url: string, options?: { output?: string; silent?: boolean }): Command => {
  const args = ['curl'];
  if (options?.silent) args.push('-s');
  args.push('-L'); // follow redirects
  if (options?.output) {
    args.push('-o', options.output);
  }
  args.push(url);
  return args as Command;
};

/**
 * Download file with wget
 * @example wget('https://example.com/file.tar.gz')
 * @example wget('https://example.com/file.tar.gz', { output: 'file.tar.gz' })
 */
export const wget = (url: string, options?: { output?: string; quiet?: boolean }): Command => {
  const args = ['wget'];
  if (options?.quiet) args.push('-q');
  if (options?.output) {
    args.push('-O', options.output);
  }
  args.push(url);
  return args as Command;
};

/**
 * Port management utilities
 */
export const port = {
  /**
   * Find process using a port (using lsof)
   * @example port.find(3000)
   */
  find: (p: number): Command => ['lsof', '-i', `:${p}`],

  /**
   * Kill process on a port
   * @example port.kill(3000)
   */
  kill: (p: number): Command => ['sh', '-c', `lsof -ti :${p} | xargs kill -9 2>/dev/null || true`],

  /**
   * Check if port is in use (exits 0 if in use)
   * @example port.isUsed(3000)
   */
  isUsed: (p: number): Command => ['sh', '-c', `lsof -i :${p} >/dev/null 2>&1`],

  /**
   * List all listening ports
   * @example port.list()
   */
  list: (): Command => ['ss', '-tlnp'],

  /**
   * Wait for port to be available (with timeout)
   * @example port.waitFor(3000, 30)
   */
  waitFor: (p: number, timeoutSeconds?: number): Command => {
    const timeout = timeoutSeconds ?? 30;
    return ['sh', '-c', `for i in $(seq 1 ${timeout}); do nc -z localhost ${p} && exit 0 || sleep 1; done; exit 1`];
  },
};

/**
 * Network utilities
 */
export const net = {
  /**
   * Check connectivity to host
   * @example net.ping('google.com')
   * @example net.ping('google.com', 3)
   */
  ping: (host: string, count?: number): Command => {
    return count ? ['ping', '-c', String(count), host] : ['ping', '-c', '1', host];
  },

  /**
   * Check if host:port is reachable
   * @example net.check('localhost', 3000)
   */
  check: (host: string, p: number): Command => ['nc', '-z', host, String(p)],

  /**
   * Get public IP
   * @example net.publicIp()
   */
  publicIp: (): Command => ['curl', '-s', 'ifconfig.me'],

  /**
   * Show network interfaces
   * @example net.interfaces()
   */
  interfaces: (): Command => ['ip', 'addr'],
};
