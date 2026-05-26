import { NorthflankApiCallError } from '@northflank/js-client';

export const PROVIDER = 'northflank' as const;
export const DEFAULT_SERVICE_PREFIX = 'computesdk-';
export const DEFAULT_DEPLOYMENT_PLAN = 'nf-compute-50';
export const DEFAULT_TIMEOUT_MS = 120_000;


/**
 * Any runtime label the caller wants — defaults to "node". `RUNTIME_IMAGES`
 * holds known image defaults; unknown runtimes work too, but the caller
 * must supply `config.image` or `internalDeployment` since there's no
 * default image to fall back on.
 */
export type Runtime = string;
export type NorthflankProtocol = 'HTTP' | 'HTTP/2' | 'TCP' | 'UDP';

export interface NorthflankPort {
  name: string;
  internalPort: number;
  public?: boolean;
  protocol?: NorthflankProtocol;
}

export type NorthflankPortInput = NorthflankPort | number;

export interface NorthflankInternalDeployment {
  /** Build service ID inside the same Northflank project */
  id: string;
  /** Branch to deploy from — defaults to "main" */
  branch?: string;
  /** Build SHA to deploy — defaults to "latest" */
  buildSHA?: string;
}

export const RUNTIME_IMAGES: Record<string, string> = {
  node: 'node:20-slim',
  python: 'python:3.11-slim',
};

export interface NorthflankConfig {
  token: string;
  projectId: string;
  teamId?: string;
  host?: string;
  servicePrefix?: string;
  image?: string;
  runtime?: string;
  deploymentPlan?: string;
  ports?: NorthflankPortInput[];
  timeout?: number;
  /** Deploy from a Northflank build service instead of an external image */
  internalDeployment?: NorthflankInternalDeployment;
}

export function prefix(config: NorthflankConfig): string {
  return config.servicePrefix ?? DEFAULT_SERVICE_PREFIX;
}

/**
 * Pulls a status code out of an error. Handles two shapes:
 *  1. REST errors → `NorthflankApiCallError` with `.status` set.
 *  2. WS exec errors → plain `Error` whose message looks like
 *     `Command execution failed: WebSocket error: Unexpected server response: 500`.
 *     `.status` is NOT set on these — the code lives inside the message string.
 */
const WS_STATUS_RE = /Unexpected server response:\s*(\d{3})/i;
export function extractStatus(error: unknown): number | undefined {
  if (error instanceof NorthflankApiCallError && typeof error.status === 'number') {
    return error.status;
  }
  if (error instanceof Error) {
    const m = error.message.match(WS_STATUS_RE);
    if (m) return Number(m[1]);
  }
  return undefined;
}

export function is404(error: unknown): boolean {
  if (extractStatus(error) === 404) return true;
  return error instanceof Error && (error.message.includes('404') || error.message.includes('not found'));
}

export function isAuthError(error: unknown): boolean {
  const s = extractStatus(error);
  if (s === 401 || s === 403) return true;
  return error instanceof Error && /\b(unauthorized|forbidden)\b/i.test(error.message);
}

/**
 * Permanent client-side error from the API — the request is malformed and
 * retrying will never succeed. 400 = Bad Request, 422 = Unprocessable Entity.
 */
export function isPermanentClientError(error: unknown): boolean {
  const s = extractStatus(error);
  if (s === 400 || s === 422) return true;
  return error instanceof Error && /\b(bad request|unprocessable)\b/i.test(error.message);
}

/**
 * Missing-file error — a `fileCopy` op against a path that doesn't exist.
 * Retrying never helps, so it must fast-fail out of the retry loop.
 */
export function isFileNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    /not found|enoent|no such file|does not exist/i.test(error.message)
  );
}

export function parseRuntime(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : 'node';
}

export function imageForRuntime(runtime: string, configured?: string): string {
  if (configured) return configured;
  const def = RUNTIME_IMAGES[runtime];
  if (def) return def;
  throw new Error(
    `No default image for runtime '${runtime}' — provide config.image or internalDeployment.`,
  );
}

export function generateServiceName(p: string, custom?: string): string {
  if (custom) {
    return custom.startsWith(p) ? custom : `${p}${custom}`;
  }
  return `${p}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isValidEnvKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

export function normalizePort(input: NorthflankPortInput): NorthflankPort {
  if (typeof input === 'number') {
    return { name: `p${input}`, internalPort: input, public: true, protocol: 'HTTP' };
  }
  return input;
}

export const DEFAULT_KEEP_ALIVE_COMMAND = 'sleep infinity';

export function projectParams(config: NorthflankConfig) {
  return config.teamId
    ? { teamId: config.teamId, projectId: config.projectId }
    : { projectId: config.projectId };
}

export function serviceParams(config: NorthflankConfig, serviceId: string) {
  return config.teamId
    ? { teamId: config.teamId, projectId: config.projectId, serviceId }
    : { projectId: config.projectId, serviceId };
}

export function mapStatus(
  deploymentStatus: string | undefined,
  paused: boolean | undefined,
): 'running' | 'stopped' | 'error' {
  if (deploymentStatus === 'FAILED') return 'error';
  if (paused) return 'stopped';
  if (deploymentStatus === 'COMPLETED') return 'running';
  return 'stopped';
}

export async function withExecRetry<T>(
  attempt: () => Promise<T>,
  opts: {
    serviceId: string;
    timeoutMs: number;
    pollIntervalMs?: number;
  },
): Promise<T> {
  const { serviceId, timeoutMs, pollIntervalMs = 50 } = opts;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      return await attempt();
    } catch (error) {
      if (
        is404(error) ||
        isAuthError(error) ||
        isPermanentClientError(error) ||
        isFileNotFound(error)
      ) {
        throw error;
      }
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  throw new Error(`Timeout running exec on service ${serviceId} after ${timeoutMs}ms`);
}
