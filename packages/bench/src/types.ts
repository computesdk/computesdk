export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface BenchmarkClientConfig {
  /** API base URL. Defaults to https://platform.computesdk.com/api/v1. */
  baseUrl?: string;
  /** Bearer token. Defaults to process.env.COMPUTESDK_ADMIN_API_KEY, then process.env.COMPUTESDK_API_KEY. */
  apiKey?: string;
  /** Custom fetch implementation, mostly useful for tests. */
  fetch?: typeof fetch;
}

export interface BenchmarkResource {
  id: string;
  slug: string;
  name: string;
  kind?: string | null;
  status?: string;
  config?: JsonObject;
  defaultRunConfig?: JsonObject;
}

export type BenchmarkRunStatus = 'planned' | 'in_progress' | 'completed' | 'failed';
export type BenchmarkWorkerStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface BenchmarkRun {
  id: string;
  benchmarkId: string;
  name?: string | null;
  status: BenchmarkRunStatus | string;
  totalTasks: number;
  workerCount: number;
  config?: JsonObject;
  createdAt?: string;
  updatedAt?: string;
}

export interface BenchmarkParticipant {
  id: string;
  benchmarkId: string;
  runId: string;
  slug: string;
  label?: string | null;
  provider?: string | null;
  status: BenchmarkRunStatus | string;
  totalTasks: number;
  workerCount: number;
  config?: JsonObject;
}

export interface BenchmarkRunWorker {
  id: string;
  benchmarkId: string;
  runId: string;
  participantId: string;
  workerIndex: number;
  workerCount: number;
  taskIndexStart: number;
  taskIndexEnd: number;
  targetConcurrency: number;
  status: BenchmarkWorkerStatus | string;
  progressDone?: number;
  progressInFlight?: number;
  progressErrors?: number;
  progressTotal?: number;
  currentStep?: string | null;
  concurrency?: WorkerConcurrencySample[];
}

export interface BenchmarkWorkerAttempt {
  id: string;
  benchmarkId: string;
  runId: string;
  participantId: string;
  workerId: string;
  attemptNumber: number;
  status: string;
}

export interface BenchmarkAssignment {
  benchmarkId: string;
  benchmarkSlug: string;
  runId: string;
  participantId: string;
  participantSlug: string;
  provider?: string | null;
  workerId: string;
  workerIndex: number;
  workerCount: number;
  attemptId: string;
  attemptNumber: number;
  taskRange: {
    start: number;
    end: number;
    count: number;
  };
  targetConcurrency: number;
  config?: JsonObject;
}

export interface UpsertBenchmarkInput {
  name: string;
  kind?: string;
  status?: string;
  config?: JsonObject;
  defaultRunConfig?: JsonObject;
}

export interface UpdateBenchmarkInput {
  name?: string;
  kind?: string;
  status?: string;
  config?: JsonObject;
  defaultRunConfig?: JsonObject;
}

export interface CreateRunInput {
  name?: string;
  totalTasks: number;
  workerCount: number;
  participants?: string[];
  config?: JsonObject;
}

export interface UpdateRunInput {
  name?: string;
  status?: BenchmarkRunStatus;
  config?: JsonObject;
}

export interface UpsertParticipantInput {
  label?: string;
  provider?: string;
  status?: string;
  totalTasks?: number;
  workerCount?: number;
  config?: JsonObject;
}

export type UpdateParticipantInput = UpsertParticipantInput;

export interface UpdateWorkerInput {
  status?: BenchmarkWorkerStatus;
  progressDone?: number;
  progressInFlight?: number;
  progressErrors?: number;
  progressTotal?: number;
}

export interface ClaimWorkerInput {
  processKind?: string;
  processKey?: string;
}

export interface PlanWorkersInput {
  workerCount?: number;
  targetConcurrency?: number;
  config?: JsonObject;
}

export interface TaskResultRecord {
  taskIndex: number;
  status: string;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  firstCommandMs?: number | null;
  errorCode?: string | null;
  steps?: TaskStepRecord[];
  data?: JsonObject;
}

