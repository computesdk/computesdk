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
  BenchConfig,
  BenchContext,
  BenchRunOptions,
  BenchSuiteResult,
  BenchTaskResult,
} from './types';
import { createBenchQueryClient } from './query';

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

const LOG_MAX_ENTRIES = 50;
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
  return logs.slice(0, LOG_MAX_ENTRIES).map(sanitizeLogEntry);
}

function formatMs(ms: number): string {
  if (ms === 0) return '0ms';
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function printSummary(result: BenchSuiteResult): void {
  const rows = result.tasks.map((task) => ({
    task: task.taskName,
    avg: formatMs(task.stats.meanMs),
    p50: formatMs(task.stats.p50Ms),
    p95: formatMs(task.stats.p95Ms),
    min: formatMs(task.stats.minMs),
    max: formatMs(task.stats.maxMs),
    runs: String(task.stats.count),
    errors: String(task.failures),
  }));

  const headers = ['Task', 'Avg', 'P50', 'P95', 'Min', 'Max', 'Runs', 'Errors'];
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => Object.values(row)[index].length),
  ));
  const line = (values: string[]) => values.map((value, index) => value.padEnd(widths[index])).join('  ');
  const output = [
    '',
    result.label,
    '',
    line(headers),
    line(widths.map((width) => '-'.repeat(width))),
    ...rows.map((row) => line(Object.values(row))),
    '',
  ].join('\n');

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

const DEFAULT_INGEST_URL = 'https://platform.computesdk.com/api/v1/events';

