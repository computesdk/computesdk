import type { BenchEvent } from './events';
export type { BenchAttempt, BenchEvent, BenchOutputEvent, BenchRunEvent, BenchSpanEvent, BenchMetricEvent, BenchProgressEvent } from './events';

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
  /** Provider name to tag on all spans (overridable per-run via BenchRunOptions) */
  provider?: string;
  /** Base URL for ingest/query APIs (default: https://platform.computesdk.com/api/v1) */
  baseUrl?: string;
  /** Bearer token sent for ingest/query requests (default: process.env.COMPUTESDK_API_KEY) */
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
  /** Execution mode: sequential (default) or concurrent */
  mode?: 'sequential' | 'concurrent';
  /** Target concurrency for concurrent mode (default: iterations) */
  concurrency?: number;
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
  /** Attach arbitrary metadata to this iteration's span (merged at emit time) */
  setMetadata: (data: Record<string, unknown>) => void;
  /** Emit a mid-flight metric event tied to this run */
  emitMetric: (name: string, data: Record<string, unknown>) => void;
}

export interface BenchmarkStats {
  count: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  medianMs: number;
  p10Ms: number;
  p25Ms: number;
  p50Ms: number;
  p75Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
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
