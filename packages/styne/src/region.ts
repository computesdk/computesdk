/**
 * Sends each sandbox's requests to the API host of the region that runs it.
 *
 * Every sandbox record from the API names the domain that serves the sandbox's ports, `<region>.<root>`. The API of
 * that region answers at `<region>.api.<root>`, beside the global `api.<root>`, which sits behind a proxy: calls made
 * there skip the proxy hop and are not held to its 100 MB request body limit. Creates and account-wide calls stay on
 * the configured host, since a sandbox's region is known only once the API has placed it. A custom API URL is kept for
 * every call.
 *
 * The regional connection is opened as soon as a sandbox of that region is seen. Until it is open, the sandbox's
 * calls go out on the configured host's connection instead of waiting for a handshake, except request bodies of
 * 8 MiB or more, which wait for the regional host. A sandbox whose regional host cannot be reached (no connection, a
 * failed TLS handshake) or answers with a server error that did not come from the API (a proxy's error page) is served
 * through the configured host from then on. The API's own error answers concern the call, not the host, and are
 * returned as they are.
 */

import { BULK_BODY_BYTES, connectionReady, errorCodeOf, repeatable, request } from './client';
import type { ClientConfig, Reply, RequestError, RequestOptions } from './client';

interface Route {
  apiUrl: string;
  fallback: boolean;
}

/** Routes are kept for this many sandboxes; past it, the sandbox learnt longest ago goes back to the configured host. */
export const MAX_ROUTES = 10_000;

const routes = new Map<string, Route>();

const routeKey = (client: ClientConfig, id: string) => `${client.apiUrl} ${id}`;

/** The regional API URL for a sandbox served from `domain`, or `undefined` when the configured URL is not the global host. */
export function regionalApiUrl(apiUrl: string, domain: string | undefined): string | undefined {
  const dot = domain?.indexOf('.') ?? -1;
  if (!domain || dot <= 0) return undefined;
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    return undefined;
  }
  const root = domain.slice(dot + 1).toLowerCase();
  if (url.hostname.toLowerCase() !== `api.${root}`) return undefined;
  url.hostname = `${domain.slice(0, dot).toLowerCase()}.api.${root}`;
  return url.toString().replace(/\/+$/, '');
}

/** Records where a sandbox is served from, as a sandbox record from the API reports it. */
export function learnRoute(client: ClientConfig, id: string, domain: string | undefined): void {
  const key = routeKey(client, id);
  const apiUrl = regionalApiUrl(client.apiUrl, domain);
  if (apiUrl === undefined) {
    if (domain !== undefined) routes.delete(key);
    return;
  }
  let route = routes.get(key);
  if (route?.apiUrl !== apiUrl) {
    routes.delete(key);
    route = { apiUrl, fallback: false };
    routes.set(key, route);
    if (routes.size > MAX_ROUTES) routes.delete(routes.keys().next().value as string);
  }
  if (!route.fallback) regionalReady(route);
}

/** Whether the route's regional connection is open; opens it when it is not, and falls back if it never opens. */
function regionalReady(route: Route): boolean {
  return connectionReady(route.apiUrl, () => {
    route.fallback = true;
  });
}

const bodyBytes = (body: RequestOptions['body']) => (body === undefined ? 0 : typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength);

/** Forgets a sandbox that has ended. */
export function forgetRoute(client: ClientConfig, id: string): void {
  routes.delete(routeKey(client, id));
}

/** The API URL a sandbox's requests go to now. */
export function sandboxApiUrl(client: ClientConfig, id: string): string {
  const route = routes.get(routeKey(client, id));
  return route && !route.fallback ? route.apiUrl : client.apiUrl;
}

/** Forgets every route. */
export function clearRoutes(): void {
  routes.clear();
}

/** A server error from the regional host: the request is sent to the configured host as well when that is safe. */
function resendAfter(reply: Reply, method: string, options: RequestOptions): boolean {
  return reply.status === 503 || repeatable(method, options);
}

/** Whether an answer came from the Styne API itself, which names every error it sends with an `error_code`. */
const isApiAnswer = (reply: Reply) => errorCodeOf(reply) !== undefined;

/**
 * Sends a request about one sandbox to its regional host once its connection is open, or to the configured host.
 * When the regional host cannot be reached, or answers with a server error that is not the API's (a proxy's error
 * page), the sandbox is served through the configured host from then on, and the request is sent there as well when
 * that is safe (it never went out, it is safe to repeat, or the answer is `503`, the status of a request the server
 * did not take on). A request that is safe to repeat and failed on the regional connection in another way is sent
 * to the configured host once, and the sandbox keeps its route.
 */
export async function sandboxRequest(
  sandbox: { client: ClientConfig; id: string; domain?: string },
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<Reply> {
  const { client, id } = sandbox;
  let route = routes.get(routeKey(client, id));
  if (!route && sandbox.domain !== undefined) {
    learnRoute(client, id, sandbox.domain);
    route = routes.get(routeKey(client, id));
  }
  if (!route || route.fallback) return request(client, method, path, options);
  // A large body waits for the regional host: the configured host's proxy may refuse it.
  if (bodyBytes(options.body) < BULK_BODY_BYTES && !regionalReady(route)) return request(client, method, path, options);

  let reply: Reply;
  try {
    reply = await request({ ...client, apiUrl: route.apiUrl }, method, path, { ...options, failFastUnreachable: true });
  } catch (error) {
    const failed = error as RequestError;
    const safe = failed.delivery === 'unsent' || (failed.delivery === 'unknown' && repeatable(method, options));
    if (!safe) throw failed;
    if (failed.unreachable) route.fallback = true;
    return request(client, method, path, options);
  }
  if (reply.status < 500 || isApiAnswer(reply)) return reply;
  route.fallback = true;
  return resendAfter(reply, method, options) ? request(client, method, path, options) : reply;
}
