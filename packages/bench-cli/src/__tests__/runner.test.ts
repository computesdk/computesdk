import { describe, expect, it } from 'vitest';
import { runSingleBenchmark, runBenchmarks } from '../runner';
import type { BenchmarkEntry } from '../types';

function makeEntry(name: string, fn: () => unknown, overrides: Partial<BenchmarkEntry['options']> = {}): BenchmarkEntry {
  return {
    id: name,
    name,
    groups: [],
    file: 'memory',
    options: {
      iterations: overrides.iterations ?? 50,
      warmup: overrides.warmup ?? 5,
      setup: overrides.setup ?? (() => {}),
      teardown: overrides.teardown ?? (() => {}),
    },
    fn,
  };
}

describe('runner', () => {
  it('reports ops/sec for synchronous work', async () => {
    let calls = 0;
    const entry = makeEntry('count', () => {
      calls += 1;
    }, { iterations: 100, warmup: 5 });
    const result = await runSingleBenchmark(entry);
    expect(result.status).toBe('success');
    expect(result.iterations).toBe(100);
    expect(result.hz).toBeGreaterThan(0);
    expect(calls).toBe(105); // 5 warmup + 100 measured
  });

  it('captures failures with status="failed"', async () => {
    const entry = makeEntry('throws', () => {
      throw new Error('boom');
    }, { iterations: 4, warmup: 0 });
    const result = await runSingleBenchmark(entry);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('boom');
    expect(result.hz).toBe(0);
  });

  it('invokes setup and teardown hooks around the run', async () => {
    const calls: string[] = [];
    const entry = makeEntry('with hooks', () => undefined, {
      iterations: 4,
      warmup: 0,
      setup: () => {
        calls.push('setup');
      },
      teardown: () => {
        calls.push('teardown');
      },
    });
    await runSingleBenchmark(entry);
    expect(calls).toEqual(['setup', 'teardown']);
  });

  it('runBenchmarks stops on bail when a benchmark fails', async () => {
    const entries = [
      makeEntry('first', () => {
        throw new Error('first failed');
      }, { iterations: 2, warmup: 0 }),
      makeEntry('second', () => undefined, { iterations: 2, warmup: 0 }),
    ];
    const results = await runBenchmarks(entries, { bail: true });
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('failed');
  });
});
