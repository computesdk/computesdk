import { buildStats } from './stats';
import { promises as fs } from 'node:fs';
import {
  createPrefixedId,
  detectArch,
  detectOs,
  detectRuntime,
  createBenchTransport,
  emitBenchEvent,
  flushBenchTransportBestEffort,
  toErrorCode,
} from './events';
import type { BenchOutputEvent, BenchRunEvent, BenchSpanEvent, BenchTransport, BenchMetricEvent, BenchProgressEvent } from './events';
import type {
  BenchAddOptions,
  BenchConfig,
  BenchContext,
  BenchRunOptions,
  BenchSuiteResult,
  BenchTaskResult,
} from './types';
import { createBenchQueryClient } from './query';
import { createRawEventStore, shouldEnableRawStorage } from './raw-store';

declare const __BENCH_VERSION__: string;
const BENCH_VERSION =
  typeof __BENCH_VERSION__ !== 'undefined' ? __BENCH_VERSION__ : '0.0.0';

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function isoNow(): string {
  return new Date().toISOString();
}

type TaskFn = (ctx: BenchContext) => Promise<unknown> | unknown;
type RegisteredTask = { name: string; fn: TaskFn; options?: BenchAddOptions };
type BenchApi = {
  add: (taskName: string, fn: TaskFn, options?: BenchAddOptions) => BenchApi;
  run: (options?: BenchRunOptions) => Promise<BenchSuiteResult>;
  emit: (name: string, data: Record<string, unknown>, runId?: string) => void;
  progress: (params: { done: number; inFlight: number; errors: number; total: number; extra?: Record<string, unknown> }, runId?: string) => void;
} & ReturnType<typeof createBenchQueryClient>;

const OUTPUT_FLUSH_INTERVAL = 30000;
const OUTPUT_READ_CHUNK_SIZE = 64 * 1024;

function sanitizeLogEntry(value: string): string {
  return value
    .replace(/\b(?:sk|pk|rk)_[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
    .replace(/\b(api[-_ ]?key|token|secret|password)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\b(?:Bearer\s+)[A-Za-z0-9._-]+\b/gi, 'Bearer [REDACTED]');
}

function finalizeLogs(logs: string[]): string[] | undefined {
  if (logs.length === 0) return undefined;
  return logs.map(sanitizeLogEntry);
}

function formatMs(ms: number): string {
  if (ms === 0) return '0ms';
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function printSummary(result: BenchSuiteResult): void {
  const rows = result.tasks.map((task) => ({
    task: task.taskName,
    avg: formatMs(task.stats.meanMs),
    p50: formatMs(task.stats.p50Ms),
    p95: formatMs(task.stats.p95Ms),
    min: formatMs(task.stats.minMs),
    max: formatMs(task.stats.maxMs),
    concurrency: result.mode === 'concurrent'
      ? String(result.concurrency ?? result.iterations ?? task.stats.count)
      : '-',
    runs: String(task.stats.count),
    errors: String(task.failures),
  }));

  const headers = ['Task', 'Avg', 'P50', 'P95', 'Min', 'Max', 'Concurrency', 'Runs', 'Errors'];
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => Object.values(row)[index].length),
  ));
  const line = (values: string[]) => values.map((value, index) => value.padEnd(widths[index])).join('  ');
  const workloadCounters = result.workloadCounters ?? {};
  const workloadCounterKeys = Object.keys(workloadCounters);

  const output = [
    '',
    result.label,
    result.mode === 'concurrent'
      ? `Mode: concurrent${typeof result.concurrency === 'number' ? ` (limit=${result.concurrency})` : ''}`
      : undefined,
    typeof result.iterations === 'number' ? `Iterations per task: ${result.iterations}` : undefined,
    typeof result.warmup === 'number' ? `Warmup per task: ${result.warmup}` : undefined,
    result.mode === 'concurrent' && result.iterations === 1 && workloadCounterKeys.length > 0
      ? 'Note: 1 benchmark iteration can still represent many concurrent workload operations.'
      : undefined,
    workloadCounterKeys.length > 0
      ? `Workload counters: ${workloadCounterKeys.sort().map((key) => `${key}=${formatNumber(workloadCounters[key])}`).join(', ')}`
      : undefined,
    '',
    line(headers),
    line(widths.map((width) => '-'.repeat(width))),
    ...rows.map((row) => line(Object.values(row))),
    '',
  ].filter((entry): entry is string => typeof entry === 'string').join('\n');

  if (typeof process !== 'undefined' && process.stdout?.write) {
    process.stdout.write(output);
  }
}