export interface TaskStepRecord {
  name: string;
  status: 'success' | 'error';
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  errorCode?: string | null;
  data?: JsonObject;
}

export interface SendTaskResultsInput {
  benchmarkSlug: string;
  runId: string;
  workerId: string;
  attemptId: string;
  sequenceNumber: number;
  isFinal: boolean;
  records: TaskResultRecord[];
}

export interface TaskResultsResponse {
  accepted?: number;
  eventBatchId?: string;
  queued?: boolean;
  eventBatch?: unknown;
  duplicate?: boolean;
  queueMessageId?: string;
}

export interface CreateWorkerArtifactInput {
  attemptId: string;
  kind: string;
  contentType?: string;
  name?: string;
  metadata?: JsonObject;
}

export interface BenchmarkArtifact {
  id?: string;
  artifactId?: string;
  benchmarkId?: string;
  runId?: string;
  participantId?: string;
  participantSlug?: string;
  workerId?: string;
  attemptId?: string;
  kind: string;
  name?: string | null;
  contentType?: string | null;
  objectKey?: string;
  uploadUrl?: string;
  metadata?: JsonObject;
  createdAt?: string;
}

export interface CreateWorkerArtifactResponse {
  artifact?: BenchmarkArtifact;
  artifactId?: string;
  uploadUrl?: string;
  objectKey?: string;
}

export interface BenchmarkResultLatencySummary {
  min: number | null;
  avg: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}

export interface BenchmarkResultSummary {
  taskCount: number;
  successCount: number;
  errorCount: number;
  otherCount: number;
  latencyCount: number;
  successRate: number;
  latencyMs: BenchmarkResultLatencySummary;
  firstStartedAt: string | null;
  lastCompletedAt: string | null;
}

export interface BenchmarkParticipantResultSummary extends BenchmarkResultSummary {
  participantSlug: string;
  provider: string | null;
}

export interface BenchmarkStepResultSummary {
  participantSlug: string;
  provider: string | null;
  stepName: string;
  stepCount: number;
  successCount: number;
  errorCount: number;
  otherCount: number;
  latencyCount: number;
  successRate: number;
  latencyMs: BenchmarkResultLatencySummary;
}

export interface BenchmarkResultsOverviewInput {
  limit?: number;
}

export type BenchmarkAnalyticsReadiness = 'ready' | 'pending' | 'unavailable' | 'failed';

export interface BenchmarkRunAnalyticsSummary {
  status: BenchmarkAnalyticsReadiness;
  eventBatches: number;
  persisted: number;
  queued: number;
  failed: number;
  imports: {
    pending: number;
    importing: number;
    imported: number;
    failed: number;
    missing: number;
  };
}

export interface BenchmarkResultsOverviewAnalytics {
  status: BenchmarkAnalyticsReadiness;
  query: 'available' | 'unavailable';
  error?: string;
}

export interface BenchmarkResultsOverviewRun {
  run: BenchmarkRun;
  analytics: BenchmarkRunAnalyticsSummary;
  participants: Array<BenchmarkParticipantResultSummary & { runId: string }>;
}

export interface BenchmarkResultsOverview {
  benchmark: Pick<BenchmarkResource, 'id' | 'slug' | 'name' | 'kind'>;
  generatedAt: string;
  analytics: BenchmarkResultsOverviewAnalytics;
  items: BenchmarkResultsOverviewRun[];
}

export interface BenchmarkRunResults {
  benchmark: Pick<BenchmarkResource, 'id' | 'slug' | 'name' | 'kind'>;
  run: Pick<BenchmarkRun, 'id' | 'status' | 'totalTasks' | 'workerCount'>;
  generatedAt: string;
  overall: BenchmarkResultSummary;
  participants: BenchmarkParticipantResultSummary[];
  steps: BenchmarkStepResultSummary[];
}

export interface BenchmarkRunTaskResultsInput {
  bucketSize?: number;
  failureLimit?: number;
}

