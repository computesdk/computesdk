/**
 * Thin client for the benchmarks-platform Actions v1 API.
 * Types mirror the wire shapes in benchmarks-platform `lib/ci/types.ts` —
 * keep them in sync by hand; the API is the contract.
 */

export const DEFAULT_BASE_URL = 'https://platform.computesdk.com';

export interface ActionsAuth {
  apiKey: string;
  baseUrl: string;
}

export interface CiWorkflowInput {
  name: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'choice' | 'environment';
  required: boolean;
  default: string;
  options?: string[];
}

export interface CiWorkflow {
  id: string;
  repoFullName: string;
  name: string;
  path: string;
  dispatchable: boolean;
  refs: string[];
  inputs: CiWorkflowInput[];
  schedules: unknown[];
}

export type CiConclusion = 'passed' | 'failed' | 'running' | 'cancelled' | 'none';
export type CiJobState =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface CiPlacementAttempt {
  provider: string;
  region?: string | null;
  error: string;
}

export interface CiStep {
  name: string;
  state: CiJobState;
  durationMs: number | null;
  exitCode: number | null;
}

export interface CiJob {
  id: string;
  name: string;
  needs: string[];
  workflowJobId: string | null;
  matrix: Record<string, string> | null;
  state: CiJobState;
  provider: string | null;
  region: string | null;
  sandboxId: string | null;
  placementAttempts: CiPlacementAttempt[];
  durationMs: number | null;
  steps: CiStep[];
}

export interface CiRun {
  id: string;
  repoFullName: string;
  ref: string;
  branchReason: string | null;
  headSha: string;
  event: string;
  prNumber: number | null;
  runNumber: number | null;
  title: string;
  workflowPath: string;
  workflowName: string;
  conclusion: CiConclusion;
  startedAt: string;
  durationMs: number | null;
  supersededByRunId: string | null;
  concurrencyGroup: string | null;
  cancellationReason: string | null;
  jobs: CiJob[];
  logTail: string[];
}

export interface CiArtifactListItem {
  id: string;
  name: string;
  fileName: string;
  contentType: string;
  byteLength: number;
  fileCount: number;
  skippedReason: string | null;
  expiresAt: string;
  expired: boolean;
}

export interface CiLogSegment {
  byteOffset: number;
  stream: 'stdout' | 'stderr';
  stepOrdinal: number | null;
  text: string;
}

/** One resumable read of a job log. Resume from `nextOffset`. */
export interface CiLogSlice {
  jobId: string;
  fromOffset: number;
  nextOffset: number;
  totalBytes: number;
  segments: CiLogSegment[];
  state: 'running' | 'complete' | 'failed' | 'cancelled' | 'expired' | 'pending';
  truncated: boolean;
}

export interface ActionsOrg {
  organizationId: string;
  name: string;
  slug: string;
}

export class ActionsApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ActionsApiError';
  }
}

export class ActionsClient {
  private orgPromise: Promise<ActionsOrg> | null = null;

  constructor(
    private readonly auth: ActionsAuth,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get baseUrl(): string {
    return this.auth.baseUrl;
  }

  /** The credential's org — fetched once, needed for dashboard URLs. */
  org(): Promise<ActionsOrg> {
    this.orgPromise ??= this.get<ActionsOrg>('/api/v1/actions/org');
    return this.orgPromise;
  }

  async get<T>(path: string, params?: Record<string, string | string[] | undefined>): Promise<T> {
    const url = new URL(`${this.auth.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
    }
    const res = await this.fetchImpl(url, { headers: this.headers() });
    return this.parse<T>(res);
  }

  async post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.auth.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse<T>(res);
  }

  /**
   * One `data:` JSON payload per SSE event. `next()` resolves to the payload,
   * or null when the stream ends. Call `close()` to abort.
   */
  async *sse(path: string, params?: Record<string, string | string[] | undefined>): AsyncGenerator<unknown> {
    const url = new URL(`${this.auth.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
    }
    const res = await this.fetchImpl(url, { headers: this.headers() });
    if (!res.ok) {
      await this.parse(res); // throws
    }
    if (!res.body) throw new Error('SSE response has no body');
    yield* readSseEvents(res.body);
  }

  /** Download bytes following redirects (artifact URLs 302 to storage). */
  async download(path: string): Promise<Uint8Array> {
    const res = await this.fetchImpl(`${this.auth.baseUrl}${path}`, {
      headers: this.headers(),
      redirect: 'follow',
    });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      throw new ActionsApiError(res.status, errorMessage(body, res.status), body);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.auth.apiKey}` };
  }

  private async parse<T>(res: Response): Promise<T> {
    const body = await res.json().catch(() => undefined);
    if (!res.ok) throw new ActionsApiError(res.status, errorMessage(body, res.status), body);
    return body as T;
  }
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body && typeof (body as { error: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return `Request failed with status ${status}`;
}

/** Minimal SSE reader: yields the JSON payload of each `data:` event. */
export async function* readSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of event.split('\n')) {
          if (line.startsWith('data: ')) {
            yield JSON.parse(line.slice(6));
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** `id:jobId:step:offset` — the run-stream watch cursor wire format. */
export function encodeWatchCursor(
  id: string,
  jobId: string,
  step: number | 'runner' | null,
  offset: number,
): string {
  const stepPart = step === null ? '-' : step === 'runner' ? 'runner' : String(step);
  return `${id}:${jobId}:${stepPart}:${offset}`;
}

export function resolveActionsAuth(opts: {
  apiKey?: string;
  baseUrl?: string;
  allowUntrustedHost?: boolean;
}): ActionsAuth {
  const apiKey = opts.apiKey ?? process.env.BENCHMARKS_PLATFORM_API_KEY;
  if (!apiKey) {
    throw new Error(
      'No API key. Set BENCHMARKS_PLATFORM_API_KEY or pass --api-key.',
    );
  }
  const baseUrl = (
    opts.baseUrl ??
    process.env.BENCHMARKS_PLATFORM_URL ??
    DEFAULT_BASE_URL
  ).replace(/\/+$/, '');

  // The bearer key is attached to every request, so an attacker-controlled
  // --base-url would exfiltrate it. Only trusted hosts are allowed silently;
  // anything else must be opted into with --allow-untrusted-host.
  if (!opts.allowUntrustedHost && !isTrustedActionsHost(baseUrl)) {
    throw new Error(
      `Refusing to send the API key to ${baseUrl} — it is not a computesdk.com or localhost host. ` +
        'If this is a self-hosted/dev deployment you trust, pass --allow-untrusted-host.',
    );
  }
  return { apiKey, baseUrl };
}

/** computesdk.com (and subdomains) or localhost — safe to receive the API key. */
export function isTrustedActionsHost(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  return (
    host === 'computesdk.com' ||
    host.endsWith('.computesdk.com') ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1'
  );
}