function createOutputCapture(params: {
  config: BenchConfig;
  installId: string;
  runId: string;
  transport: BenchTransport;
  runtime: 'node' | 'browser' | 'unknown';
  os: string;
  arch: string;
}) {
  const capture = params.config.captureOutput;
  if (!capture?.file) return undefined;
  const captureConfig = capture;

  let offset = 0;
  let partial = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  let flushing: Promise<void> | undefined;
  let pendingFinalFlush = false;

  async function emitLine(message: string): Promise<void> {
    const event: BenchOutputEvent = {
      event: 'benchmark.output',
      eventId: createPrefixedId('event'),
      runId: params.runId,
      label: params.config.label,
      installId: params.installId,
      batch: params.config.batch,
      shardIndex: params.config.shard?.index,
      shardCount: params.config.shard?.count,
      timestamp: isoNow(),
      source: 'file',
      path: captureConfig.file,
      message: sanitizeLogEntry(message),
      benchVersion: BENCH_VERSION,
      runtime: params.runtime,
      os: params.os,
      arch: params.arch,
    };
    emitBenchEvent(event, params.transport);
  }

  async function flush(final = false): Promise<void> {
    let size: number;
    try {
      size = (await fs.stat(captureConfig.file)).size;
    } catch {
      return;
    }

    if (size < offset) {
      offset = 0;
      partial = '';
    }

    if (size > offset) {
      let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
      try {
        handle = await fs.open(captureConfig.file, 'r');

        let position = offset;
        let carry = partial;
        while (position < size) {
          const length = Math.min(OUTPUT_READ_CHUNK_SIZE, size - position);
          const buffer = Buffer.allocUnsafe(length);
          const { bytesRead } = await handle.read(buffer, 0, length, position);
          if (bytesRead <= 0) break;

          position += bytesRead;
          const lines = (carry + buffer.subarray(0, bytesRead).toString('utf8')).split(/\r?\n/);
          carry = lines.pop() ?? '';

          for (const line of lines) {
            await emitLine(line);
          }
        }

        offset = position;
        partial = carry;
      } catch {
        return;
      } finally {
        await handle?.close();
      }
    }

    if (final && partial) {
      await emitLine(partial);
      partial = '';
    }
  }

  function requestFlush(final = false): Promise<void> {
    if (final) pendingFinalFlush = true;
    if (flushing) return flushing;

    flushing = (async () => {
      do {
        const shouldFinalize = pendingFinalFlush;
        pendingFinalFlush = false;
        await flush(shouldFinalize);
      } while (pendingFinalFlush);
    })().finally(() => {
      flushing = undefined;
    });

    return flushing;
  }

  return {
    start() {
      timer = setInterval(() => {
        void requestFlush();
      }, captureConfig.flushInterval ?? OUTPUT_FLUSH_INTERVAL);
    },
    async stop() {
      if (timer) clearInterval(timer);
      await requestFlush(true);
    },
  };
}

const DEFAULT_BASE_URL = 'https://platform.computesdk.com/api/v1';

