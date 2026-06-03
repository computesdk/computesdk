import { describe, expect, it, vi } from 'vitest';
import { BenchmarkApiError, createBenchmarkClient, defineBench, defineStep, defineTask, defineWorker } from '../client';
import type { BenchmarkAssignment } from '../types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function assignment(overrides: Partial<BenchmarkAssignment> = {}): BenchmarkAssignment {
  return {
    benchmarkId: 'bench_1',
    benchmarkSlug: 'scale',
    runId: '00000000-0000-4000-8000-000000000001',
    participantId: 'participant_1',
    participantSlug: 'e2b',
    provider: 'e2b',
    shardId: '00000000-0000-4000-8000-000000000002',
    shardIndex: 0,
    shardCount: 1,
    attemptId: '00000000-0000-4000-8000-000000000003',
    attemptNumber: 1,
    taskRange: { start: 10, end: 12, count: 3 },
    targetConcurrency: 2,
    config: {},
    ...overrides,
  };
}

describe('createBenchmarkClient', () => {
  it('calls benchmark and run orchestration endpoints', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/benchmarks/scale') && init?.method === 'PUT') {
        return jsonResponse({ benchmark: { id: 'bench_1', slug: 'scale', name: 'Scale' } });
      }
      if (url.endsWith('/benchmarks/scale/runs') && init?.method === 'POST') {
        return jsonResponse({
          run: { id: 'run_1', benchmarkId: 'bench_1', status: 'planned', totalTasks: 100, shardCount: 10 },
          participants: [{ id: 'participant_1', benchmarkId: 'bench_1', runId: 'run_1', slug: 'e2b', status: 'planned', totalTasks: 100, shardCount: 10 }],
        }, 201);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1/', apiKey: 'key_123', fetch: fetchMock as typeof fetch });

    await expect(client.upsertBenchmark('scale', { name: 'Scale', kind: 'scale' })).resolves.toMatchObject({ slug: 'scale' });
    await expect(client.createRun('scale', { totalTasks: 100, shardCount: 10, participants: ['e2b'] })).resolves.toMatchObject({
      run: { id: 'run_1' },
      participants: [{ slug: 'e2b' }],
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://platform.test/api/v1/benchmarks/scale');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer key_123' });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      totalTasks: 100,
      shardCount: 10,
      participants: ['e2b'],
    });
  });

  it('claims a shard and sends task_results batches', async () => {
    const seen: Array<{ url: string; body: unknown; method?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      seen.push({ url, body, method: init?.method });

      if (url.endsWith('/participants/e2b/shards/claim')) {
        return jsonResponse({ assignment: assignment() });
      }
      if (url.endsWith('/events')) {
        return jsonResponse({ eventBatch: { id: 'batch_1' }, queueMessageId: 'msg_1' }, 202);
      }
      if (url.endsWith('/complete')) {
        return jsonResponse({ shard: { id: 'shard_1' }, attempt: { id: 'attempt_1' } });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const result = await client.runShard({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      batchSize: 2,
      task: async ({ taskIndex, step }) => {
        const sandboxId = await step('create', () => `sbx_${taskIndex}`);
        await step('exec.first-command', async () => undefined);
        return { sandboxId };
      },
    });

    expect(result.records).toHaveLength(3);
    expect(seen.filter((entry) => entry.url.endsWith('/events'))).toHaveLength(2);
    expect(seen[1].body).toMatchObject({
      type: 'task_results',
      attemptId: '00000000-0000-4000-8000-000000000003',
      sequenceNumber: 0,
      isFinal: false,
    });
    expect((seen[1].body as any).records).toHaveLength(2);
    expect((seen[1].body as any).records[0].data).toMatchObject({ sandboxId: 'sbx_10' });
    expect((seen[1].body as any).records[0].steps).toMatchObject([
      { name: 'create', status: 'success' },
      { name: 'exec.first-command', status: 'success' },
    ]);
    expect((seen[1].body as any).records[0].steps[0].latencyMs).toEqual(expect.any(Number));
    expect((seen[2].body as any).records).toHaveLength(1);
    expect(seen.at(-1)).toMatchObject({ method: 'POST' });
    expect(seen.at(-1)?.url).toContain('/complete');
  });

  it('fails the shard when any task fails', async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/participants/e2b/shards/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 } }) });
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/fail')) return jsonResponse({ shard: { id: 'shard_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const result = await client.runShard({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      task: async ({ step }) => {
        await step('create', () => {
          throw new TypeError('boom');
        });
      },
    });

    expect(result.records[0]).toMatchObject({ status: 'error', errorCode: 'TypeError' });
    expect(result.records[0].data).toMatchObject({
      errorMessage: 'boom',
    });
    expect(result.records[0].steps).toMatchObject([{ name: 'create', status: 'error', errorCode: 'TypeError' }]);
    expect(seen.at(-1)?.url).toContain('/fail');
    expect(seen.at(-1)?.body).toMatchObject({ errorMessage: 'One or more tasks failed' });
  });

  it('runs a defined worker task with ordered steps', async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/participants/e2b/shards/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 } }) });
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/complete')) return jsonResponse({ shard: { id: 'shard_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const task = defineTask('sandbox.lifecycle', [
      defineStep('create', ({ state }) => {
        state.sandboxId = 'sbx_0';
      }),
      defineStep('exec.first-command', ({ state }) => ({ sandboxId: String(state.sandboxId) })),
    ]);
    const worker = defineWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      client,
      task,
    });

    const result = await worker.run();
    expect(result.records[0].data).toMatchObject({ taskName: 'sandbox.lifecycle', sandboxId: 'sbx_0' });
    expect(result.records[0].steps).toMatchObject([
      { name: 'create', status: 'success' },
      { name: 'exec.first-command', status: 'success' },
    ]);
  });

  it('creates workers from a reusable bench definition', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/participants/e2b/shards/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 } }) });
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/complete')) return jsonResponse({ shard: { id: 'shard_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const bench = defineBench({
      slug: 'scale',
      participantSlug: 'e2b',
      client,
      task: defineTask('noop', [defineStep('step', () => ({ ok: true }))]),
    });

    const result = await bench.defineWorker({
      runId: '00000000-0000-4000-8000-000000000001',
      concurrency: 1,
    }).run();

    expect(result.assignment?.benchmarkSlug).toBe('scale');
    expect(result.records[0].data).toMatchObject({ taskName: 'noop', ok: true });
  });

  it('throws BenchmarkApiError for non-ok responses', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500, statusText: 'Server Error' }));
    const client = createBenchmarkClient({ fetch: fetchMock as typeof fetch });

    await expect(client.getBenchmark('scale')).rejects.toBeInstanceOf(BenchmarkApiError);
    await expect(client.getBenchmark('scale')).rejects.toMatchObject({ status: 500, body: 'nope' });
  });
});
