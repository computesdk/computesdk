import path from 'node:path';
import process from 'node:process';
import { BenchmarkReporter, createBenchmarkClient, type BenchmarkReporterConfig, type TaskResultRecord } from '@computesdk/bench';
import { loadBenchFile } from './loader';
import type { BenchmarkEntry } from './types';

const ENV_SLUG = 'BENCH_CLI_REMOTE_SLUG';
const ENV_RUN_ID = 'BENCH_CLI_REMOTE_RUN_ID';
const ENV_PARTICIPANT = 'BENCH_CLI_REMOTE_PARTICIPANT';
const ENV_TOTAL = 'BENCH_CLI_REMOTE_TOTAL';
const ENV_BENCH_COUNT = 'BENCH_CLI_REMOTE_BENCH_COUNT';
const ENV_CONCURRENCY = 'BENCH_CLI_REMOTE_CONCURRENCY';
const ENV_WORKER_KEY = 'BENCH_CLI_REMOTE_WORKER_KEY';
const ENV_API_KEY = 'BENCH_CLI_REMOTE_API_KEY';
const ENV_BASE_URL = 'BENCH_CLI_REMOTE_BASE_URL';

export interface RemoteWorkerConfig {
  slug: string;
  runId: string;
  participant: string;
  total: number;
  benchCount: number;
  concurrency: number;
  workerKey?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Parse the worker configuration from env vars. Throws if any required
 * field is missing — the parent should always populate them.
 */
export function readWorkerConfig(env: NodeJS.ProcessEnv = process.env): RemoteWorkerConfig {
  const required = [ENV_SLUG, ENV_RUN_ID, ENV_PARTICIPANT, ENV_TOTAL, ENV_BENCH_COUNT, ENV_CONCURRENCY];
  for (const key of required) {
    if (!(env[key] && env[key]!.length > 0)) {
      throw new Error(`Remote worker missing env ${key}; was the parent CLI invoked correctly?`);
    }
  }
  return {
    slug: env[ENV_SLUG]!,
    runId: env[ENV_RUN_ID]!,
    participant: env[ENV_PARTICIPANT]!,
    total: parsePositiveInt(env[ENV_TOTAL]!, ENV_TOTAL),
    benchCount: parsePositiveInt(env[ENV_BENCH_COUNT]!, ENV_BENCH_COUNT),
    concurrency: parsePositiveInt(env[ENV_CONCURRENCY]!, ENV_CONCURRENCY),
    workerKey: env[ENV_WORKER_KEY],
    apiKey: env[ENV_API_KEY],
    baseUrl: env[ENV_BASE_URL],
  };
}

/**
 * Run the worker loop. Returns the count of successful/failed tasks run
 * by this process for reporting back to the parent.
 */
export async function runRemoteWorker(options: {
  file: string;
  config: RemoteWorkerConfig;
  reporterFactory?: (cfg: BenchmarkReporterConfig) => Promise<BenchmarkReporter | null>;
  clientFactory?: (cfg: { apiKey?: string; baseUrl?: string }) => ReturnType<typeof createBenchmarkClient>;
}): Promise<{ pass: number; failed: number }> {
  const config = options.config;
  const entries = await loadBenchFile(path.resolve(options.file));
  const reporterFactory = options.reporterFactory ?? defaultReporterFactory;
  const reporter = await reporterFactory({
    benchmarkSlug: config.slug,
    runId: config.runId,
    participantSlug: config.participant,
    processKind: 'container',
    processKey: config.workerKey ?? `bench-cli-${process.pid}`,
    batchSize: 100,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
  if (!reporter) {
    process.stderr.write(`bench-cli: remote worker could not claim assignment for ${config.slug}/${config.runId}\n`);
    process.exitCode = 1;
    return { pass: 0, failed: 0 };
  }

  const range = reporter.workerAssignment.taskRange;
  const benchEntries: BenchmarkEntry[] = entries;

  let pass = 0;
  let failed = 0;
  const startedAt = new Date().toISOString();

  for (let taskIndex = range.start; taskIndex < range.start + range.count; taskIndex += 1) {
    const benchIdx = Math.floor(taskIndex / config.total);
    const repIdx = taskIndex % config.total;
    const entry = benchEntries[benchIdx];
    if (!entry) {
      failed += 1;
      reporter.recordResult(buildFailedRecord(taskIndex, startedAt, `bench index ${benchIdx} out of range`));
      continue;
    }
    const record = await runTask(taskIndex, entry, repIdx);
    if (record.status === 'success') pass += 1;
    else failed += 1;
    reporter.recordResult(record);
  }

  reporter.setProgress({ done: pass + failed, inFlight: 0, errors: failed, total: range.count });
  await reporter.finish(failed > 0);
  reportProgress({ kind: 'progress', pass, failed });
  return { pass, failed };
}

async function runTask(taskIndex: number, entry: BenchmarkEntry, repIdx: number): Promise<TaskResultRecord> {
  const staticIterations = entry.options.iterations ?? 100;
  const iterations = Math.min(staticIterations, 100);
  const warmup = Math.min(entry.options.warmup ?? 5, 10);
  const startedAt = new Date().toISOString();

  try {
    await entry.options.setup();
    for (let i = 0; i < warmup; i += 1) await entry.fn();
    const tickStart = now();
    for (let i = 0; i < iterations; i += 1) await entry.fn();
    const totalMs = now() - tickStart;
    const hz = totalMs > 0 ? (iterations / totalMs) * 1000 : 0;
    const teardown = entry.options.teardown();
    if (teardown && typeof (teardown as Promise<unknown>).catch === 'function') {
      await (teardown as Promise<unknown>).catch(() => {});
    }
    return {
      taskIndex,
      status: 'success',
      startedAt,
      completedAt: new Date().toISOString(),
      latencyMs: totalMs,
      steps: [],
      data: {
        taskName: entry.id,
        benchName: entry.name,
        benchId: entry.id,
        repIdx,
        hz,
        meanMs: totalMs / Math.max(iterations, 1),
        iterations,
        warmup,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    return buildFailedRecord(taskIndex, startedAt, message, entry);
  }
}

function buildFailedRecord(taskIndex: number, startedAt: string, message: string, entry?: BenchmarkEntry): TaskResultRecord {
  return {
    taskIndex,
    status: 'failed',
    startedAt,
    completedAt: new Date().toISOString(),
    latencyMs: 0,
    errorCode: 'BENCH_FAILED',
    data: {
      taskName: entry ? entry.id : '<unknown>',
      benchName: entry ? entry.name : '<unknown>',
      benchId: entry ? entry.id : '<unknown>',
      errorMessage: message,
    },
  };
}

function reportProgress(message: { kind: 'progress'; pass: number; failed: number }): void {
  if (typeof process.send === 'function') {
    try {
      process.send(message);
    } catch {
      // IPC may not be available in all contexts (e.g., tests).
    }
  }
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`env ${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

function defaultReporterFactory(cfg: BenchmarkReporterConfig): Promise<BenchmarkReporter | null> {
  return BenchmarkReporter.claim(cfg);
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
