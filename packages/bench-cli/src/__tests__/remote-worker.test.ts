import { describe, expect, it } from 'vitest';
import { readWorkerConfig } from '../remote-worker';

describe('remote-worker config parser', () => {
  it('reads required env vars and parses positive integers', () => {
    const cfg = readWorkerConfig({
      BENCH_CLI_REMOTE_SLUG: 'my-bench',
      BENCH_CLI_REMOTE_RUN_ID: 'run-123',
      BENCH_CLI_REMOTE_PARTICIPANT: 'bench-cli',
      BENCH_CLI_REMOTE_TOTAL: '50',
      BENCH_CLI_REMOTE_BENCH_COUNT: '4',
      BENCH_CLI_REMOTE_CONCURRENCY: '2',
      BENCH_CLI_REMOTE_WORKER_KEY: 'k',
      BENCH_CLI_REMOTE_API_KEY: 'secret',
      BENCH_CLI_REMOTE_BASE_URL: 'https://example.test',
    });
    expect(cfg).toMatchObject({
      slug: 'my-bench',
      runId: 'run-123',
      participant: 'bench-cli',
      total: 50,
      benchCount: 4,
      concurrency: 2,
      workerKey: 'k',
      apiKey: 'secret',
      baseUrl: 'https://example.test',
    });
  });

  it('throws when required env vars are missing', () => {
    expect(() => readWorkerConfig({})).toThrow(/BENCH_CLI_REMOTE_SLUG/);
    expect(() =>
      readWorkerConfig({
        BENCH_CLI_REMOTE_SLUG: 'x',
        BENCH_CLI_REMOTE_RUN_ID: 'y',
        BENCH_CLI_REMOTE_PARTICIPANT: 'z',
        BENCH_CLI_REMOTE_TOTAL: '0',
        BENCH_CLI_REMOTE_BENCH_COUNT: '1',
        BENCH_CLI_REMOTE_CONCURRENCY: '1',
      }),
    ).toThrow(/BENCH_CLI_REMOTE_TOTAL/);
  });
});
