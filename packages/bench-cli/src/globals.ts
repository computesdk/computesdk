import type { BenchGlobal } from './types';

declare global {
  // eslint-disable-next-line no-var
  var __BENCH_GLOBAL__: BenchGlobal | undefined;
}

export function resetBenchGlobal(file: string | null = null): BenchGlobal {
  const next: BenchGlobal = {
    __registered: [],
    __currentGroup: [],
    __currentFile: file,
  };
  globalThis.__BENCH_GLOBAL__ = next;
  return next;
}

export function getBenchGlobal(): BenchGlobal {
  return globalThis.__BENCH_GLOBAL__ ?? resetBenchGlobal();
}

export function setCurrentBenchFile(file: string): BenchGlobal {
  const global = getBenchGlobal();
  global.__currentFile = file;
  global.__currentGroup = [];
  return global;
}
