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
import type { BenchOutputEvent, BenchRunEvent, BenchSpanEvent, BenchTransport } from './events';
import type {
  BenchConfig,
  BenchContext,
  BenchRunOptions,
  BenchSuiteResult,
  BenchTaskResult,
} from './types';

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
    p50: formatMs(task.stats.medianMs),
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

export function createBench(config: BenchConfig) {
  const installId = createPrefixedId('install');
  const runtime = detectRuntime();
  const os = detectOs();
  const arch = detectArch();
  const transport: BenchTransport = createBenchTransport({
    onEvent: config.onEvent,
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
  });

  const tasks: Array<{ name: string; fn: TaskFn }> = [];

  function add(taskName: string, fn: TaskFn): void {
    if (taskName.trim() === '') {
      throw new Error('Bench task name must be non-empty.');
    }
    if (tasks.some((task) => task.name === taskName)) {
      throw new Error(`Bench task "${taskName}" is already registered.`);
    }
    tasks.push({ name: taskName, fn });
  }

  async function run(options: BenchRunOptions = {}): Promise<BenchSuiteResult> {
    const iterations = options.iterations ?? 25;
    const warmup = options.warmup ?? 3;
    const throwOnError = options.throwOnError ?? true;
    const runId = createPrefixedId('run');
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
      provider: options.provider,
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
        const ctx: BenchContext = {
          iteration: i,
          phase: 'warmup',
          taskName: task.name,
          log: (...args) => logs.push(args.map(String).join(' ')),
        };
        try {
          await task.fn(ctx);
        } catch {
          // ignore warmup errors
        }
      }

      // Measured runs
      for (let i = 0; i < iterations; i++) {
        const logs: string[] = [];
        const ctx: BenchContext = {
          iteration: i,
          phase: 'measured',
          taskName: task.name,
          log: (...args) => logs.push(args.map(String).join(' ')),
        };
        const startedAtMs = nowMs();
        const startedAt = isoNow();
        let spanError: unknown;

        try {
          await task.fn(ctx);
          const durationMs = nowMs() - startedAtMs;
          measuredDurations.push(durationMs);
          successes += 1;

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
            provider: options.provider,
            attemptCount: 1,
            attempts: [{
              provider: options.provider ?? 'unknown',
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
          };
          emitBenchEvent(event, transport);
        } catch (error) {
          spanError = error;
          failures += 1;
          const durationMs = nowMs() - startedAtMs;

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
            provider: options.provider,
            attemptCount: 1,
            attempts: [{
              provider: options.provider ?? 'unknown',
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
          };
          emitBenchEvent(event, transport);
        }

        if (spanError && throwOnError) {
          throw spanError;
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

  return { add, run };
}
