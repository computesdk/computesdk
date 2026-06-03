import type {
  BenchmarkAssignment,
  BenchmarkClient,
  BenchmarkClientConfig,
  BenchmarkParticipant,
  BenchmarkResource,
  BenchmarkRun,
  BenchmarkShard,
  BenchmarkShardAttempt,
  ClaimShardInput,
  CreateRunInput,
  JsonObject,
  RunShardOptions,
  RunShardResult,
  SendTaskResultsInput,
  TaskStepRecord,
  TaskResultRecord,
  TaskResultsResponse,
  UpsertBenchmarkInput,
  UpsertParticipantInput,
} from './types';

const DEFAULT_BASE_URL = 'https://platform.computesdk.com/api/v1';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

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

function getApiKey(input?: string): string | undefined {
  return input ?? (typeof process !== 'undefined' ? process.env.COMPUTESDK_API_KEY : undefined);
}

function getErrorCode(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return 'ERROR';
}

function toJsonObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function mergeTaskData(data: JsonObject | undefined, steps: TaskStepRecord[]): JsonObject | undefined {
  if (steps.length === 0) return data;
  return {
    ...(data ?? {}),
    steps: steps as unknown as JsonObject[],
  };
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

    return request<TaskResultsResponse>(
      'POST',
      `/benchmarks/${encodePath(input.benchmarkSlug)}/runs/${encodePath(input.runId)}/shards/${encodePath(input.shardId)}/events`,
      {
        type: 'task_results',
        attemptId: input.attemptId,
        sequenceNumber: input.sequenceNumber,
        isFinal: input.isFinal,
        records: input.records as unknown as JsonObject[],
      },
    );
  }

  async function updateShard(
    action: 'heartbeat' | 'complete' | 'fail',
    benchmarkSlug: string,
    runId: string,
    shardId: string,
    attemptId: string,
    extra?: JsonObject,
  ): Promise<{ shard: BenchmarkShard; attempt: BenchmarkShardAttempt }> {
    return request<{ shard: BenchmarkShard; attempt: BenchmarkShardAttempt }>(
      'POST',
      `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/shards/${encodePath(shardId)}/${action}`,
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

    async listShards(benchmarkSlug, runId, participantSlug) {
      const data = await request<{ items?: BenchmarkShard[]; shards?: BenchmarkShard[] }>(
        'GET',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/participants/${encodePath(participantSlug)}/shards`,
      );
      return data.items ?? data.shards ?? [];
    },

    async claimShard(benchmarkSlug, runId, participantSlug, input: ClaimShardInput = {}) {
      const data = await request<{ assignment: BenchmarkAssignment | null }>(
        'POST',
        `/benchmarks/${encodePath(benchmarkSlug)}/runs/${encodePath(runId)}/participants/${encodePath(participantSlug)}/shards/claim`,
        input as JsonObject,
      );
      return data.assignment;
    },

    sendTaskResults,

    heartbeatShard(benchmarkSlug, runId, shardId, attemptId) {
      return updateShard('heartbeat', benchmarkSlug, runId, shardId, attemptId);
    },

    completeShard(benchmarkSlug, runId, shardId, attemptId) {
      return updateShard('complete', benchmarkSlug, runId, shardId, attemptId);
    },

    failShard(benchmarkSlug, runId, shardId, attemptId, error) {
      return updateShard('fail', benchmarkSlug, runId, shardId, attemptId, {
        errorCode: getErrorCode(error),
        errorMessage: error instanceof Error ? error.message : String(error ?? 'Unknown error'),
      });
    },

    async runShard(options: RunShardOptions): Promise<RunShardResult> {
      const assignment = await client.claimShard(options.benchmarkSlug, options.runId, options.participantSlug, {
        workerKind: options.workerKind,
        workerId: options.workerId,
      });
      if (!assignment) return { assignment: null, records: [] };
      const claimed = assignment;

      let sequenceNumber = 0;
      const records: TaskResultRecord[] = [];
      const pending: TaskResultRecord[] = [];
      const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
      const taskIndices = Array.from({ length: claimed.taskRange.count }, (_, index) => claimed.taskRange.start + index);

      const heartbeat = setInterval(() => {
        void client.heartbeatShard(options.benchmarkSlug, options.runId, claimed.shardId, claimed.attemptId).catch(() => {});
      }, options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();

      async function flush(isFinal: boolean): Promise<void> {
        if (pending.length === 0) return;
        const batch = pending.splice(0, pending.length);
        await sendTaskResults({
          benchmarkSlug: options.benchmarkSlug,
          runId: options.runId,
          shardId: claimed.shardId,
          attemptId: claimed.attemptId,
          sequenceNumber,
          isFinal,
          records: batch,
        });
        sequenceNumber += 1;
      }

      try {
        await mapPool(taskIndices, options.concurrency ?? claimed.targetConcurrency, async (taskIndex) => {
          const startedAtDate = new Date();
          const startedAtMs = Date.now();
          const record: TaskResultRecord = {
            taskIndex,
            status: 'success',
            startedAt: startedAtDate.toISOString(),
          };
          const steps: TaskStepRecord[] = [];

          async function step<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
            const stepStartedAtMs = Date.now();
            const stepRecord: TaskStepRecord = {
              name,
              status: 'success',
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
              latencyMs: 0,
            };

            try {
              return await fn();
            } catch (error) {
              stepRecord.status = 'error';
              stepRecord.errorCode = getErrorCode(error);
              throw error;
            } finally {
              stepRecord.completedAt = new Date().toISOString();
              stepRecord.latencyMs = Date.now() - stepStartedAtMs;
              steps.push(stepRecord);
            }
          }

          try {
            const data = await options.task({ assignment: claimed, taskIndex, step });
            record.data = mergeTaskData(toJsonObject(data), steps);
          } catch (error) {
            record.status = 'error';
            record.errorCode = getErrorCode(error);
            record.data = mergeTaskData({ errorMessage: error instanceof Error ? error.message : String(error) }, steps);
          } finally {
            record.completedAt = new Date().toISOString();
            record.latencyMs = Date.now() - startedAtMs;
          }

          records.push(record);
          pending.push(record);
          options.onResult?.(record);
          if (pending.length >= batchSize) await flush(false);
        });

        await flush(true);

        if (records.some((record) => record.status !== 'success')) {
          await client.failShard(options.benchmarkSlug, options.runId, claimed.shardId, claimed.attemptId, new Error('One or more tasks failed'));
        } else {
          await client.completeShard(options.benchmarkSlug, options.runId, claimed.shardId, claimed.attemptId);
        }

        return { assignment: claimed, records };
      } catch (error) {
        await flush(true).catch(() => {});
        await client.failShard(options.benchmarkSlug, options.runId, claimed.shardId, claimed.attemptId, error).catch(() => {});
        throw error;
      } finally {
        clearInterval(heartbeat);
      }
    },
  };

  return client;
}

export async function runBenchmarkShard(
  config: BenchmarkClientConfig,
  options: RunShardOptions,
): Promise<RunShardResult> {
  return createBenchmarkClient(config).runShard(options);
}
