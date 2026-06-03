export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface BenchmarkClientConfig {
  /** API base URL. Defaults to https://platform.computesdk.com/api/v1. */
  baseUrl?: string;
  /** Bearer token. Defaults to process.env.COMPUTESDK_API_KEY. */
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

export interface BenchmarkRun {
  id: string;
  benchmarkId: string;
  name?: string | null;
  status: string;
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
  status: string;
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
  status: string;
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

export interface CreateRunInput {
  name?: string;
  totalTasks: number;
  workerCount: number;
  participants?: string[];
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
  startedAt: string;
  completedAt: string;
  latencyMs: number;
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
  eventBatch?: unknown;
  duplicate?: boolean;
  queueMessageId?: string;
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
  currentStep?: string;
  concurrency?: WorkerConcurrencySample[];
}

export interface RunProgressConcurrency {
  step: string;
  active: number;
  target: number;
  ready: boolean;
  freshWorkerCount: number;
}

export interface RunProgressParticipant {
  id: string;
  slug: string;
  provider?: string | null;
  totalTasks: number;
  workerCount: number;
  concurrency: RunProgressConcurrency[];
}

export interface RunProgress {
  run: {
    id: string;
    status: string;
    totalTasks: number;
    workerCount: number;
  };
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
  getBenchmark(slug: string): Promise<BenchmarkResource>;
  listBenchmarks(): Promise<BenchmarkResource[]>;
  createRun(benchmarkSlug: string, input: CreateRunInput): Promise<{
    run: BenchmarkRun;
    participants: BenchmarkParticipant[];
  }>;
  listRuns(benchmarkSlug: string): Promise<BenchmarkRun[]>;
  getRun(benchmarkSlug: string, runId: string): Promise<BenchmarkRun>;
  upsertParticipant(
    benchmarkSlug: string,
    runId: string,
    participantSlug: string,
    input?: UpsertParticipantInput,
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
  getRunProgress(benchmarkSlug: string, runId: string): Promise<RunProgress>;
  claimWorker(
    benchmarkSlug: string,
    runId: string,
    participantSlug: string,
    input?: ClaimWorkerInput,
  ): Promise<BenchmarkAssignment | null>;
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
  runWorker(options: RunWorkerOptions): Promise<RunWorkerResult>;
}
