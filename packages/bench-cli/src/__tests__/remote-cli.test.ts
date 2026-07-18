import { describe, expect, it } from 'vitest';
import { parseArgs } from '../cli';

describe('cli parser — remote flags', () => {
  it('parses --remote alone', () => {
    const parsed = parseArgs(['benchmarks/x.bench.ts', '--remote']);
    expect(parsed.remote).toBe(true);
    expect(parsed.files).toEqual(['benchmarks/x.bench.ts']);
  });

  it('parses the full remote flag set with both --flag and --flag=value forms', () => {
    const parsed = parseArgs([
      'benchmarks/x.bench.ts',
      '--remote',
      '--slug', 'my-slug',
      '--total=42',
      '--workers', '3',
      '--concurrency=2',
      '--participant=cli',
      '--api-key', 'k',
      '--base-url=https://example.test',
      '--poll-interval', '500',
      '--timeout=120',
    ]);
    expect(parsed.remote).toBe(true);
    expect(parsed.remoteOptions).toMatchObject({
      slug: 'my-slug',
      total: 42,
      workers: 3,
      concurrency: 2,
      participant: 'cli',
      apiKey: 'k',
      baseUrl: 'https://example.test',
      pollIntervalMs: 500,
      timeoutSeconds: 120,
    });
  });

  it('rejects unknown --remote subflag', () => {
    expect(() => parseArgs(['x.bench.ts', '--remote', '--no-such-flag', '1'])).toThrow(/unknown option/);
  });

  it('rejects non-positive values for positive flags', () => {
    expect(() => parseArgs(['x.bench.ts', '--remote', '--workers', '0'])).toThrow(/--workers must be a positive integer/);
    expect(() => parseArgs(['x.bench.ts', '--remote', '--concurrency=0'])).toThrow(/--concurrency must be a positive integer/);
  });
});
