import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBench } from '../runner';

const runIntegration = process.env.BENCH_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

async function waitForUpload(uploads: unknown[], timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (uploads.length === 0) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Benchmark ingest failed: SDK did not upload events');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describeIntegration('bench integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uploads SDK-generated benchmark events to the platform ingest endpoint', async () => {
    const endpoint = process.env.BENCHMARK_INGEST_URL ?? 'https://platform.computesdk.com/api/v1/events';
    const apiKey = process.env.BENCHMARK_INGEST_API_KEY;
    const realFetch = globalThis.fetch;

    if (!realFetch) {
      throw new Error('global fetch is required for benchmark ingest integration tests');
    }

    const uploads: Array<Promise<{ ok: boolean; status: number; body: string; url: string }>> = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      let resolveUpload: (result: { ok: boolean; status: number; body: string; url: string }) => void;
      const upload = new Promise<{ ok: boolean; status: number; body: string; url: string }>((resolve) => {
        resolveUpload = resolve;
      });
      uploads.push(upload);

      try {
        const response = await realFetch(input, init);
        const body = await response.clone().text().catch(() => '<no-body>');
        resolveUpload!({ ok: response.ok, status: response.status, body, url: String(input) });
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        resolveUpload!({ ok: false, status: 0, body: message, url: String(input) });
        throw error;
      }
    });

    const runId = [process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT, Date.now()]
      .filter(Boolean)
      .join('_');
    const logDir = await mkdtemp(join(tmpdir(), 'computesdk-bench-smoke-'));
    const logFile = join(logDir, 'run.log');

    try {
      await writeFile(logFile, '');

      const bench = createBench({
        label: 'ci.benchmark.ingest',
        apiUrl: endpoint,
        apiKey,
        batch: `ci_${runId}`,
        shard: { index: 0, count: 1 },
        captureOutput: { file: logFile },
      });

      bench.add('ci.benchmark.smoke', async (ctx) => {
        ctx.log('smoke iteration', ctx.iteration);
        await appendFile(logFile, `smoke output ${runId}\n`);
      });

      await bench.run({ iterations: 1, warmup: 0, provider: 'ci' });

      await waitForUpload(uploads);
      const results = await Promise.all(uploads);
      const failed = results.find((result) => !result.ok);

      expect(failed, failed ? `Benchmark ingest failed: ${failed.status} ${failed.body}` : undefined).toBeUndefined();
    } finally {
      await rm(logDir, { recursive: true, force: true });
    }
  }, 30000);
});
