import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import type { BenchmarkEntry } from './types';
import { getBenchGlobal, resetBenchGlobal } from './globals';

/**
 * Load a benchmark file by dynamic-importing it with tsx, capturing all
 * `bench()` and `describe()` calls into a fresh per-file registry.
 */
export async function loadBenchFile(file: string): Promise<BenchmarkEntry[]> {
  const absolute = path.resolve(file);
  resetBenchGlobal(absolute);
  try {
    await tsImport(absolute, pathToFileURL(absolute).href);
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    throw new Error(`Failed to load benchmark file ${absolute}: ${message}`);
  }
  const global = getBenchGlobal();
  if (global.__currentFile !== absolute) {
    global.__currentFile = absolute;
  }
  return global.__registered.slice();
}
