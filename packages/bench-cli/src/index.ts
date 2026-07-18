/**
 * Public surface of the bench CLI package.
 *
 * The CLI itself (binary `bench`) is launched via {@link runCli} from
 * `bin/bench.ts`. This module re-exports the DSL primitives so users
 * writing `*.bench.ts` files can call them through this package, while
 * still exposing the underlying orchestration helpers from
 * `@computesdk/bench` for power users.
 */

import { BenchmarkReporter } from '@computesdk/bench';
import type { BenchmarkReporterConfig } from '@computesdk/bench';

export { bench, describe, DEFAULT_ITERATIONS, DEFAULT_WARMUP, getRegisteredBenchmarks } from './dsl';
export { loadBenchFile } from './loader';
export { discoverBenchFiles } from './discover';
export { runBenchmarks, runSingleBenchmark } from './runner';
export type { ProgressListener } from './runner';
export { createReporter, DefaultReporter, JsonReporter } from './reporter';
export type { ReporterOptions } from './reporter';
export { runCommand } from './run-command';
export type { RunCommandOptions } from './run-command';
export { listCommand } from './list-command';
export type { ListCommandOptions } from './list-command';
export { runCli, buildProgram } from './cli';
export type {
  BenchFn,
  BenchOptions,
  BenchRecordOptions,
  BenchmarkEntry,
  BenchmarkFileSummary,
  BenchmarkResult,
  RunOptions,
} from './types';

// Re-exports so power users can opt into the platform orchestrator
// from the same import path their benchmark files already use.
export {
  BenchmarkReporter,
  createBenchmarkClient,
  defineBench,
  defineStep,
  defineTask,
  defineWorker,
} from '@computesdk/bench';
export type {
  BenchDefinition,
  BenchmarkAssignment,
  BenchmarkClient,
  CreateRunInput,
  DefineBenchOptions,
  DefineStepOptions,
  DefinedStep,
  DefinedTask,
  DefineWorkerOptions,
  RunProgress,
  RunWorkerOptions,
  RunWorkerResult,
  TaskResultRecord,
  WorkerHeartbeatInput,
} from '@computesdk/bench';

/**
 * Convenience constructor that claims a benchmark reporter with the
 * same shape as `new BenchmarkReporter(cfg)` from `@computesdk/bench`.
 */
export function createBenchmarkReporter(config: BenchmarkReporterConfig) {
  return BenchmarkReporter.claim(config);
}
