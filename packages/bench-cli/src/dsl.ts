import type {
  BenchFn,
  BenchGlobal,
  BenchOptions,
  BenchRecordOptions,
  BenchmarkEntry,
} from './types';
import { getBenchGlobal } from './globals';

export const DEFAULT_ITERATIONS = 100;
export const DEFAULT_WARMUP = 5;

function resolveOptions(options: BenchOptions | undefined): BenchRecordOptions {
  return {
    iterations: options?.iterations ?? DEFAULT_ITERATIONS,
    warmup: options?.warmup ?? DEFAULT_WARMUP,
    setup: options?.setup ?? (() => {}),
    teardown: options?.teardown ?? (() => {}),
  };
}

function buildId(parts: string[], name: string): string {
  if (parts.length === 0) return name;
  return [...parts, name].join(' / ');
}

/**
 * Register a benchmark. The function may be sync or async; the runner
 * measures wall-clock time for each iteration regardless.
 *
 * @example
 * ```ts
 * bench('Array.sort', () => {
 *   [3, 1, 2].sort();
 * });
 * ```
 */
export function bench(name: string, fn: BenchFn, options?: BenchOptions): void {
  const global = getBenchGlobal();
  if (global.__currentFile === null) {
    throw new Error(
      `bench("${name}") was called outside of a benchmark file load context. ` +
        'The CLI must register the source file before executing the module.',
    );
  }
  const entry: BenchmarkEntry = {
    id: buildId(global.__currentGroup, name),
    name,
    groups: [...global.__currentGroup],
    file: global.__currentFile,
    options: resolveOptions(options),
    fn,
  };
  global.__registered.push(entry);
}

/**
 * Group subsequent {@link bench} calls under a parent name. Groups may
 * nest; the runner reports ids as `parent / child / name`.
 */
export function describe(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  const global = getBenchGlobal();
  global.__currentGroup.push(name);
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(() => {
        global.__currentGroup.pop();
      });
    }
    global.__currentGroup.pop();
  } catch (error) {
    global.__currentGroup.pop();
    throw error;
  }
}

/**
 * Internal: read the global registry shape. Useful for reporters.
 */
export function getRegisteredBenchmarks(global: BenchGlobal = getBenchGlobal()): readonly BenchmarkEntry[] {
  return global.__registered;
}
