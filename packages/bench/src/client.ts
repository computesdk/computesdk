import type {
  BenchmarkAssignment,
  BenchmarkArtifact,
  BenchDefinition,
  BenchmarkClient,
  BenchmarkClientConfig,
  BenchmarkWorker,
  BenchmarkParticipant,
  BenchmarkResource,
  BenchmarkRun,
  BenchmarkResultsOverview,
  BenchmarkResultsOverviewInput,
  BenchmarkRunImports,
  BenchmarkRunResults,
  BenchmarkRunTaskResults,
  BenchmarkRunTaskResultsInput,
  BenchmarkRunTimeline,
  BenchmarkRunTimelineInput,
  BenchmarkRunWorker,
  BenchmarkWorkerAttempt,
  CreateWorkerArtifactInput,
  CreateWorkerArtifactResponse,
  ClaimWorkerInput,
  CreateRunInput,
  DefineBenchOptions,
  DefineStepOptions,
  DefineTaskOptions,
  DefinedStep,
  DefinedTask,
  DefineWorkerOptions,
  JsonObject,
  RunWorkerOptions,
  RunWorkerContext,
  RunWorkerResult,
  SendTaskResultsInput,
  PlanWorkersInput,
  TaskStepRecord,
  TaskResultRecord,
  TaskResultsResponse,
  RunProgress,
  UpdateBenchmarkInput,
  UpdateParticipantInput,
  UpdateRunInput,
  UpdateWorkerInput,
  UpsertBenchmarkInput,
  UpsertParticipantInput,
  UploadWorkerArtifactInput,
  WorkerConcurrencySample,
  WorkerHeartbeatInput,
} from './types';

const DEFAULT_BASE_URL = 'https://platform.computesdk.com/api/v1';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_READY_POLL_INTERVAL_MS = 1000;
const MAX_TASK_RESULT_RECORDS = 5000;
const MAX_TASK_RECORD_STEPS = 100;
const MAX_HEARTBEAT_CONCURRENCY_SAMPLES = 20;

export class BenchmarkApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'BenchmarkApiError';
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function encodePath(value: string): string {
  return encodeURIComponent(value);
}

function queryString(input: Record<string, number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const value = params.toString();
  return value ? `?${value}` : '';
}

function getApiKey(input?: string): string | undefined {
  return input ?? (typeof process !== 'undefined' ? process.env.COMPUTESDK_ADMIN_API_KEY ?? process.env.COMPUTESDK_API_KEY : undefined);
}

function getErrorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return 'ERROR';
}

function toJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function validateTaskResults(input: SendTaskResultsInput): void {
  if (input.records.length > MAX_TASK_RESULT_RECORDS) {
    throw new Error(`Benchmark task result batches are limited to ${MAX_TASK_RESULT_RECORDS} records.`);
  }

  for (const record of input.records) {
    if ((record.steps?.length ?? 0) > MAX_TASK_RECORD_STEPS) {
      throw new Error(`Benchmark task result records are limited to ${MAX_TASK_RECORD_STEPS} steps.`);
    }
  }
}

function validateHeartbeat(input: WorkerHeartbeatInput): void {
  const concurrency = input.concurrency ?? [];
  if (concurrency.length > MAX_HEARTBEAT_CONCURRENCY_SAMPLES) {
    throw new Error(`Benchmark heartbeat concurrency is limited to ${MAX_HEARTBEAT_CONCURRENCY_SAMPLES} samples.`);
  }

  const steps = new Set<string>();
  for (const sample of concurrency) {
    if (steps.has(sample.step)) {
      throw new Error(`Benchmark heartbeat concurrency step values must be unique per heartbeat.`);
    }
    steps.add(sample.step);
  }
}

function validatePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Benchmark ${name} must be a positive integer.`);
  }
}

function validateBatchSize(value: number): void {
  validatePositiveInteger('batchSize', value);
  if (value > MAX_TASK_RESULT_RECORDS) {
    throw new Error(`Benchmark batchSize must be at most ${MAX_TASK_RESULT_RECORDS}.`);
  }
}

function normalizeArtifacts(data: { items?: BenchmarkArtifact[]; artifacts?: BenchmarkArtifact[] }): BenchmarkArtifact[] {
  return data.items ?? data.artifacts ?? [];
}

function bodySizeBytes(body: UploadWorkerArtifactInput['body']): number | undefined {
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString()).byteLength;
  return undefined;
}

function isDefinedTask(task: RunWorkerOptions['task']): task is DefinedTask {
  return typeof task === 'object' && task !== null && Array.isArray(task.steps);
}

function mergeJsonObjects(target: JsonObject, source: JsonObject | void): void {
  if (!source) return;
  Object.assign(target, source);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWorkerTask(task: RunWorkerOptions['task'], context: RunWorkerContext): Promise<JsonObject | void> {
  if (!isDefinedTask(task)) {
    return task(context);
  }

  const state: Record<string, unknown> = {};
  const data: JsonObject = { taskName: task.name };
  try {
    for (const definedStep of task.steps) {
      const stepData = await context.step(
        definedStep.name,
        () => definedStep.fn({
          assignment: context.assignment,
          taskIndex: context.taskIndex,
          state,
        }),
        definedStep.options,
      );
      mergeJsonObjects(data, stepData);
    }
  } finally {
    await task.options?.cleanup?.({
      assignment: context.assignment,
      taskIndex: context.taskIndex,
      state,
    });
  }

  return data;
}

async function mapPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function createBenchmarkClient(config: BenchmarkClientConfig = {}): BenchmarkClient {
  const baseUrl = trimTrailingSlash(config.baseUrl ?? DEFAULT_BASE_URL);
  const apiKey = getApiKey(config.apiKey);
  const fetchImpl = config.fetch ?? (typeof fetch !== 'undefined' ? fetch : undefined);

  if (!fetchImpl) {
    throw new Error('fetch is not available');
  }
  const doFetch = fetchImpl;

  async function request<T>(method: string, path: string, body?: JsonObject): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();

    if (!response.ok) {
      throw new BenchmarkApiError(
        `Benchmark API request failed: ${response.status} ${response.statusText}`,
        response.status,
        text,
      );
    }

    return (text ? JSON.parse(text) : {}) as T;
  }

  async function sendTaskResults(input: SendTaskResultsInput): Promise<TaskResultsResponse> {
    if (input.records.length === 0) {
      return {};
    }
    validateTaskResults(input);

    return request<TaskResultsResponse>(
      'POST',
      `/benchmarks/${encodePath(input.benchmarkSlug)}/runs/${encodePath(input.runId)}/workers/${encodePath(input.workerId)}/events`,
      {
        type: 'task_results',
        attemptId: input.attemptId,
        sequenceNumber: input.sequenceNumber,
        isFinal: input.isFinal,
        records: input.records as unknown as JsonObject[],
      },
    );
  }

  async function updateWorkerLifecycle(
    action: 'heartbeat' | 'complete' | 'fail' | 'release',
    benchmarkSlug: string,
    runId: string,
    workerId: string,
    attemptId: string,
    extra?: JsonObject,
  ): Promise<{ worker: BenchmarkRunWorker; attempt: BenchmarkWorkerAttempt }> {
    return request<{ worker: BenchmarkRunWorker; attempt: BenchmarkWorkerAttempt }>(
      'POST',
      `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/workers/${encodePath(workerId)}/${action}`,
      { attemptId, ...(extra ?? {}) },
    );
  }

  const client: BenchmarkClient = {
    async upsertBenchmark(slug, input) {
      const data = await request<{ benchmark: BenchmarkResource }>('PUT', `/benchmarks/${encodePath(slug)}`, input as unknown as JsonObject);
      return data.benchmark;
    },

    async getBenchmark(slug) {
      const data = await request<{ benchmark: BenchmarkResource }>('GET', `/benchmarks/${encodePath(slug)}`);
      return data.benchmark;
    },

    async updateBenchmark(slug, input: UpdateBenchmarkInput) {
      const data = await request<{ benchmark: BenchmarkResource }>('PATCH', `/benchmarks/${encodePath(slug)}`, input as unknown as JsonObject);
      return data.benchmark;
    },

    async listBenchmarks() {
      const data = await request<{ items?: BenchmarkResource[]; benchmarks?: BenchmarkResource[] }>('GET', '/benchmarks');
      return data.items ?? data.benchmarks ?? [];
    },

    async createRun(benchmarkSlug, input) {
      return request<{ run: BenchmarkRun; participants: BenchmarkParticipant[] }>(
        'POST',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs`,
        input as unknown as JsonObject,
      );
    },

    async listRuns(benchmarkSlug) {
      const data = await request<{ items: BenchmarkRun[] }>('GET', `/benchmarks/${encodePath(benchmarkSlug)}/runs`);
      return data.items;
    },

    async getRun(benchmarkSlug, runId) {
      const data = await request<{ run: BenchmarkRun }>('GET', `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}`);
      return data.run;
    },

    async updateRun(benchmarkSlug, runId, input: UpdateRunInput) {
      const data = await request<{ run: BenchmarkRun }>(
        'PATCH',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}`,
        input as unknown as JsonObject,
      );
      return data.run;
    },

    async upsertParticipant(benchmarkSlug, runId, participantSlug, input = {}) {
      const data = await request<{ participant: BenchmarkParticipant }>(
        'PUT',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/participants/${encodePath(participantSlug)}`,
        input as JsonObject,
      );
      return data.participant;
    },

    async listParticipants(benchmarkSlug, runId) {
      const data = await request<{ items?: BenchmarkParticipant[]; participants?: BenchmarkParticipant[] }>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/participants`,
      );
      return data.items ?? data.participants ?? [];
    },

    async getParticipant(benchmarkSlug, runId, participantSlug) {
      const data = await request<{ participant: BenchmarkParticipant }>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/participants/${encodePath(participantSlug)}`,
      );
      return data.participant;
    },

    async updateParticipant(benchmarkSlug, runId, participantSlug, input: UpdateParticipantInput) {
      const data = await request<{ participant: BenchmarkParticipant }>(
        'PATCH',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/participants/${encodePath(participantSlug)}`,
        input as unknown as JsonObject,
      );
      return data.participant;
    },

    async getRunProgress(benchmarkSlug, runId) {
      return request<RunProgress>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/progress`,
      );
    },

    async listWorkers(benchmarkSlug, runId, participantSlug) {
      const data = await request<{ items?: BenchmarkRunWorker[]; workers?: BenchmarkRunWorker[] }>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/participants/${encodePath(participantSlug)}/workers`,
      );
      return data.items ?? data.workers ?? [];
    },

    async planWorkers(benchmarkSlug, runId, participantSlug, input: PlanWorkersInput = {}) {
      const data = await request<{ items?: BenchmarkRunWorker[]; workers?: BenchmarkRunWorker[] }>(
        'POST',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/participants/${encodePath(participantSlug)}/workers`,
        input as JsonObject,
      );
      return data.items ?? data.workers ?? [];
    },

    async getWorker(benchmarkSlug, runId, workerId) {
      const data = await request<{ worker: BenchmarkRunWorker }>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/workers/${encodePath(workerId)}`,
      );
      return data.worker;
    },

    async updateWorker(benchmarkSlug, runId, workerId, input: UpdateWorkerInput) {
      const data = await request<{ worker: BenchmarkRunWorker }>(
        'PATCH',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/workers/${encodePath(workerId)}`,
        input as unknown as JsonObject,
      );
      return data.worker;
    },

    async claimWorker(benchmarkSlug, runId, participantSlug, input: ClaimWorkerInput = {}) {
      const data = await request<{ assignment: BenchmarkAssignment | null }>(
        'POST',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/participants/${encodePath(participantSlug)}/workers/claim`,
        input as JsonObject,
      );
      return data.assignment;
    },

    sendTaskResults,

    async heartbeatWorker(benchmarkSlug, runId, workerId, input: WorkerHeartbeatInput) {
      validateHeartbeat(input);
      const { attemptId, ...extra } = input;
      if (extra.currentStep == null) {
        delete extra.currentStep;
      }
      return updateWorkerLifecycle('heartbeat', benchmarkSlug, runId, workerId, attemptId, extra as JsonObject);
    },

    releaseWorker(benchmarkSlug, runId, workerId, attemptId) {
      return updateWorkerLifecycle('release', benchmarkSlug, runId, workerId, attemptId);
    },

    completeWorker(benchmarkSlug, runId, workerId, attemptId) {
      return updateWorkerLifecycle('complete', benchmarkSlug, runId, workerId, attemptId);
    },

    failWorker(benchmarkSlug, runId, workerId, attemptId, error) {
      return updateWorkerLifecycle('fail', benchmarkSlug, runId, workerId, attemptId, {
        errorCode: getErrorCode(error),
        errorMessage: error instanceof Error ? error.message : String(error ?? 'Unknown error'),
      });
    },

    async createWorkerArtifact(benchmarkSlug, runId, workerId, input: CreateWorkerArtifactInput) {
      return request<CreateWorkerArtifactResponse>(
        'POST',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/workers/${encodePath(workerId)}/artifacts`,
        input as unknown as JsonObject,
      );
    },

    async uploadWorkerArtifact(benchmarkSlug, runId, workerId, input: UploadWorkerArtifactInput) {
      const sizeBytes = bodySizeBytes(input.body);
      const artifactInput: CreateWorkerArtifactInput = {
        attemptId: input.attemptId,
        kind: input.kind,
        contentType: input.contentType,
        name: input.name,
        metadata: sizeBytes === undefined ? input.metadata : { ...input.metadata, sizeBytes },
      };
      const response = await client.createWorkerArtifact(benchmarkSlug, runId, workerId, artifactInput);
      const uploadUrl = response.uploadUrl ?? response.artifact?.uploadUrl;
      if (!uploadUrl) {
        throw new Error('Benchmark artifact upload URL is missing.');
      }
      const uploadResponse = await doFetch(uploadUrl, {
        method: 'PUT',
        headers: input.contentType ? { 'Content-Type': input.contentType } : undefined,
        body: input.body,
      });
      if (!uploadResponse.ok) {
        const errorBody = await uploadResponse.text().catch(() => '');
        throw new BenchmarkApiError(
          `Benchmark artifact upload failed with ${uploadResponse.status}`,
          uploadResponse.status,
          errorBody,
        );
      }
      return response;
    },

    async listRunArtifacts(benchmarkSlug, runId) {
      const data = await request<{ items?: BenchmarkArtifact[]; artifacts?: BenchmarkArtifact[] }>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/artifacts`,
      );
      return normalizeArtifacts(data);
    },

    async listWorkerArtifacts(benchmarkSlug, runId, workerId) {
      const data = await request<{ items?: BenchmarkArtifact[]; artifacts?: BenchmarkArtifact[] }>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/workers/${encodePath(workerId)}/artifacts`,
      );
      return normalizeArtifacts(data);
    },

    async getBenchmarkResults(benchmarkSlug, input: BenchmarkResultsOverviewInput = {}) {
      return request<BenchmarkResultsOverview>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/results${queryString({ limit: input.limit })}`,
      );
    },

    async getRunResults(benchmarkSlug, runId) {
      return request<BenchmarkRunResults>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/results`,
      );
    },

    async getRunTaskResults(benchmarkSlug, runId, input: BenchmarkRunTaskResultsInput = {}) {
      return request<BenchmarkRunTaskResults>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/results/tasks${queryString({ bucketSize: input.bucketSize, failureLimit: input.failureLimit })}`,
      );
    },

    async getRunTimeline(benchmarkSlug, runId, input: BenchmarkRunTimelineInput = {}) {
      return request<BenchmarkRunTimeline>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/results/timeline${queryString({ bucketMs: input.bucketMs })}`,
      );
    },

    async getRunImports(benchmarkSlug, runId) {
      return request<BenchmarkRunImports>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/results/imports`,
      );
    },

    async runWorker(options: RunWorkerOptions): Promise<RunWorkerResult> {
      if (options.concurrency !== undefined) validatePositiveInteger('concurrency', options.concurrency);
      if (options.batchSize !== undefined) validateBatchSize(options.batchSize);

      const assignment = await client.claimWorker(options.benchmarkSlug, options.runId, options.participantSlug, {
        processKind: options.processKind,
        processKey: options.processKey,
      });
      if (!assignment) return { assignment: null, records: [] };
      const claimed = assignment;

      let sequenceNumber = 0;
      const records: TaskResultRecord[] = [];
      const pending: TaskResultRecord[] = [];
      const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
      const workerConcurrency = options.concurrency ?? claimed.targetConcurrency;
      validatePositiveInteger('concurrency', workerConcurrency);
      const taskIndices = Array.from({ length: claimed.taskRange.count }, (_, index) => claimed.taskRange.start + index);
      const activeByStep = new Map<string, number>();
      const targetByStep = new Map<string, number>();
      const readyWaitByStep = new Map<string, Promise<void>>();
      let doneCount = 0;
      let errorCount = 0;
      let inFlightCount = 0;
      let flushChain = Promise.resolve();

      function concurrencySamples(): WorkerConcurrencySample[] {
        return Array.from(activeByStep.entries())
          .filter(([, active]) => active > 0)
          .map(([step, active]) => ({
            step,
            active,
            target: targetByStep.get(step) ?? workerConcurrency,
          }))
          .sort((a, b) => b.active - a.active)
          .slice(0, MAX_HEARTBEAT_CONCURRENCY_SAMPLES);
      }

      async function sendHeartbeat(): Promise<void> {
        const concurrency = concurrencySamples();
        const step = concurrency[0]?.step ?? null;
        await client.heartbeatWorker(options.benchmarkSlug, options.runId, claimed.workerId, {
          attemptId: claimed.attemptId,
          progressDone: doneCount,
          progressInFlight: inFlightCount,
          progressErrors: errorCount,
          progressTotal: taskIndices.length,
          ...(step ? { currentStep: step } : {}),
          concurrency,
        });
      }

      let heartbeatInFlight: Promise<void> | null = null;
      let heartbeatRequested = false;

      function requestHeartbeat(): void {
        heartbeatRequested = true;
        if (heartbeatInFlight) return;

        heartbeatInFlight = (async () => {
          while (heartbeatRequested) {
            heartbeatRequested = false;
            await sendHeartbeat().catch(() => {});
          }
        })().finally(() => {
          heartbeatInFlight = null;
          if (heartbeatRequested) requestHeartbeat();
        });
      }

      async function pollStepReady(stepName: string, stepOptions: DefineStepOptions): Promise<void> {
        const startedAt = Date.now();
        const pollInterval = stepOptions.readyPollIntervalMs ?? options.readyPollIntervalMs ?? DEFAULT_READY_POLL_INTERVAL_MS;

        while (true) {
          const progress = await client.getRunProgress(options.benchmarkSlug, options.runId);
          const participant = progress.participants.find((item) => item.slug === options.participantSlug);
          const step = participant?.concurrency.find((item) => item.step === stepName);
          if (step?.ready) return;

          if (typeof stepOptions.readyTimeoutMs === 'number' && Date.now() - startedAt >= stepOptions.readyTimeoutMs) {
            throw new Error(`Timed out waiting for benchmark step "${stepName}" to become ready.`);
          }

          await sleep(pollInterval);
        }
      }

      async function waitForStepReady(stepName: string, stepOptions: DefineStepOptions): Promise<void> {
        const existing = readyWaitByStep.get(stepName);
        if (existing) return existing;

        const wait = pollStepReady(stepName, stepOptions).finally(() => {
          if (readyWaitByStep.get(stepName) === wait) readyWaitByStep.delete(stepName);
        });
        readyWaitByStep.set(stepName, wait);
        return wait;
      }

      const heartbeat = setInterval(() => {
        requestHeartbeat();
      }, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();

      async function flush(isFinal: boolean): Promise<void> {
        flushChain = flushChain.then(async () => {
          while (pending.length >= batchSize || (isFinal && pending.length > 0)) {
            const batch = pending.splice(0, batchSize);
            await sendTaskResults({
              benchmarkSlug: options.benchmarkSlug,
              runId: options.runId,
              workerId: claimed.workerId,
              attemptId: claimed.attemptId,
              sequenceNumber,
              isFinal: isFinal && pending.length === 0,
              records: batch,
            });
            sequenceNumber += 1;
          }
        });
        await flushChain;
      }

      try {
        await sendHeartbeat().catch(() => {});

        await mapPool(taskIndices, workerConcurrency, async (taskIndex) => {
          inFlightCount += 1;
          const startedAtDate = new Date();
          const startedAtMs = Date.now();
          const record: TaskResultRecord = {
            taskIndex,
            status: 'success',
            startedAt: startedAtDate.toISOString(),
          };
          const steps: TaskStepRecord[] = [];

          async function step<T>(name: string, fn: () => Promise<T> | T, stepOptions: DefineStepOptions = {}): Promise<T> {
            const stepStartedAtMs = Date.now();
            const stepRecord: TaskStepRecord = {
              name,
              status: 'success',
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              latencyMs: 0,
            };

            const shouldReportConcurrency = stepOptions.reportConcurrency ?? true;
            if (shouldReportConcurrency) {
              const stepConcurrency = stepOptions.concurrency ?? workerConcurrency;
              validatePositiveInteger(`step "${name}" concurrency`, stepConcurrency);
              targetByStep.set(name, stepConcurrency);
              activeByStep.set(name, (activeByStep.get(name) ?? 0) + 1);
              requestHeartbeat();
            }

            try {
              if (stepOptions.readiness === 'poll') {
                await waitForStepReady(name, stepOptions);
              }
              return await fn();
            } catch (error) {
              stepRecord.status = 'error';
              stepRecord.errorCode = getErrorCode(error);
              throw error;
            } finally {
              stepRecord.completedAt = new Date().toISOString();
              stepRecord.latencyMs = Date.now() - stepStartedAtMs;
              steps.push(stepRecord);
              if (shouldReportConcurrency) {
                const nextActive = Math.max(0, (activeByStep.get(name) ?? 0) - 1);
                if (nextActive === 0) {
                  activeByStep.delete(name);
                  targetByStep.delete(name);
                } else {
                  activeByStep.set(name, nextActive);
                }
                requestHeartbeat();
              }
            }
          }

          try {
            const data = await runWorkerTask(options.task, { assignment: claimed, taskIndex, step });
            record.data = toJsonObject(data);
          } catch (error) {
            record.status = 'error';
            record.errorCode = getErrorCode(error);
            record.data = { errorMessage: error instanceof Error ? error.message : String(error) };
          } finally {
            record.completedAt = new Date().toISOString();
            record.latencyMs = Date.now() - startedAtMs;
            record.steps = steps.length > 0 ? steps : undefined;
            doneCount += 1;
            inFlightCount = Math.max(0, inFlightCount - 1);
            if (record.status !== 'success') errorCount += 1;
          }

          records.push(record);
          pending.push(record);
          options.onResult?.(record);
          if (pending.length >= batchSize) await flush(false);
        });

        await flush(true);

        if (records.some((record) => record.status !== 'success')) {
          await client.failWorker(options.benchmarkSlug, options.runId, claimed.workerId, claimed.attemptId, new Error('One or more tasks failed'));
        } else {
          await client.completeWorker(options.benchmarkSlug, options.runId, claimed.workerId, claimed.attemptId);
        }

        return { assignment: claimed, records };
      } catch (error) {
        await flush(true).catch(() => {});
        await client.failWorker(options.benchmarkSlug, options.runId, claimed.workerId, claimed.attemptId, error).catch(() => {});
        throw error;
      } finally {
        clearInterval(heartbeat);
      }
    },
  };

  return client;
}

export async function runBenchmarkWorker(
  config: BenchmarkClientConfig,
  options: RunWorkerOptions,
): Promise<RunWorkerResult> {
  return createBenchmarkClient(config).runWorker(options);
}

export function defineStep<TState extends Record<string, unknown> = Record<string, unknown>>(
  name: string,
  optionsOrFn: DefineStepOptions | DefinedStep<TState>['fn'],
  maybeFn?: DefinedStep<TState>['fn'],
): DefinedStep<TState> {
  if (name.trim() === '') {
    throw new Error('Benchmark step name must be non-empty.');
  }
  const hasOptions = typeof optionsOrFn !== 'function';
  const fn = hasOptions ? maybeFn : optionsOrFn;
  if (!fn) {
    throw new Error('Benchmark step function is required.');
  }
  return { name, options: hasOptions ? optionsOrFn : undefined, fn };
}

export function defineTask<TState extends Record<string, unknown> = Record<string, unknown>>(
  name: string,
  steps: DefinedStep<TState>[],
  options?: DefineTaskOptions<TState>,
): DefinedTask<TState> {
  if (name.trim() === '') {
    throw new Error('Benchmark task name must be non-empty.');
  }
  if (steps.length === 0) {
    throw new Error('Benchmark task must define at least one step.');
  }
  const names = new Set<string>();
  for (const step of steps) {
    if (names.has(step.name)) {
      throw new Error(`Benchmark task step names must be unique. Duplicate step: "${step.name}".`);
    }
    names.add(step.name);
  }
  return { name, steps, options };
}

export function defineWorker(options: DefineWorkerOptions): BenchmarkWorker {
  const client = options.client ?? createBenchmarkClient();

  return {
    run(overrides = {}) {
      return client.runWorker({
        benchmarkSlug: options.benchmarkSlug,
        runId: options.runId,
        participantSlug: options.participantSlug,
        processKind: options.processKind,
        processKey: options.processKey,
        concurrency: overrides.concurrency ?? options.concurrency,
        batchSize: overrides.batchSize ?? options.batchSize,
        heartbeatIntervalMs: overrides.heartbeatIntervalMs ?? options.heartbeatIntervalMs,
        readyPollIntervalMs: overrides.readyPollIntervalMs ?? options.readyPollIntervalMs,
        task: options.task,
      });
    },
  };
}

export function defineBench(options: DefineBenchOptions): BenchDefinition {
  return {
    slug: options.slug,
    task: options.task,
    defineWorker(workerOptions) {
      const participantSlug = workerOptions.participantSlug ?? options.participantSlug;
      if (!participantSlug) {
        throw new Error('Benchmark worker participantSlug is required.');
      }

      return defineWorker({
        benchmarkSlug: options.slug,
        runId: workerOptions.runId,
        participantSlug,
        processKind: workerOptions.processKind,
        processKey: workerOptions.processKey,
        concurrency: workerOptions.concurrency ?? options.concurrency,
        batchSize: workerOptions.batchSize ?? options.batchSize,
        heartbeatIntervalMs: workerOptions.heartbeatIntervalMs ?? options.heartbeatIntervalMs,
        readyPollIntervalMs: workerOptions.readyPollIntervalMs ?? options.readyPollIntervalMs,
        client: workerOptions.client ?? options.client,
        task: workerOptions.task ?? options.task,
      });
    },
  };
}
