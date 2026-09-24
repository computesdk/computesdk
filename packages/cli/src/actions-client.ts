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
  /** `provider[:region]` the dispatch pinned this run to, else null. */
  providerOverride?: string | null;
  jobs: CiJob[];
  logTail: string[];
}

/**
 * One job of `GET /api/v1/actions/runs/{id}/state`: the live fields plus the
 * context that decided how the job ran — resolved runner image, container
 * pin, concurrency group, timeout/fetch-depth overrides.
 */
export interface CiJobInspection {
  id: string;
  name: string;
  state: CiJobState;
  provider: string | null;
  region: string | null;
  sandboxId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  placementAttempts: CiPlacementAttempt[];
  /** Why the platform failed the job before steps ran, when it did. */
  failureReason: string | null;
  /** The `runs-on:` labels as declared. */
  runsOn: string[];
  /** The `computesdk:` placement pin the labels carried, when one did. */
  placementHint: { provider: string; region: string | null; label: string } | null;
  /** Labels act actually read (placement labels stripped, default substituted). */
  resolvedRunsOn: string[] | null;
  runsOnHasExpression: boolean;
  /** The image the job's steps ran in: container pin, else the mapped label. */
  runnerImage: string | null;
  /** The literal `container:` image the job declared, if any. */
  container: string | null;
  timeoutMinutes: number | null;
  /** Deepest `fetch-depth` a checkout step pinned (0 = full history). */
  fetchDepth: number | null;
  concurrencyGroup: string | null;
  concurrencyCancelInProgress: boolean;
  matrix: Record<string, string> | null;
  steps: {
    ordinal: number;
    name: string;
    state: CiJobState;
    exitCode: number | null;
    startedAt: string | null;
    finishedAt: string | null;
  }[];
}

/** A cache entry the run's window touched (saved or restored). */
export interface CiRunCacheTouch {
  key: string;
  version: string;
  scopeRef: string;
  sizeBytes: number;
  savedAt: string | null;
  restoredAt: string | null;
}

/** `GET /api/v1/actions/runs/{id}/state` — a run plus its effective context. */
export interface CiRunInspection {
  id: string;
  conclusion: CiConclusion;
  runNumber: number | null;
  ref: string;
  headSha: string;
  event: string;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  supersededByRunId: string | null;
  cancellationReason: string | null;
  /** Why the run was refused before placement, when it was. */
  blockedReason: string | null;
  concurrencyGroup: string | null;
  dispatchInputs: Record<string, string> | null;
  providerOverride: string | null;
  /** The commit the stored workflow definition was parsed from. */
  workflowParsedFromSha: string | null;
  /**
   * True when the stored parse came from a different commit than the run's
   * head — the definition-derived fields may then describe a newer workflow
   * than the run used (a fork pull request always shows this by design).
   */
  definitionStale: boolean;
  /** Secret *names* the jobs could reference — never values. */
  secrets: {
    access: 'declared' | 'all';
    /** Whether named secrets are also exported as job env vars. */
    env: boolean;
    names: string[];
  } | null;
  caches: CiRunCacheTouch[];
  jobs: CiJobInspection[];
}

/**
 * `GET /api/v1/actions/runs/{runId}/summary` — a run's failure digest.
 * Wire shape mirrors `CiRunSummary` in benchmarks-platform `lib/ci/run-summary.ts`.
 */
export interface CiRunSummaryJob {
  id: string;
  name: string;
  conclusion: CiJobState;
  provider: string | null;
  region: string | null;
}

export interface CiRunSummaryFailedStep {
  ordinal: number;
  name: string;
  exitCode: number | null;
}

export interface CiRunSummaryFailure extends CiRunSummaryJob {
  failureReason: string | null;
  failedSteps: CiRunSummaryFailedStep[];
  excerpt: {
    stepOrdinal: number | null;
    text: string;
    truncated: boolean;
  } | null;
}

export interface CiRunSummary {
  runId: string;
  conclusion: CiConclusion;
  jobs: CiRunSummaryJob[];
  failures: CiRunSummaryFailure[];
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

export interface CiProviderInfo {
  provider: string;
  /** Selectable regions for `provider:region` order entries; empty when unknown. */
  regions: string[];
  credential: 'ambient' | 'configured' | 'not-configured';
  /** In the effective act set: built-ins, CI_ACT_PROVIDERS override, act-probe-verified keys. */
  actCapable: boolean;
  /** A placement reaching the provider finds credentials. */
  usable: boolean;
  /** 1-based position in the effective provider order, null when absent. */
  position: number | null;
}

export interface CiProvidersResponse {
  providerOrder: string[];
  providers: CiProviderInfo[];
}

/** A saved provider credential — never carries key material, only the hint. */
export interface CiProviderKeyRecord {
  provider: string;
  keyHint: string;
  lastCheckedAt: string | null;
  status: 'connected' | 'error' | 'unconfigured';
  statusDetail: string | null;
  actCapable: boolean;
  credential: 'key';
  fields: unknown[];
}

export interface CiProviderKeyResponse {
  key: CiProviderKeyRecord;
  /** Present on the verify response. */
  verified?: boolean;
}

/** One failed job inside a run-history entry — step is the first failed step. */
export interface CiRunJobFailure {
  job: string;
  workflowJobId: string | null;
  step: string | null;
  stepOrdinal: number | null;
}

export interface CiRunHistoryEntry {
  id: string;
  ref: string;
  headSha: string;
  runNumber: number | null;
  conclusion: CiConclusion;
  startedAt: string;
  failedJobs: CiRunJobFailure[];
}

export interface CiJobHistory {
  job: string;
  /** The workflow job key, when recorded; disambiguates same-named jobs. */
  workflowJobId: string | null;
  /** Runs in the window that contained this job. */
  runs: number;
  failedRuns: number;
  /** Runs where the job failed with no step blamed (platform failures). */
  failedBeforeSteps: number;
  steps: { step: string; ordinal: number; failedRuns: number }[];
}

/** `GET /api/v1/actions/history` — the window plus the rollup over it. */
export interface CiRunHistory {
  runCount: number;
  conclusions: Partial<Record<CiConclusion, number>>;
  jobs: CiJobHistory[];
  runs: CiRunHistoryEntry[];
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

  async put<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.auth.baseUrl}${path}`, {
      method: 'PUT',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.parse<T>(res);
  }

  async del<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.auth.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.headers(),
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
  // `||` not `??`: empty-string env vars (common in CI matrices) should fall
  // through to the next source, not count as configured.
  const apiKey =
    opts.apiKey ||
    process.env.COMPUTE_API_KEY ||
    process.env.BENCHMARKS_PLATFORM_API_KEY; // legacy name
  if (!apiKey) {
    throw new Error(
      'No API key. Set COMPUTE_API_KEY or pass --api-key.',
    );
  }
  const baseUrl = (
    opts.baseUrl ||
    process.env.COMPUTE_PLATFORM_URL ||
    process.env.BENCHMARKS_PLATFORM_URL || // legacy name
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