export interface BenchmarkTaskBucket {
  participantSlug: string;
  provider: string | null;
  bucketStart: number;
  bucketEnd: number;
  taskIndexMidpoint: number;
  taskCount: number;
  successCount: number;
  errorCount: number;
  latencyMs: Pick<BenchmarkResultLatencySummary, 'p50' | 'p95' | 'max'>;
}

export interface BenchmarkFailurePoint {
  participantSlug: string;
  provider: string | null;
  taskIndex: number;
  errorCode: string | null;
}

export interface BenchmarkRunTaskResults {
  run: { id: string };
  generatedAt: string;
  bucketSize: number;
  buckets: BenchmarkTaskBucket[];
  failures: BenchmarkFailurePoint[];
}

export interface BenchmarkRunTimelineInput {
  bucketMs?: number;
}

export interface BenchmarkEventRateBucket {
  participantSlug: string;
  provider: string | null;
  tMs: number;
  completed: number;
  succeeded: number;
  failed: number;
}

export interface BenchmarkConcurrencyPoint {
  participantSlug: string;
  provider: string | null;
  workerId: string;
  recordedAt: string;
  tMs: number;
  step: string;
  active: number;
  target: number;
}

export interface BenchmarkRunTimeline {
  run: { id: string };
  generatedAt: string;
  eventRate: {
    bucketMs: number;
    buckets: BenchmarkEventRateBucket[];
  };
  concurrency: {
    firstRecordedAt: string | null;
    heartbeatCount: number;
    points: BenchmarkConcurrencyPoint[];
  };
}

export interface BenchmarkRunImportsSummary {
  eventBatches: number;
  persisted: number;
  queued: number;
  failed: number;
  imports: {
    pending: number;
    importing: number;
    imported: number;
    failed: number;
    missing: number;
  };
}

export interface BenchmarkRunImportItem {
  eventBatchId: string;
  batchType: string;
  sequenceNumber: number;
  batchStatus: string;
  eventCount: number;
  objectKey: string | null;
  batchErrorMessage: string | null;
  createdAt: string;
  persistedAt: string | null;
  sink: string | null;
  importStatus: string | null;
  importAttempts: number | null;
  importedAt: string | null;
  failedAt: string | null;
  importErrorMessage: string | null;
}

export interface BenchmarkRunImports {
  run: { id: string };
  generatedAt: string;
  summary: BenchmarkRunImportsSummary;
  items: BenchmarkRunImportItem[];
}

export interface WorkerConcurrencySample {
  step: string;
  active: number;
  target: number;
}

export interface WorkerHeartbeatInput {
  attemptId: string;
  progressDone?: number;
  progressInFlight?: number;
  progressErrors?: number;
  progressTotal?: number;
  currentStep?: string | null;
  concurrency?: WorkerConcurrencySample[];
}

export interface RunProgressConcurrency {
  step: string;
  active: number;
  target: number;
  ready: boolean;
  freshWorkerCount: number;
}

export type RunProgressStatus = 'planned' | 'in_progress' | 'completed' | 'failed';

export interface RunProgressWorkerCounts {
  pending: number;
  running: number;
  completed: number;
  failed: number;
  stale: number;
  total: number;
}

export interface RunProgressTaskCounts {
  done: number;
  inFlight: number;
  errors: number;
  total: number;
  completionRatio: number;
}

export interface RunProgressParticipantCounts {
  planned: number;
  inProgress: number;
  completed: number;
  failed: number;
  total: number;
}

export interface RunProgressSummary {
  status: RunProgressStatus;
  started: boolean;
  completed: boolean;
  participants: RunProgressParticipantCounts;
}

export interface RunProgressParticipant {
  id: string;
  slug: string;
  provider?: string | null;
  status: RunProgressStatus;
  totalTasks: number;
  workerCount: number;
  workers: RunProgressWorkerCounts;
  tasks: RunProgressTaskCounts;
  concurrency: RunProgressConcurrency[];
}

