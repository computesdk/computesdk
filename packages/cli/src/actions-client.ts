/**
 * The platform transport moved to `@computesdk/platform` in cli 2.x — this
 * file re-exports the moved names under their old `Actions*` names for one
 * release, keeps the Actions wire types, and defines `ActionsClient` as the
 * `PlatformClient` subclass with the Actions `org()` endpoint.
 * Types mirror the wire shapes in benchmarks-platform `lib/ci/types.ts` —
 * keep them in sync by hand; the API is the contract.
 */
import {
  DEFAULT_BASE_URL,
  PlatformApiError,
  PlatformClient,
  PlatformClientError,
  codeForStatus,
  errorDetails,
  isSecurePlatformTransport,
  isTrustedPlatformHost,
  readSseEvents,
  readSseNamedEvents,
  resolvePlatformAuth,
  toErrorEnvelope,
} from '@computesdk/platform';
import type {
  PlatformAuth,
  PlatformClientErrorCode,
  PlatformErrorEnvelope,
  StoredPlatformAuth,
  StoredPlatformAuthResolver,
} from '@computesdk/platform';

export {
  DEFAULT_BASE_URL,
  PlatformApiError as ActionsApiError,
  PlatformClientError as ActionsCliError,
  codeForStatus,
  errorDetails,
  isSecurePlatformTransport as isSecureActionsTransport,
  isTrustedPlatformHost as isTrustedActionsHost,
  readSseEvents,
  readSseNamedEvents,
  toErrorEnvelope,
};

const CLI_CREDENTIALS_HINT =
  'Set COMPUTE_API_KEY, pass --api-key, or run `compute login`.';

/** `resolvePlatformAuth` with the CLI's flag-style credentials hint. */
export function resolveActionsAuth(
  opts: Parameters<typeof resolvePlatformAuth>[0],
  resolveStored?: StoredPlatformAuthResolver,
): Promise<PlatformAuth> {
  return resolvePlatformAuth(opts, resolveStored, CLI_CREDENTIALS_HINT);
}
export type {
  PlatformAuth as ActionsAuth,
  PlatformClientErrorCode as ActionsCliErrorCode,
  PlatformErrorEnvelope as ActionsErrorEnvelope,
  StoredPlatformAuth,
  StoredPlatformAuthResolver,
};

export interface ActionsOrg {
  organizationId: string;
  name: string;
  slug: string;
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
  /**
   * Benchmark runs this run produced (linked by `benchmark_run_executions.ci_run_id`).
   * `[]` when the workflow ran no benchmark; a benchmark still running is listed
   * with `providers: []` until its summary is uploaded.
   */
  benchmarks?: CiRunBenchmarkResult[];
}

/** One benchmark run linked to an Actions run, from `GET /api/v1/actions/runs/{id}`. */
export interface CiRunBenchmarkResult {
  benchmarkSlug: string;
  benchmarkName: string;
  benchmarkRunId: string;
  status: string;
  dashboardUrl: string;
  startedAt: string | null;
  endedAt: string | null;
  providers: CiRunBenchmarkProvider[];
}

/** One provider row of a benchmark result; `dimensions: {}` is the provider's overall row. */
export interface CiRunBenchmarkProvider {
  provider: string;
  dimensions: Record<string, unknown>;
  compositeScore: number | null;
  scoringVersion: string | null;
  successRate: number | null;
  skipped: boolean;
  skipReason: string | null;
  metrics: Record<string, { median: number; p95: number; p99: number; unit: string }>;
  scalars: Record<string, number>;
  scalarUnits: Record<string, string>;
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


/**
 * One row of `GET /api/v1/actions/repos`: a repo the org can run CI on,
 * GitHub-App-granted or a generic git remote.
 */
export interface CiRepo {
  repoId: string;
  fullName: string;
  defaultBranch: string;
  enabled: boolean;
  private: boolean;
  forkPullRequests: boolean;
  /** `github_app` for App-granted repos; `none`/`token`/`basic`/`ssh` for remotes. */
  authType: string;
  cloneUrl: string | null;
  githubInstallationId: number | null;
  workflowPaths: string[];
  disabledWorkflowCount: number;
  lastPolledAt: string | null;
  lastPollError: string | null;
}

export interface CiReposResponse {
  repos: CiRepo[];
}

/** What an enable/remote-connect discovered before answering. */
export interface CiRepoDiscovery {
  workflowsFound: boolean;
  seeded: boolean;
  error: string | null;
}

export interface CiRepoConnectResponse {
  repoId: string | null;
  fullName: string;
  defaultBranch: string;
  authType: string;
  discovery: CiRepoDiscovery;
}

/** `POST /api/v1/actions/repos/sync`: per-account result plus the refreshed repo list. */
export interface CiRepoSyncResponse {
  accounts: Array<{ account: string; error: string | null }>;
  repos: Array<Pick<CiRepo, 'repoId' | 'fullName' | 'enabled' | 'private' | 'authType' | 'githubInstallationId'>>;
}

export interface CiRepoPatchResponse {
  fullName: string;
  enabled?: boolean;
  forkPullRequests?: boolean;
  discovery: CiRepoDiscovery | null;
}

export type CiVaultKind = 'secret' | 'variable';

/** One row of `GET /api/v1/vault` — metadata only; values never list. */
export interface CiVaultItem {
  name: string;
  kind: CiVaultKind;
  description: string | null;
  revealable: boolean;
  labels: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Present when listing or writing with `?repo=`. */
  source?: 'organization' | 'repository';
  overridesOrganization?: boolean;
}

export interface CiVaultListResponse {
  items: CiVaultItem[];
}

export interface CiVaultSaveResponse {
  item: CiVaultItem;
}

export interface CiVaultRevealResponse {
  name: string;
  kind: CiVaultKind;
  value: string;
}

export interface CiVaultDeleteResponse {
  name: string;
  kind: CiVaultKind;
  deleted: true;
}

/**
 * The CLI's platform client — `PlatformClient` plus the Actions-only
 * `org()` endpoint the dashboard URL builders need.
 */
export class ActionsClient extends PlatformClient {
  private orgPromise: Promise<ActionsOrg> | null = null;

  /** The credential's org — fetched once, needed for dashboard URLs. */
  org(): Promise<ActionsOrg> {
    this.orgPromise ??= this.get<ActionsOrg>('/api/v1/actions/org');
    return this.orgPromise;
  }
}
