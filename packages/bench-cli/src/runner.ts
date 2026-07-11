import type {
  BenchmarkEntry,
  BenchmarkResult,
  RunOptions,
} from './types';
import { DEFAULT_ITERATIONS, DEFAULT_WARMUP } from './dsl';

export type ProgressListener = (entry: BenchmarkEntry, status: 'start' | 'done', result?: BenchmarkResult) => void;

/**
 * Run a single benchmark to completion, returning a measurement summary.
 */
export async function runSingleBenchmark(
  entry: BenchmarkEntry,
  options: RunOptions = {},
): Promise<BenchmarkResult> {
  const iterations = options.iterations ?? entry.options.iterations ?? DEFAULT_ITERATIONS;
  const warmup = options.warmup ?? entry.options.warmup ?? DEFAULT_WARMUP;

  await entry.options.setup();

  try {
    for (let i = 0; i < warmup; i++) {
      await entry.fn();
    }
    const samples: number[] = [];
    const startTotal = now();
    for (let i = 0; i < iterations; i++) {
      const tick = now();
      await entry.fn();
      samples.push(now() - tick);
    }
    const totalMs = now() - startTotal;
    return buildResult(entry, iterations, totalMs, samples, 'success');
  } catch (error) {
    return buildResult(entry, 0, 0, [], 'failed', formatError(error));
  } finally {
    try {
      await entry.options.teardown();
    } catch {
      // Ignore teardown errors for result aggregation.
    }
  }
}

function buildResult(
  entry: BenchmarkEntry,
  iterations: number,
  totalMs: number,
  samples: number[],
  status: 'success' | 'failed' | 'skipped',
  error?: string,
): BenchmarkResult {
  if (status !== 'success' || samples.length === 0) {
    return {
      id: entry.id,
      name: entry.name,
      groups: [...entry.groups],
      file: entry.file,
      iterations,
      totalMs,
      hz: 0,
      meanMs: 0,
      minMs: 0,
      maxMs: 0,
      p50Ms: 0,
      stdevMs: 0,
      rme: 0,
      status,
      error,
    };
  }

  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance =
    samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(samples.length - 1, 1);
  const stdev = Math.sqrt(variance);
  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const hz = totalMs > 0 ? (iterations / totalMs) * 1000 : 0;
  const rme = mean > 0 ? stdev / Math.sqrt(samples.length) / mean : 0;

  return {
    id: entry.id,
    name: entry.name,
    groups: [...entry.groups],
    file: entry.file,
    iterations,
    totalMs,
    hz,
    meanMs: mean,
    minMs: min,
    maxMs: max,
    p50Ms: p50,
    stdevMs: stdev,
    rme,
    status,
  };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function now(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Run every supplied entry sequentially, invoking the optional progress
 * listener around each measurement.
 */
export async function runBenchmarks(
  entries: readonly BenchmarkEntry[],
  options: RunOptions = {},
  onProgress?: ProgressListener,
): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  for (const entry of entries) {
    onProgress?.(entry, 'start');
    const result = await runSingleBenchmark(entry, options);
    onProgress?.(entry, 'done', result);
    results.push(result);
    if (options.bail && result.status === 'failed') break;
  }
  return results;
}