export interface RunProgress {
  run: {
    id: string;
    status: string;
    totalTasks: number;
    workerCount: number;
  };
  summary: RunProgressSummary;
  freshnessWindowSeconds: number;
  generatedAt: string;
  participants: RunProgressParticipant[];
}

export interface RunWorkerContext {
  assignment: BenchmarkAssignment;
  taskIndex: number;
  step<T>(name: string, fn: () => Promise<T> | T, options?: DefineStepOptions): Promise<T>;
}

export interface StepContext<TState extends Record<string, unknown> = Record<string, unknown>> {
  assignment: BenchmarkAssignment;
  taskIndex: number;
  state: TState;
}

export interface DefineStepOptions {
  /** Report this step as active in heartbeat concurrency samples. Defaults to true. */
  reportConcurrency?: boolean;
  /** Per-worker target for this step. Defaults to worker concurrency/assignment target. */
  concurrency?: number;
  /** Readiness coordination mode. Defaults to internal. */
  readiness?: 'poll' | 'internal';
  /** Poll interval while waiting for readiness. Defaults to 1000ms. */
  readyPollIntervalMs?: number;
  /** Maximum time to wait for readiness. Defaults to no timeout. */
  readyTimeoutMs?: number;
}

export interface DefinedStep<TState extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  options?: DefineStepOptions;
  fn: (context: StepContext<TState>) => Promise<JsonObject | void> | JsonObject | void;
}

export interface DefinedTask<TState extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  steps: DefinedStep<TState>[];
}

export type TaskFunction = (context: RunWorkerContext) => Promise<JsonObject | void> | JsonObject | void;
export type WorkerTask = DefinedTask | TaskFunction;

export interface RunWorkerResult {
  assignment: BenchmarkAssignment | null;
  records: TaskResultRecord[];
}

export interface RunWorkerOptions {
  benchmarkSlug: string;
  runId: string;
  participantSlug: string;
  processKind?: string;
  processKey?: string;
  concurrency?: number;
  batchSize?: number;
  heartbeatIntervalMs?: number;
  readyPollIntervalMs?: number;
  onResult?: (record: TaskResultRecord) => void;
  task: WorkerTask;
}

export interface WorkerDefaults {
  concurrency?: number;
  batchSize?: number;
  heartbeatIntervalMs?: number;
  readyPollIntervalMs?: number;
}

export interface DefineWorkerOptions extends WorkerDefaults {
  benchmarkSlug: string;
  runId: string;
  participantSlug: string;
  processKind?: string;
  processKey?: string;
  client?: BenchmarkClient;
  task: WorkerTask;
}

export interface BenchmarkWorker {
  run(overrides?: Partial<WorkerDefaults>): Promise<RunWorkerResult>;
}

export interface DefineBenchOptions extends WorkerDefaults {
  slug: string;
  participantSlug?: string;
  client?: BenchmarkClient;
  task: WorkerTask;
}

export interface BenchDefinition {
  slug: string;
  task: WorkerTask;
  defineWorker(options: Omit<DefineWorkerOptions, 'benchmarkSlug' | 'client' | 'task' | 'participantSlug'> & {
    client?: BenchmarkClient;
    participantSlug?: string;
    task?: WorkerTask;
  }): BenchmarkWorker;
}