export function createBench(config: BenchConfig) {
  const installId = createPrefixedId('install');
  const runtime = detectRuntime();
  const os = detectOs();
  const arch = detectArch();
  const apiUrl = config.apiUrl ?? DEFAULT_INGEST_URL;
  const apiKey = config.apiKey ?? process.env.COMPUTESDK_API_KEY;
  const queryBaseUrl = config.queryUrl ?? apiUrl.replace(/\/events\/?$/, '');
  const transport: BenchTransport = createBenchTransport({
    onEvent: config.onEvent,
    apiUrl,
    apiKey,
  });
  const query = createBenchQueryClient(queryBaseUrl, apiKey);

  const tasks: Array<{ name: string; fn: TaskFn }> = [];
  let currentRunId: string | undefined;
  let currentProvider: string | undefined;

  function add(taskName: string, fn: TaskFn): void {
    if (taskName.trim() === '') {
      throw new Error('Bench task name must be non-empty.');
    }
    if (tasks.some((task) => task.name === taskName)) {
      throw new Error(`Bench task "${taskName}" is already registered.`);
    }
    tasks.push({ name: taskName, fn });
  }

  function emitMetric(name: string, data: Record<string, unknown>, runId?: string): void {
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
    const runId = createPrefixedId('run');
    currentRunId = runId;
    currentProvider = options.provider ?? config.provider;
    const traceId = createPrefixedId('trace');
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

    try {
      for (const task of tasks) {
      const measuredDurations: number[] = [];
      let successes = 0;
      let failures = 0;

      // Warmup runs (errors silently ignored)
      for (let i = 0; i < warmup; i++) {
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
          // ignore warmup errors
        }
      }

      if (mode === 'concurrent') {
        // Concurrent mode: fire all iterations concurrently up to concurrency limit.
        // Uses Promise.allSettled so every task runs to completion regardless of
        // individual failures. If throwOnError is true, an aggregate error is thrown
        // after all tasks settle.
        let done = 0;
        let inFlight = 0;
        let errorCount = 0;
        const concurrentErrors: unknown[] = [];

        const runOne = async (i: number) => {
          inFlight++;
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
            measuredDurations.push(durationMs);
            successes += 1;
            done++;

            const mergedMetadata = Object.assign({}, ...metadata);
            const event: BenchSpanEvent = {
              event: 'benchmark.span',
              eventId: createPrefixedId('event'),
              runId,
              label: config.label,
              installId,
              traceId,
              spanId: createPrefixedId('span'),
              operation: task.name,
              startedAt,
              endedAt: isoNow(),
              durationMs,
              status: 'ok',
              provider: options.provider ?? config.provider,
              attemptCount: 1,
              attempts: [{
                provider: options.provider ?? config.provider ?? 'unknown',
                candidateIndex: 0,
                startedAt,
                endedAt: isoNow(),
                durationMs,
                status: 'ok',
              }],
              benchVersion: BENCH_VERSION,
              runtime,
              os,
              arch,
              batch: config.batch,
              shardIndex: config.shard?.index,
              shardCount: config.shard?.count,
              taskName: task.name,
              logs: finalizeLogs(logs),
              iteration: i,
              phase: 'measured',
              metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
            };
            emitBenchEvent(event, transport);
          } catch (error) {
            failures += 1;
            errorCount++;
            done++;
            concurrentErrors.push(error);
            const durationMs = nowMs() - startedAtMs;

            const mergedMetadata = Object.assign({}, ...metadata);
            const event: BenchSpanEvent = {
              event: 'benchmark.span',
              eventId: createPrefixedId('event'),
              runId,
              label: config.label,
              installId,
              traceId,
              spanId: createPrefixedId('span'),
              operation: task.name,
              startedAt,
              endedAt: isoNow(),
              durationMs,
              status: 'error',
              provider: options.provider ?? config.provider,
              attemptCount: 1,
              attempts: [{
                provider: options.provider ?? config.provider ?? 'unknown',
                candidateIndex: 0,
                startedAt,
                endedAt: isoNow(),
                durationMs,
                status: 'error',
                errorCode: toErrorCode(error),
              }],
              errorCode: toErrorCode(error),
              benchVersion: BENCH_VERSION,
              runtime,
              os,
              arch,
              batch: config.batch,
              shardIndex: config.shard?.index,
              shardCount: config.shard?.count,
              taskName: task.name,
              logs: finalizeLogs(logs),
              iteration: i,
              phase: 'measured',
              metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
            };
            emitBenchEvent(event, transport);
          }

          inFlight--;
        };

        // Simple concurrency limiter using a semaphore pattern with a queue
        const promises: Promise<void>[] = [];
        let activeCount = 0;
        const waitQueue: (() => void)[] = [];

        const acquire = () => new Promise<void>((resolve) => {
          if (activeCount < concurrency) {
            activeCount++;
            resolve();
          } else {
            waitQueue.push(resolve);
          }
        });

        const release = () => {
          activeCount--;
          if (waitQueue.length > 0) {
            const next = waitQueue.shift()!;
            activeCount++;
            next();
          }
        };

        for (let i = 0; i < iterations; i++) {
          const p = (async () => {
            await acquire();
            try {
              await runOne(i);
            } finally {
              release();
            }
          })();
          promises.push(p);
        }

        await Promise.allSettled(promises);

        if (throwOnError && concurrentErrors.length > 0) {
          throw concurrentErrors[0];
        }
      } else {
        // Sequential mode (default)
        for (let i = 0; i < iterations; i++) {
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
          let spanError: unknown;

          try {
            await task.fn(ctx);
            const durationMs = nowMs() - startedAtMs;
            measuredDurations.push(durationMs);
            successes += 1;

            const mergedMetadata = Object.assign({}, ...metadata);
            const event: BenchSpanEvent = {
              event: 'benchmark.span',
              eventId: createPrefixedId('event'),
              runId,
              label: config.label,
              installId,
              traceId,
              spanId: createPrefixedId('span'),
              operation: task.name,
              startedAt,
              endedAt: isoNow(),
              durationMs,
              status: 'ok',
              provider: options.provider ?? config.provider,
              attemptCount: 1,
              attempts: [{
                provider: options.provider ?? config.provider ?? 'unknown',
                candidateIndex: 0,
                startedAt,
                endedAt: isoNow(),
                durationMs,
                status: 'ok',
              }],
              benchVersion: BENCH_VERSION,
              runtime,
              os,
              arch,
              batch: config.batch,
              shardIndex: config.shard?.index,
              shardCount: config.shard?.count,
              taskName: task.name,
              logs: finalizeLogs(logs),
              iteration: i,
              phase: 'measured',
              metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
            };
            emitBenchEvent(event, transport);
          } catch (error) {
            spanError = error;
            failures += 1;
            const durationMs = nowMs() - startedAtMs;

            const mergedMetadata = Object.assign({}, ...metadata);
            const event: BenchSpanEvent = {
              event: 'benchmark.span',
              eventId: createPrefixedId('event'),
              runId,
              label: config.label,
              installId,
              traceId,
              spanId: createPrefixedId('span'),
              operation: task.name,
              startedAt,
              endedAt: isoNow(),
              durationMs,
              status: 'error',
              provider: options.provider ?? config.provider,
              attemptCount: 1,
              attempts: [{
                provider: options.provider ?? config.provider ?? 'unknown',
                candidateIndex: 0,
                startedAt,
                endedAt: isoNow(),
                durationMs,
                status: 'error',
                errorCode: toErrorCode(error),
              }],
              errorCode: toErrorCode(error),
              benchVersion: BENCH_VERSION,
              runtime,
              os,
              arch,
              batch: config.batch,
              shardIndex: config.shard?.index,
              shardCount: config.shard?.count,
              taskName: task.name,
              logs: finalizeLogs(logs),
              iteration: i,
              phase: 'measured',
              metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
            };
            emitBenchEvent(event, transport);
          }

          if (spanError && throwOnError) {
            throw spanError;
          }
        }
      }

      taskResults.push({
        taskName: task.name,
        iterations,
        warmup,
        successes,
        failures,
        stats: buildStats(measuredDurations),
      });
      }
    } finally {
      currentRunId = undefined;
      currentProvider = undefined;
      await outputCapture?.stop();
      await flushBenchTransportBestEffort(transport);
    }

    const result = {
      label: config.label,
      runId,
      tasks: taskResults,
    };
    printSummary(result);
    return result;
  }

  return { add, run, emit: emitMetric, progress: emitProgress, ...query };
}
