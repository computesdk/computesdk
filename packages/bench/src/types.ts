import type { BenchEvent } from './events';
export type { BenchAttempt, BenchEvent, BenchOutputEvent, BenchRunEvent, BenchSpanEvent } from './events';

export interface BenchCaptureOutputConfig {
  /** File to tail and emit as benchmark.output events */
  file: string;
  /** Flush interval in milliseconds (default: 30000) */
  flushInterval?: number;
}

export interface BenchShardConfig {
  /** Zero-based shard index for this process */
  index: number;
  /** Total number of shards in the logical benchmark batch */
  count: number;
}

export interface BenchConfig {
  /** Human-readable label for this benchmark run (e.g. 'sandbox-lifecycle') */
  label: string;
  /** Optional API endpoint for uploading benchmark events */
  apiUrl?: string;
  /** Optional Bearer token sent when apiUrl is set */
  apiKey?: string;
  /** Shared logical batch id for multi-process/sharded runs */
  batch?: string;
  /** Shard metadata for this process when batch is used */
  shard?: BenchShardConfig;
  /** Local debug hook — receives every benchmark event before it is sent to the platform */
  onEvent?: (event: BenchEvent) => void;
  /** Capture process/coordinator output from a log file */
  captureOutput?: BenchCaptureOutputConfig;
}

export interface BenchRunOptions {
  /** Number of measured iterations per task (default: 25) */
  iterations?: number;
  /** Warmup iterations before measuring (default: 3) */
  warmup?: number;
  /** Provider name to tag on all spans */
  provider?: string;
  /** Re-throw the first error encountered (default: true) */
  throwOnError?: boolean;
}

export interface BenchContext {
  /** Current iteration index within the current phase (0-based) */
  iteration: number;
  /** Current phase */
  phase: 'warmup' | 'measured';
  /** Name of the current task */
  taskName: string;
  /** Attach a log message to this iteration's benchmark span */
  log: (...args: unknown[]) => void;
}

export interface BenchmarkStats {
  count: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
}

export interface BenchTaskResult {
  taskName: string;
  iterations: number;
  warmup: number;
  successes: number;
  failures: number;
  stats: BenchmarkStats;
}

export interface BenchSuiteResult {
  label: string;
  runId: string;
  tasks: BenchTaskResult[];
}