export interface BenchmarkClient {
  upsertBenchmark(slug: string, input: UpsertBenchmarkInput): Promise<BenchmarkResource>;
  updateBenchmark(slug: string, input: UpdateBenchmarkInput): Promise<BenchmarkResource>;
  getBenchmark(slug: string): Promise<BenchmarkResource>;
  listBenchmarks(): Promise<BenchmarkResource[]>;
  createRun(benchmarkSlug: string, input: CreateRunInput): Promise<{
    run: BenchmarkRun;
    participants: BenchmarkParticipant[];
  }>;
  listRuns(benchmarkSlug: string): Promise<BenchmarkRun[]>;
  getRun(benchmarkSlug: string, runId: string): Promise<BenchmarkRun>;
  updateRun(benchmarkSlug: string, runId: string, input: UpdateRunInput): Promise<BenchmarkRun>;
  upsertParticipant(
    benchmarkSlug: string,
    runId: string,
    participantSlug: string,
    input?: UpsertParticipantInput,
  ): Promise<BenchmarkParticipant>;
  updateParticipant(
    benchmarkSlug: string,
    runId: string,
    participantSlug: string,
    input: UpdateParticipantInput,
  ): Promise<BenchmarkParticipant>;
  listParticipants(benchmarkSlug: string, runId: string): Promise<BenchmarkParticipant[]>;
  getParticipant(
    benchmarkSlug: string,
    runId: string,
    participantSlug: string,
  ): Promise<BenchmarkParticipant>;
  listWorkers(
    benchmarkSlug: string,
    runId: string,
    participantSlug: string,
  ): Promise<BenchmarkRunWorker[]>;
  planWorkers(
    benchmarkSlug: string,
    runId: string,
    participantSlug: string,
    input?: PlanWorkersInput,
  ): Promise<BenchmarkRunWorker[]>;
  getWorker(benchmarkSlug: string, runId: string, workerId: string): Promise<BenchmarkRunWorker>;
  updateWorker(
    benchmarkSlug: string,
    runId: string,
    workerId: string,
    input: UpdateWorkerInput,
  ): Promise<BenchmarkRunWorker>;
  getRunProgress(benchmarkSlug: string, runId: string): Promise<RunProgress>;
  claimWorker(
    benchmarkSlug: string,
    runId: string,
    participantSlug: string,
    input?: ClaimWorkerInput,
  ): Promise<BenchmarkAssignment | null>;
  releaseWorker(benchmarkSlug: string, runId: string, workerId: string, attemptId: string): Promise<{
    worker: BenchmarkRunWorker;
    attempt: BenchmarkWorkerAttempt;
  }>;
  sendTaskResults(input: SendTaskResultsInput): Promise<TaskResultsResponse>;
  heartbeatWorker(benchmarkSlug: string, runId: string, workerId: string, input: WorkerHeartbeatInput): Promise<{
    worker: BenchmarkRunWorker;
    attempt: BenchmarkWorkerAttempt;
  }>;
  completeWorker(benchmarkSlug: string, runId: string, workerId: string, attemptId: string): Promise<{
    worker: BenchmarkRunWorker;
    attempt: BenchmarkWorkerAttempt;
  }>;
  failWorker(
    benchmarkSlug: string,
    runId: string,
    workerId: string,
    attemptId: string,
    error?: unknown,
  ): Promise<{ worker: BenchmarkRunWorker; attempt: BenchmarkWorkerAttempt }>;
  createWorkerArtifact(
    benchmarkSlug: string,
    runId: string,
    workerId: string,
    input: CreateWorkerArtifactInput,
  ): Promise<CreateWorkerArtifactResponse>;
  listRunArtifacts(benchmarkSlug: string, runId: string): Promise<BenchmarkArtifact[]>;
  listWorkerArtifacts(benchmarkSlug: string, runId: string, workerId: string): Promise<BenchmarkArtifact[]>;
  getBenchmarkResults(benchmarkSlug: string, input?: BenchmarkResultsOverviewInput): Promise<BenchmarkResultsOverview>;
  getRunResults(benchmarkSlug: string, runId: string): Promise<BenchmarkRunResults>;
  getRunTaskResults(
    benchmarkSlug: string,
    runId: string,
    input?: BenchmarkRunTaskResultsInput,
  ): Promise<BenchmarkRunTaskResults>;
  getRunTimeline(
    benchmarkSlug: string,
    runId: string,
    input?: BenchmarkRunTimelineInput,
  ): Promise<BenchmarkRunTimeline>;
  getRunImports(benchmarkSlug: string, runId: string): Promise<BenchmarkRunImports>;
  runWorker(options: RunWorkerOptions): Promise<RunWorkerResult>;
}