export function createBench(config: BenchConfig) {
  const installId = createPrefixedId('install');
  const runtime = detectRuntime();
  const os = detectOs();
  const arch = detectArch();
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const apiUrl = `${baseUrl}/events`;
  const apiKey = config.apiKey ?? process.env.COMPUTESDK_API_KEY;
  const userOnEvent = config.onEvent;
  let currentRawStore: ReturnType<typeof createRawEventStore> | undefined;
  const transport: BenchTransport = createBenchTransport({
    onEvent: (event) => {
      userOnEvent?.(event);
      currentRawStore?.write(event);
    },
    apiUrl,
    apiKey,
  });
  const query = createBenchQueryClient({ baseUrl, apiKey });

  const tasks: RegisteredTask[] = [];
  let currentRunId: string | undefined;
  let currentProvider: string | undefined;
  let collectWorkloadCounters: ((data?: Record<string, unknown>) => void) | undefined;

  let api: BenchApi;

  function add(taskName: string, fn: TaskFn, options: BenchAddOptions = {}) {
    if (taskName.trim() === '') {
      throw new Error('Bench task name must be non-empty.');
    }
    if (tasks.some((task) => task.name === taskName)) {
      throw new Error(`Bench task "${taskName}" is already registered.`);
    }
    tasks.push({ name: taskName, fn, options });
    return api;
  }

  function emitMetric(name: string, data: Record<string, unknown>, runId?: string): void {
    collectWorkloadCounters?.(data);
    const event: BenchMetricEvent = {
      event: 'benchmark.metric',
      eventId: createPrefixedId('event'),
      runId: runId ?? currentRunId ?? createPrefixedId('run'),
      label: config.label,
      installId,
      batch: config.batch,
      shardIndex: config.shard?.index,
      shardCount: config.shard?.count,
      timestamp: isoNow(),
      name,
      data,
      provider: currentProvider ?? config.provider,
      benchVersion: BENCH_VERSION,
      runtime,
      os,
      arch,
    };
    emitBenchEvent(event, transport);
  }

  function emitProgress(params: { done: number; inFlight: number; errors: number; total: number; extra?: Record<string, unknown> }, runId?: string): void {
    collectWorkloadCounters?.(params.extra);
    const event: BenchProgressEvent = {
      event: 'benchmark.progress',
      eventId: createPrefixedId('event'),
      runId: runId ?? currentRunId ?? createPrefixedId('run'),
      label: config.label,
      installId,
      batch: config.batch,
      shardIndex: config.shard?.index,
      shardCount: config.shard?.count,
      timestamp: isoNow(),
      done: params.done,
      inFlight: params.inFlight,
      errors: params.errors,
      total: params.total,
      extra: params.extra,
      provider: currentProvider ?? config.provider,
      benchVersion: BENCH_VERSION,
      runtime,
      os,
      arch,
    };
    emitBenchEvent(event, transport);
  }

  async function run(options: BenchRunOptions = {}): Promise<BenchSuiteResult> {
    const iterations = options.iterations ?? 25;
    const warmup = options.warmup ?? 3;
    const throwOnError = options.throwOnError ?? true;
    const mode = options.mode ?? 'sequential';
    const concurrency = options.concurrency ?? iterations;
    if (!Number.isFinite(concurrency) || concurrency <= 0) {
      throw new Error('Bench concurrency must be a positive number.');
    }
    const runId = createPrefixedId('run');
    currentRunId = runId;
    currentProvider = options.provider ?? config.provider;
    const traceId = createPrefixedId('trace');
    if (shouldEnableRawStorage(config.rawStorage)) {
      currentRawStore = createRawEventStore({
        config: config.rawStorage,
        runId,
        batch: config.batch,
        shardIndex: config.shard?.index,
        shardCount: config.shard?.count,
        provider: options.provider ?? config.provider,
        label: config.label,
      });
    }
    const outputCapture = createOutputCapture({
      config,
      installId,
      runId,
      transport,
      runtime,
      os,
      arch,
    });

    const runEvent: BenchRunEvent = {
      event: 'benchmark.run',
      eventId: createPrefixedId('event'),
      runId,
      label: config.label,
      batch: config.batch,
      shardIndex: config.shard?.index,
      shardCount: config.shard?.count,
      tasks: tasks.map((t) => t.name),
      provider: options.provider ?? config.provider,
      iterations,
      warmup,
      installId,
      benchVersion: BENCH_VERSION,
      runtime,
      os,
      arch,
    };
    emitBenchEvent(runEvent, transport);
    outputCapture?.start();

    const taskResults: BenchTaskResult[] = [];
    const workloadCounters = new Map<string, number>();

    const addWorkloadCounters = (data?: Record<string, unknown>) => {
      if (!data) return;
      for (const [key, value] of Object.entries(data)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        workloadCounters.set(key, (workloadCounters.get(key) ?? 0) + value);
      }
    };
    collectWorkloadCounters = addWorkloadCounters;
    if (mode === 'concurrent' && concurrency > 1) {
      addWorkloadCounters({ concurrency_target: concurrency });
    }

    try {
      const emitMeasuredSpan = (params: {
        taskName: string;
        iteration: number;
        startedAt: string;
        durationMs: number;
        status: 'ok' | 'error';
        logs: string[];
        metadata: Record<string, unknown>[];
        error?: unknown;
      }) => {
        const mergedMetadata = Object.assign({}, ...params.metadata);
        const endedAt = isoNow();
        const event: BenchSpanEvent = {
          event: 'benchmark.span',
          eventId: createPrefixedId('event'),
          runId,
          label: config.label,
          installId,
          traceId,
          spanId: createPrefixedId('span'),
          operation: params.taskName,
          startedAt: params.startedAt,
          endedAt,
          durationMs: params.durationMs,
          status: params.status,
          provider: options.provider ?? config.provider,
          attemptCount: 1,
          attempts: [{
            provider: options.provider ?? config.provider ?? 'unknown',
            candidateIndex: 0,
            startedAt: params.startedAt,
            endedAt,
            durationMs: params.durationMs,
            status: params.status,
            errorCode: params.error ? toErrorCode(params.error) : undefined,
          }],
          errorCode: params.error ? toErrorCode(params.error) : undefined,
          benchVersion: BENCH_VERSION,
          runtime,
          os,
          arch,
          batch: config.batch,
          shardIndex: config.shard?.index,
          shardCount: config.shard?.count,
          taskName: params.taskName,
          logs: finalizeLogs(params.logs),
          iteration: params.iteration,
          phase: 'measured',
          metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
        };
        emitBenchEvent(event, transport);
      };

      const taskStats = new Map<string, { durations: number[]; successes: number; failures: number }>();
      for (const task of tasks) {
        taskStats.set(task.name, { durations: [], successes: 0, failures: 0 });
      }

      const stageErrors: unknown[] = [];
      const unitFailed = new Array(iterations).fill(false);

      const runWithLimit = async (indices: number[], limit: number, worker: (i: number) => Promise<void>) => {
        if (indices.length === 0) return;
        if (limit <= 0) throw new Error('Concurrency must be > 0.');
        let cursor = 0;
        const runners = Array.from({ length: Math.min(limit, indices.length) }, async () => {
          while (cursor < indices.length) {
            const idx = indices[cursor++];
            await worker(idx);
          }
        });
        await Promise.all(runners);
      };

      for (let i = 0; i < warmup; i++) {
        for (const task of tasks) {
          const logs: string[] = [];
          const metadata: Record<string, unknown>[] = [];
          const ctx: BenchContext = {
            iteration: i,
            phase: 'warmup',
            taskName: task.name,
            log: (...args) => logs.push(args.map(String).join(' ')),
            setMetadata: (data) => metadata.push(data),
            emitMetric: (name, data) => emitMetric(name, data, runId),
          };
          try {
            await task.fn(ctx);
          } catch {
            // Ignore warmup failures.
          }
        }
      }

      for (const task of tasks) {
        const stats = taskStats.get(task.name)!;
        const eligible = unitFailed
          .map((failed, index) => ({ failed, index }))
          .filter((item) => task.options?.runOnFailed || !item.failed)
          .map((item) => item.index);

        const stageConcurrency = mode === 'concurrent'
          ? Math.min(concurrency, task.options?.concurrency ?? concurrency)
          : 1;
        if (!Number.isFinite(stageConcurrency) || stageConcurrency <= 0) {
          throw new Error(`Bench step "${task.name}" has invalid concurrency: ${String(task.options?.concurrency)}.`);
        }

        await runWithLimit(eligible, stageConcurrency, async (i) => {
          const logs: string[] = [];
          const metadata: Record<string, unknown>[] = [];
          const ctx: BenchContext = {
            iteration: i,
            phase: 'measured',
            taskName: task.name,
            log: (...args) => logs.push(args.map(String).join(' ')),
            setMetadata: (data) => metadata.push(data),
            emitMetric: (name, data) => emitMetric(name, data, runId),
          };
          const startedAtMs = nowMs();
          const startedAt = isoNow();

          try {
            await task.fn(ctx);
            const durationMs = nowMs() - startedAtMs;
            stats.durations.push(durationMs);
            stats.successes += 1;
            emitMeasuredSpan({
              taskName: task.name,
              iteration: i,
              startedAt,
              durationMs,
              status: 'ok',
              logs,
              metadata,
            });
          } catch (error) {
            const durationMs = nowMs() - startedAtMs;
            stats.failures += 1;
            unitFailed[i] = true;
            stageErrors.push(error);
            emitMeasuredSpan({
              taskName: task.name,
              iteration: i,
              startedAt,
              durationMs,
              status: 'error',
              logs,
              metadata,
              error,
            });
          }
        });
      }

      if (throwOnError && stageErrors.length > 0) {
        throw stageErrors[0];
      }

      for (const task of tasks) {
        const stats = taskStats.get(task.name)!;
        taskResults.push({
          taskName: task.name,
          iterations,
          warmup,
          successes: stats.successes,
          failures: stats.failures,
          stats: buildStats(stats.durations),
        });
      }
    } finally {
      collectWorkloadCounters = undefined;
      currentRunId = undefined;
      currentProvider = undefined;
      await outputCapture?.stop();
      await flushBenchTransportBestEffort(transport);
      await currentRawStore?.close();
      currentRawStore = undefined;
    }

    const result = {
      label: config.label,
      runId,
      tasks: taskResults,
      mode,
      concurrency: mode === 'concurrent' ? concurrency : undefined,
      iterations,
      warmup,
      workloadCounters: Object.fromEntries(workloadCounters),
    };
    printSummary(result);
    return result;
  }

  api = { add, run, emit: emitMetric, progress: emitProgress, ...query };
  return api;
}
