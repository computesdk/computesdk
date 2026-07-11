/**
 * Shared types for the bench DSL and runner.
 */

export interface BenchOptions {
  /**
   * Number of measured iterations. Defaults to {@link DEFAULT_ITERATIONS}.
   */
  iterations?: number;

  /**
   * Number of warmup iterations discarded before measurement. Defaults to 5.
   */
  warmup?: number;

  /**
   * Optional setup hook run before warmup and measurement.
   */
  setup?: () => void | Promise<void>;

  /**
   * Optional teardown hook run after measurement.
   */
  teardown?: () => void | Promise<void>;
}

export interface BenchRecordOptions extends Required<BenchOptions> {}

export type BenchFn = (() => void | Promise<void>) | (() => unknown);

export interface BenchmarkEntry {
  /** Stable, slash-joined id (for grouping/reporting). */
  id: string;
  /** Display name within its group. */
  name: string;
  /** Path segments describing the nested groups. */
  groups: string[];
  /** Source file the bench was registered from. */
  file: string;
  /** Resolved options. */
  options: BenchRecordOptions;
  /** Function under measurement. */
  fn: BenchFn;
}

export interface BenchmarkResult {
  id: string;
  name: string;
  groups: string[];
  file: string;
  iterations: number;
  /** Total measured time in milliseconds. */
  totalMs: number;
  /** Throughput in ops/sec. */
  hz: number;
  /** Average time per call in milliseconds. */
  meanMs: number;
  /** Min/max range in milliseconds. */
  minMs: number;
  maxMs: number;
  /** Average across iterations in milliseconds (median used in math). */
  p50Ms: number;
  /** Sample standard deviation in milliseconds. */
  stdevMs: number;
  /** Relative margin of error as a fraction (e.g. 0.05 = 5%). */
  rme: number;
  status: 'success' | 'failed' | 'skipped';
  /** Error message if {@link status} is `failed`. */
  error?: string;
}

export interface BenchmarkFileSummary {
  file: string;
  results: BenchmarkResult[];
  totalMs: number;
  pass: number;
  failed: number;
}

export interface BenchGlobal {
  __registered: BenchmarkEntry[];
  __currentGroup: string[];
  __currentFile: string | null;
}

export interface RunOptions {
  /** Restrict iteration counts; useful for quick sanity runs. */
  iterations?: number;
  /** Restrict warmup count. */
  warmup?: number;
  /** Reporter overrides, mostly for testing. */
  reporter?: 'default' | 'json';
  /** Bail on the first failing benchmark. */
  bail?: boolean;
}
