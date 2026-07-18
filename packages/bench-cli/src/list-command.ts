import process from 'node:process';
import path from 'node:path';
import pc from 'picocolors';
import { discoverBenchFiles } from './discover';
import { loadBenchFile } from './loader';
import type { BenchmarkEntry } from './types';

export interface ListCommandOptions {
  cwd?: string;
}

export async function listCommand(inputs: readonly string[], options: ListCommandOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const files = await discoverBenchFiles(inputs, { cwd });
  if (files.length === 0) {
    process.stdout.write(
      pc.yellow('No benchmark files found ') +
        pc.dim('(looked for ') +
        pc.cyan('./benchmarks') +
        pc.dim(' / *.bench.ts etc.)') +
        '\n',
    );
    return;
  }

  let total = 0;
  for (const file of files) {
    const entries = await loadBenchFile(file).catch(() => [] as BenchmarkEntry[]);
    process.stdout.write(pc.cyan(pc.bold(path.relative(cwd, file))) + pc.dim('  (' + entries.length + ')\n'));
    for (const entry of entries) {
      total += 1;
      const label = entry.groups.length > 0 ? entry.groups.join(' › ') + ' › ' + entry.name : entry.name;
      process.stdout.write('  ' + pc.dim('• ') + label + '\n');
    }
  }
  process.stdout.write('\n' + pc.gray(`${total} benchmark(s) across ${files.length} file(s).`) + '\n');
}
