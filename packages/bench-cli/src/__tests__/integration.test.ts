import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverBenchFiles } from '../discover';
import { runCommand } from '../run-command';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

describe('integration', () => {
  it('runs a benchmarks directory end-to-end', async () => {
    const sink = new PassThrough();
    const stdoutChunks: string[] = [];
    sink.on('data', (chunk) => stdoutChunks.push(chunk.toString()));
    const stdout = sink as unknown as NodeJS.WriteStream;

    const result = await runCommand([], {
      cwd: FIXTURES_DIR,
      reporter: 'default',
      iterations: 50,
      warmup: 2,
      stdout,
    });

    const combined = stdoutChunks.join('');
    expect(combined).toContain('bench');
    expect(combined).toContain('benchmark(s) passed');
    expect(result.files.length).toBeGreaterThanOrEqual(1);
    const totals = result.summaries.reduce(
      (acc, summary) => ({ pass: acc.pass + summary.pass, failed: acc.failed + summary.failed }),
      { pass: 0, failed: 0 },
    );
    expect(totals.failed).toBe(0);
    expect(totals.pass).toBeGreaterThan(0);
  });

  it('discovers *.bench.ts files nested in subdirectories', async () => {
    const files = await discoverBenchFiles([], { cwd: FIXTURES_DIR });
    expect(files.some((file) => path.basename(file) === 'strings.bench.ts')).toBe(true);
  });
});
