import path from 'node:path';
import process from 'node:process';
import { discoverBenchFiles } from './discover';
import { loadBenchFile } from './loader';
import { runBenchmarks } from './runner';
import { createReporter } from './reporter';
import type { BenchmarkEntry, BenchmarkFileSummary, RunOptions } from './types';

export interface RunCommandOptions extends RunOptions {
  cwd?: string;
  /** Override the writer for the reporter. Useful for tests. */
  stdout?: NodeJS.WritableStream;
  /** Generate a list of files that would be run, then exit. */
  dryRun?: boolean;
}

export async function runCommand(
  inputs: readonly string[],
  options: RunCommandOptions = {},
): Promise<{ files: readonly string[]; summaries: readonly BenchmarkFileSummary[] }> {
  const cwd = options.cwd ?? process.cwd();
  const files = await discoverBenchFiles(inputs, { cwd });
  const reporter = createReporter({
    format: options.reporter ?? 'default',
    ...(options.stdout ? { stdout: options.stdout } : {}),
  });

  reporter.onStart(options, files);

  const summaries: BenchmarkFileSummary[] = [];
  for (const file of files) {
    const entries = await collectBenchEntries(file);
    const results = await runBenchmarks(entries, options, reporter.onProgress);
    summaries.push(summarize(file, results));
  }

  reporter.onFinish(summaries);
  return { files, summaries };
}

async function collectBenchEntries(file: string): Promise<BenchmarkEntry[]> {
  try {
    return await loadBenchFile(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      syntheticFailure(file, message),
    ];
  }
}

function syntheticFailure(file: string, message: string): BenchmarkEntry {
  return {
    id: '<load>',
    name: '<load>',
    groups: [],
    file,
    options: { iterations: 0, warmup: 0, setup: () => {}, teardown: () => {} },
    fn: () => {
      throw new Error(message);
    },
  };
}

function summarize(file: string, results: Array<{ status: 'success' | 'failed' | 'skipped'; totalMs: number }>): BenchmarkFileSummary {
  let pass = 0;
  let failed = 0;
  let totalMs = 0;
  for (const result of results) {
    if (result.status === 'success') pass += 1;
    if (result.status === 'failed') failed += 1;
    totalMs += result.totalMs;
  }
  return {
    file: path.resolve(file),
    results: results as BenchmarkFileSummary['results'],
    totalMs,
    pass,
    failed,
  };
}
