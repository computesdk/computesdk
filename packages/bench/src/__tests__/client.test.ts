import { describe, expect, it, vi } from 'vitest';
import { BenchmarkApiError, createBenchmarkClient, defineBench, defineStep, defineTask, defineWorker } from '../client';
import { createSystemMetricsCollector } from '../metrics';
import { BenchmarkReporter } from '../reporter';
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
    workerId: '00000000-0000-4000-8000-000000000002',
    workerIndex: 0,
    workerCount: 1,
    attemptId: '00000000-0000-4000-8000-000000000003',
    attemptNumber: 1,
    taskRange: { start: 10, end: 12, count: 3 },
    targetConcurrency: 2,
    config: {},
    ...overrides,
  };
}

function progressResponse() {
  return {
    run: { id: '00000000-0000-4000-8000-000000000001', status: 'running', totalTasks: 1, workerCount: 1 },
    summary: {
      status: 'in_progress',
      started: true,
      completed: false,
      participants: { planned: 0, inProgress: 1, completed: 0, failed: 0, total: 1 },
    },
    freshnessWindowSeconds: 15,
    generatedAt: new Date().toISOString(),
    participants: [{
      id: 'participant_1',
      slug: 'e2b',
      status: 'in_progress',
      totalTasks: 1,
      workerCount: 1,
      workers: { pending: 0, running: 1, completed: 0, failed: 0, stale: 0, total: 1 },
      tasks: { done: 0, inFlight: 1, errors: 0, total: 1, completionRatio: 0 },
      concurrency: [{ step: 'pause', active: 1, target: 1, ready: true, freshWorkerCount: 1 }],
    }],
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
          run: { id: 'run_1', benchmarkId: 'bench_1', status: 'planned', totalTasks: 100, workerCount: 10 },
          participants: [{ id: 'participant_1', benchmarkId: 'bench_1', runId: 'run_1', slug: 'e2b', status: 'planned', totalTasks: 100, workerCount: 10 }],
        }, 201);
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1/', apiKey: 'key_123', fetch: fetchMock as typeof fetch });

    await expect(client.upsertBenchmark('scale', { name: 'Scale', kind: 'scale' })).resolves.toMatchObject({ slug: 'scale' });
    await expect(client.createRun('scale', { totalTasks: 100, workerCount: 10, participants: ['e2b'] })).resolves.toMatchObject({
      run: { id: 'run_1' },
      participants: [{ slug: 'e2b' }],
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://platform.test/api/v1/benchmarks/scale');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer key_123' });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      totalTasks: 100,
      workerCount: 10,
      participants: ['e2b'],
    });
  });

  it('creates a run, plans workers, then claims a worker', async () => {
    const seen: Array<{ url: string; body: unknown; method?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers && !Array.isArray(init.headers) && !(init.headers instanceof Headers)
        ? init.headers as Record<string, string>
        : {};
      const contentType = headers['Content-Type'] ?? headers['content-type'];
      const body = init?.body && contentType === 'application/json'
        ? JSON.parse(String(init.body))
        : init?.body;
      seen.push({ url, body, method: init?.method });

      if (url.endsWith('/benchmarks/scale/runs') && init?.method === 'POST') {
        return jsonResponse({
          run: { id: 'run_1', benchmarkId: 'bench_1', status: 'planned', totalTasks: 100, workerCount: 10 },
          participants: [{ id: 'participant_1', benchmarkId: 'bench_1', runId: 'run_1', slug: 'e2b', status: 'planned', totalTasks: 100, workerCount: 10 }],
        }, 201);
      }
      if (url.endsWith('/benchmarks/scale/runs/run_1/participants/e2b/workers') && init?.method === 'POST') {
        return jsonResponse({ workers: [{ id: 'worker_1', workerIndex: 0, workerCount: 10, taskIndexStart: 0, taskIndexEnd: 9, targetConcurrency: 1, status: 'planned' }] });
      }
      if (url.endsWith('/benchmarks/scale/runs/run_1/participants/e2b/workers/claim') && init?.method === 'POST') {
        return jsonResponse({ assignment: assignment({ runId: 'run_1' }) });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const { run } = await client.createRun('scale', { totalTasks: 100, workerCount: 10, participants: ['e2b'] });
    await expect(client.planWorkers('scale', run.id, 'e2b')).resolves.toHaveLength(1);
    await expect(client.claimWorker('scale', run.id, 'e2b')).resolves.toMatchObject({ workerId: '00000000-0000-4000-8000-000000000002' });

    expect(seen.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
      'POST https://platform.test/api/v1/benchmarks/scale/runs',
      'POST https://platform.test/api/v1/benchmarks/scale/runs/run_1/participants/e2b/workers',
      'POST https://platform.test/api/v1/benchmarks/scale/runs/run_1/participants/e2b/workers/claim',
    ]);
  });

  it('updates orchestration resources through low-level PATCH endpoints', async () => {
    const seen: Array<{ url: string; body: unknown; method?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body && url.startsWith('https://platform.test/')
        ? JSON.parse(String(init.body))
        : init?.body;
      seen.push({ url, body, method: init?.method });

      if (url.endsWith('/benchmarks/scale') && init?.method === 'PATCH') {
        return jsonResponse({ benchmark: { id: 'bench_1', slug: 'scale', name: 'Scale v2', status: 'active' } });
      }
      if (url.endsWith('/benchmarks/scale/runs/run_1') && init?.method === 'PATCH') {
        return jsonResponse({ run: { id: 'run_1', benchmarkId: 'bench_1', status: 'in_progress', totalTasks: 100, workerCount: 10 } });
      }
      if (url.endsWith('/benchmarks/scale/runs/run_1/participants/e2b') && init?.method === 'PATCH') {
        return jsonResponse({ participant: { id: 'participant_1', benchmarkId: 'bench_1', runId: 'run_1', slug: 'e2b', status: 'in_progress', totalTasks: 100, workerCount: 10 } });
      }
      if (url.endsWith('/benchmarks/scale/runs/run_1/workers/worker_1') && init?.method === 'GET') {
        return jsonResponse({ worker: { id: 'worker_1', benchmarkId: 'bench_1', runId: 'run_1', participantId: 'participant_1', workerIndex: 0, workerCount: 10, taskIndexStart: 0, taskIndexEnd: 9, targetConcurrency: 10, status: 'running' } });
      }
      if (url.endsWith('/benchmarks/scale/runs/run_1/workers/worker_1') && init?.method === 'PATCH') {
        return jsonResponse({ worker: { id: 'worker_1', benchmarkId: 'bench_1', runId: 'run_1', participantId: 'participant_1', workerIndex: 0, workerCount: 10, taskIndexStart: 0, taskIndexEnd: 9, targetConcurrency: 10, status: 'running', progressDone: 5 } });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });

    await expect(client.updateBenchmark('scale', { name: 'Scale v2' })).resolves.toMatchObject({ name: 'Scale v2' });
    await expect(client.updateRun('scale', 'run_1', { status: 'in_progress' })).resolves.toMatchObject({ status: 'in_progress' });
    await expect(client.updateParticipant('scale', 'run_1', 'e2b', { status: 'in_progress' })).resolves.toMatchObject({ status: 'in_progress' });
    await expect(client.getWorker('scale', 'run_1', 'worker_1')).resolves.toMatchObject({ status: 'running' });
    await expect(client.updateWorker('scale', 'run_1', 'worker_1', { status: 'running', progressDone: 5 })).resolves.toMatchObject({ progressDone: 5 });

    expect(seen.map((entry) => [entry.method, entry.url, entry.body])).toMatchObject([
      ['PATCH', 'https://platform.test/api/v1/benchmarks/scale', { name: 'Scale v2' }],
      ['PATCH', 'https://platform.test/api/v1/benchmarks/scale/runs/run_1', { status: 'in_progress' }],
      ['PATCH', 'https://platform.test/api/v1/benchmarks/scale/runs/run_1/participants/e2b', { status: 'in_progress' }],
      ['GET', 'https://platform.test/api/v1/benchmarks/scale/runs/run_1/workers/worker_1', undefined],
      ['PATCH', 'https://platform.test/api/v1/benchmarks/scale/runs/run_1/workers/worker_1', { status: 'running', progressDone: 5 }],
    ]);
  });

  it('claims a worker and sends task_results batches', async () => {
    const seen: Array<{ url: string; body: unknown; method?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body && url.startsWith('https://platform.test/') ? JSON.parse(String(init.body)) : init?.body;
      seen.push({ url, body, method: init?.method });

      if (url.endsWith('/participants/e2b/workers/claim')) {
        return jsonResponse({ assignment: assignment() });
      }
      if (url.endsWith('/events')) {
        return jsonResponse({ eventBatch: { id: 'batch_1' }, queueMessageId: 'msg_1' }, 202);
      }
      if (url.endsWith('/complete')) {
        return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const result = await client.runWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      batchSize: 2,
      task: async ({ taskIndex, step }) => {
        const sandboxId = await step('create', () => `sbx_${taskIndex}`, { readiness: 'internal' });
        await step('exec.first-command', async () => undefined, { readiness: 'internal' });
        return { sandboxId };
      },
    });

    expect(result.records).toHaveLength(3);
    const eventCalls = seen.filter((entry) => entry.url.endsWith('/events'));
    const heartbeatCalls = seen.filter((entry) => entry.url.endsWith('/heartbeat'));
    expect(eventCalls).toHaveLength(2);
    expect(heartbeatCalls.some((entry) => (entry.body as any).concurrency?.some((sample: any) => sample.step === 'create'))).toBe(true);
    expect(eventCalls[0].body).toMatchObject({
      type: 'task_results',
      attemptId: '00000000-0000-4000-8000-000000000003',
      sequenceNumber: 0,
      isFinal: false,
    });
    expect((eventCalls[0].body as any).records).toHaveLength(2);
    expect((eventCalls[0].body as any).records[0].data).toMatchObject({ sandboxId: 'sbx_10' });
    expect((eventCalls[0].body as any).records[0].steps).toMatchObject([
      { name: 'create', status: 'success' },
      { name: 'exec.first-command', status: 'success' },
    ]);
    expect((eventCalls[0].body as any).records[0].steps[0].latencyMs).toEqual(expect.any(Number));
    expect((eventCalls[1].body as any).records).toHaveLength(1);
    expect(eventCalls.map((entry) => (entry.body as any).sequenceNumber)).toEqual([0, 1]);
    expect(eventCalls.map((entry) => (entry.body as any).isFinal)).toEqual([false, true]);
    expect(seen.at(-1)).toMatchObject({ method: 'POST' });
    expect(seen.at(-1)?.url).toContain('/complete');
  });

  it('omits currentStep from idle progress heartbeats', async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/heartbeat')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    await client.heartbeatWorker('scale', 'run_1', 'worker_1', {
      attemptId: 'attempt_1',
      progressDone: 0,
      progressInFlight: 0,
      progressErrors: 0,
      progressTotal: 1,
      currentStep: null,
      concurrency: [],
    });

    expect(seen[0].body).not.toHaveProperty('currentStep');
    expect(seen[0].body).toMatchObject({ attemptId: 'attempt_1', concurrency: [] });
  });

  it('validates worker execution settings before processing tasks', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ targetConcurrency: 0 }) });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    await expect(client.runWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      task: async () => undefined,
    })).rejects.toThrow('concurrency');
    await expect(client.runWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      concurrency: 1,
      batchSize: 5001,
      task: async () => undefined,
    })).rejects.toThrow('batchSize');
  });

  it('fails the worker when any task fails', async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 } }) });
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/fail')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const result = await client.runWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      task: async ({ step }) => {
        await step('create', () => {
          throw new TypeError('boom');
        }, { readiness: 'internal' });
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
      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 } }) });
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/complete')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const task = defineTask('sandbox.lifecycle', [
        defineStep('create', { readiness: 'internal' }, ({ state }) => {
          state.sandboxId = 'sbx_0';
        }),
        defineStep('exec.first-command', { readiness: 'internal' }, ({ state }) => ({ sandboxId: String(state.sandboxId) })),
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

  it('runs defined task cleanup after a step fails', async () => {
    const cleaned: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 } }) });
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/fail')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const task = defineTask('sandbox.lifecycle', [
      defineStep('create', ({ state }) => {
        state.sandboxId = 'sbx_0';
      }),
      defineStep('exec.first-command', () => {
        throw new TypeError('command failed');
      }),
    ], {
      cleanup: ({ state }) => {
        cleaned.push(String(state.sandboxId));
      },
    });

    const result = await client.runWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      task,
    });

    expect(cleaned).toEqual(['sbx_0']);
    expect(result.records[0]).toMatchObject({ status: 'error', errorCode: 'TypeError' });
    expect(result.records[0].steps).toMatchObject([
      { name: 'create', status: 'success' },
      { name: 'exec.first-command', status: 'error', errorCode: 'TypeError' },
    ]);
  });

  it('preserves the step error when cleanup also fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 } }) });
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/fail')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const task = defineTask('cleanup-after-step-failure', [
      defineStep('create', () => {
        throw new TypeError('create failed');
      }),
    ], {
      cleanup: () => {
        throw new Error('destroy failed');
      },
    });

    const result = await client.runWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      task,
    });

    expect(result.records[0]).toMatchObject({ status: 'error', errorCode: 'TypeError' });
    expect(result.records[0].data).toMatchObject({ errorMessage: 'create failed' });
    expect(result.records[0].steps).toMatchObject([{ name: 'create', status: 'error', errorCode: 'TypeError' }]);
  });

  it('fails a defined task when cleanup fails after successful steps', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 } }) });
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/fail')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const task = defineTask('cleanup-failure', [
      defineStep('create', () => ({ sandboxId: 'sbx_0' })),
    ], {
      cleanup: () => {
        throw new Error('destroy failed');
      },
    });

    const result = await client.runWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      task,
    });

    expect(result.records[0]).toMatchObject({ status: 'error', errorCode: 'Error' });
    expect(result.records[0].data).toMatchObject({ errorMessage: 'destroy failed' });
    expect(result.records[0].steps).toMatchObject([{ name: 'create', status: 'success' }]);
  });

  it('rejects duplicate defined task step names', () => {
    expect(() => defineTask('duplicate-steps', [
      defineStep('pause', () => undefined),
      defineStep('pause', () => undefined),
    ])).toThrow('unique');
  });

  it('waits for platform step readiness before running a step body', async () => {
    const order: string[] = [];
    const seen: Array<{ url: string; body: unknown; method?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      seen.push({ url, body, method: init?.method });

      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 }, targetConcurrency: 1 }) });
      if (url.endsWith('/progress')) {
        order.push('progress');
        return jsonResponse(progressResponse());
      }
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/complete')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      if (url.endsWith('/heartbeat')) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    await defineWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      client,
      task: defineTask('pause-task', [
        defineStep('pause', { readiness: 'poll', readyPollIntervalMs: 1 }, () => {
          order.push('step');
        }),
      ]),
    }).run();

    expect(order).toEqual(['progress', 'step']);
    expect(seen.some((entry) => entry.url.endsWith('/heartbeat') && (entry.body as any).currentStep === 'pause')).toBe(true);
    expect(seen.some((entry) => entry.url.endsWith('/heartbeat') && (entry.body as any).concurrency?.[0]?.target === 1)).toBe(true);
  });

  it('deduplicates readiness polling across concurrent tasks for the same step', async () => {
    const order: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 4, count: 5 }, targetConcurrency: 5 }) });
      if (url.endsWith('/progress')) {
        order.push('progress');
        await new Promise((resolve) => setTimeout(resolve, 1));
        return jsonResponse(progressResponse());
      }
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/complete')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      if (url.endsWith('/heartbeat')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    await client.runWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      task: defineTask('dedupe-readiness', [
        defineStep('pause', { readiness: 'poll', readyPollIntervalMs: 1 }, () => undefined),
      ]),
    });

    expect(order).toEqual(['progress']);
  });

  it('caps heartbeat concurrency samples to the platform limit', async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 }, targetConcurrency: 1 }) });
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/complete')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      if (url.endsWith('/heartbeat')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    await client.runWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      task: async ({ taskIndex, step }) => {
        await Promise.all(Array.from({ length: 25 }, (_, index) => (
          step(`step-${index}`, () => new Promise((resolve) => setTimeout(resolve, 5)))
        )));
      },
    });

    const heartbeat = seen.find((entry) => entry.url.endsWith('/heartbeat') && (entry.body as any).concurrency?.length === 20);
    expect(heartbeat).toBeDefined();
    expect((heartbeat?.body as any).concurrency).toHaveLength(20);
    expect((heartbeat?.body as any).currentStep).toBe('step-0');
  });

  it('only polls progress for explicitly polled steps', async () => {
    const order: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 }, targetConcurrency: 1 }) });
      if (url.endsWith('/progress')) {
        order.push('progress');
        return jsonResponse(progressResponse());
      }
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/complete')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      if (url.endsWith('/heartbeat')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    await defineWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      client,
      task: defineTask('mixed-readiness', [
        defineStep('create', () => {
          order.push('create');
        }),
        defineStep('pause', { readiness: 'poll', readyPollIntervalMs: 1 }, () => {
          order.push('pause');
        }),
        defineStep('destroy', () => {
          order.push('destroy');
        }),
      ]),
    }).run();

    expect(order).toEqual(['create', 'progress', 'pause', 'destroy']);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/progress'))).toHaveLength(1);
  });

  it('returns run progress summaries', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/progress')) return jsonResponse(progressResponse());
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const progress = await client.getRunProgress('scale', '00000000-0000-4000-8000-000000000001');

    expect(progress.summary).toMatchObject({
      status: 'in_progress',
      started: true,
      completed: false,
      participants: { planned: 0, inProgress: 1, completed: 0, failed: 0, total: 1 },
    });
    expect(progress.participants[0]).toMatchObject({
      status: 'in_progress',
      workers: { pending: 0, running: 1, completed: 0, failed: 0, stale: 0, total: 1 },
      tasks: { done: 0, inFlight: 1, errors: 0, total: 1, completionRatio: 0 },
    });
  });

  it('validates task result and heartbeat platform limits before sending', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });

    await expect(client.sendTaskResults({
      benchmarkSlug: 'scale',
      runId: 'run_1',
      workerId: 'worker_1',
      attemptId: 'attempt_1',
      sequenceNumber: 0,
      isFinal: false,
      records: Array.from({ length: 5001 }, (_, taskIndex) => ({ taskIndex, status: 'success' })),
    })).rejects.toThrow('5000');

    await expect(client.sendTaskResults({
      benchmarkSlug: 'scale',
      runId: 'run_1',
      workerId: 'worker_1',
      attemptId: 'attempt_1',
      sequenceNumber: 0,
      isFinal: false,
      records: [{
        taskIndex: 1,
        status: 'success',
        steps: Array.from({ length: 101 }, (_, index) => ({ name: `step-${index}`, status: 'success' as const })),
      }],
    })).rejects.toThrow('100');

    await expect(client.heartbeatWorker('scale', 'run_1', 'worker_1', {
      attemptId: 'attempt_1',
      concurrency: Array.from({ length: 21 }, (_, index) => ({ step: `step-${index}`, active: 1, target: 1 })),
    })).rejects.toThrow('20');

    await expect(client.heartbeatWorker('scale', 'run_1', 'worker_1', {
      attemptId: 'attempt_1',
      concurrency: [
        { step: 'pause', active: 1, target: 1 },
        { step: 'pause', active: 2, target: 2 },
      ],
    })).rejects.toThrow('unique');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes documented artifact, result, and release endpoints', async () => {
    const seen: Array<{ url: string; body: unknown; method?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body && url.startsWith('https://platform.test/') ? JSON.parse(String(init.body)) : init?.body;
      seen.push({ url, body, method: init?.method });

      if (url.endsWith('/workers/worker_1/artifacts') && init?.method === 'POST') {
        return jsonResponse({ artifactId: 'artifact_1', uploadUrl: 'https://upload.test', objectKey: 'benchmarks/bench_1/runs/run_1/artifacts/artifact_1' });
      }
      if (url === 'https://upload.test' && init?.method === 'PUT') {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith('/runs/run_1/artifacts') && init?.method === 'GET') {
        return jsonResponse({ artifacts: [{ artifactId: 'artifact_1', kind: 'coordinator.log' }] });
      }
      if (url.endsWith('/workers/worker_1/artifacts') && init?.method === 'GET') {
        return jsonResponse({ items: [{ artifactId: 'artifact_2', kind: 'meta.json' }] });
      }
      if (url.endsWith('/benchmarks/scale/results?limit=5') && init?.method === 'GET') {
        return jsonResponse({
          benchmark: { id: 'bench_1', slug: 'scale', name: 'Scale' },
          generatedAt: new Date().toISOString(),
          analytics: { status: 'complete', query: 'unavailable', error: 'Timeout error.' },
          items: [{
            run: { id: 'run_1' },
            analytics: { status: 'complete', eventBatches: 1, persisted: 1, queued: 0, failed: 0, imports: { pending: 0, importing: 0, imported: 1, failed: 0, missing: 0 } },
            participants: [],
          }],
        });
      }
      if (url.endsWith('/runs/run_1/results') && init?.method === 'GET') {
        return jsonResponse({ benchmark: { id: 'bench_1', slug: 'scale', name: 'Scale' }, run: { id: 'run_1', status: 'completed', totalTasks: 1, workerCount: 1 }, generatedAt: new Date().toISOString(), overall: { taskCount: 1 }, participants: [], steps: [] });
      }
      if (url.endsWith('/runs/run_1/results/tasks?bucketSize=10&failureLimit=2') && init?.method === 'GET') {
        return jsonResponse({ run: { id: 'run_1' }, generatedAt: new Date().toISOString(), bucketSize: 10, buckets: [], failures: [] });
      }
      if (url.endsWith('/runs/run_1/results/timeline?bucketMs=1000') && init?.method === 'GET') {
        return jsonResponse({ run: { id: 'run_1' }, generatedAt: new Date().toISOString(), eventRate: { bucketMs: 1000, buckets: [] }, concurrency: { firstRecordedAt: null, heartbeatCount: 0, points: [] } });
      }
      if (url.endsWith('/runs/run_1/results/imports') && init?.method === 'GET') {
        return jsonResponse({ run: { id: 'run_1' }, generatedAt: new Date().toISOString(), summary: { eventBatches: 0, persisted: 0, queued: 0, failed: 0, imports: { pending: 0, importing: 0, imported: 0, failed: 0, missing: 0 } }, items: [] });
      }
      if (url.endsWith('/release') && init?.method === 'POST') {
        return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });

    await expect(client.createWorkerArtifact('scale', 'run_1', 'worker_1', {
      attemptId: 'attempt_1',
      kind: 'coordinator.log',
      contentType: 'text/plain',
    })).resolves.toMatchObject({ artifactId: 'artifact_1' });
    await expect(client.uploadWorkerArtifact('scale', 'run_1', 'worker_1', {
      attemptId: 'attempt_1',
      kind: 'log',
      name: 'coordinator.log',
      contentType: 'text/plain; charset=utf-8',
      body: 'hello log\n',
    })).resolves.toMatchObject({ artifactId: 'artifact_1' });
    expect((seen[1].body as any).metadata).toMatchObject({ sizeBytes: 10 });
    await expect(client.listRunArtifacts('scale', 'run_1')).resolves.toMatchObject([{ artifactId: 'artifact_1' }]);
    await expect(client.listWorkerArtifacts('scale', 'run_1', 'worker_1')).resolves.toMatchObject([{ artifactId: 'artifact_2' }]);
    await expect(client.getBenchmarkResults('scale', { limit: 5 })).resolves.toMatchObject({
      benchmark: { slug: 'scale' },
      analytics: { status: 'complete', query: 'unavailable' },
      items: [{ analytics: { status: 'complete' }, participants: [] }],
    });
    await expect(client.getRunResults('scale', 'run_1')).resolves.toMatchObject({ run: { id: 'run_1' }, participants: [], steps: [] });
    await expect(client.getRunTaskResults('scale', 'run_1', { bucketSize: 10, failureLimit: 2 })).resolves.toMatchObject({ bucketSize: 10, buckets: [], failures: [] });
    await expect(client.getRunTimeline('scale', 'run_1', { bucketMs: 1000 })).resolves.toMatchObject({ eventRate: { bucketMs: 1000 }, concurrency: { points: [] } });
    await expect(client.getRunImports('scale', 'run_1')).resolves.toMatchObject({ summary: { eventBatches: 0 }, items: [] });
    await expect(client.releaseWorker('scale', 'run_1', 'worker_1', 'attempt_1')).resolves.toMatchObject({ worker: { id: 'worker_1' } });

    expect(seen.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
      'POST https://platform.test/api/v1/benchmarks/scale/runs/run_1/workers/worker_1/artifacts',
      'POST https://platform.test/api/v1/benchmarks/scale/runs/run_1/workers/worker_1/artifacts',
      'PUT https://upload.test',
      'GET https://platform.test/api/v1/benchmarks/scale/runs/run_1/artifacts',
      'GET https://platform.test/api/v1/benchmarks/scale/runs/run_1/workers/worker_1/artifacts',
      'GET https://platform.test/api/v1/benchmarks/scale/results?limit=5',
      'GET https://platform.test/api/v1/benchmarks/scale/runs/run_1/results',
      'GET https://platform.test/api/v1/benchmarks/scale/runs/run_1/results/tasks?bucketSize=10&failureLimit=2',
      'GET https://platform.test/api/v1/benchmarks/scale/runs/run_1/results/timeline?bucketMs=1000',
      'GET https://platform.test/api/v1/benchmarks/scale/runs/run_1/results/imports',
      'POST https://platform.test/api/v1/benchmarks/scale/runs/run_1/workers/worker_1/release',
    ]);
  });

  it('reports custom coordinator progress, barriers, artifacts, and finish best-effort', async () => {
    const seen: Array<{ url: string; body: unknown; method?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body && url.startsWith('https://platform.test/') ? JSON.parse(String(init.body)) : init?.body;
      seen.push({ url, body, method: init?.method });

      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 5, end: 7, count: 2 }, targetConcurrency: 2 }) });
      if (url.endsWith('/heartbeat')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      if (url.endsWith('/progress')) return jsonResponse(progressResponse());
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/workers/00000000-0000-4000-8000-000000000002/artifacts')) return jsonResponse({ artifactId: 'artifact_1', uploadUrl: 'https://upload.test' });
      if (url === 'https://upload.test') return new Response(null, { status: 200 });
      if (url.endsWith('/complete')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const reporter = await BenchmarkReporter.claim({
      baseUrl: 'https://platform.test/api/v1',
      fetch: fetchMock as typeof fetch,
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      batchSize: 1,
    });

    expect(reporter).not.toBeNull();
    if (!reporter) return;

    reporter.setProgress({ done: 0, inFlight: 1, errors: 0 });
    reporter.recordResult({ taskIndex: 5, status: 'success', latencyMs: 1 });
    await reporter.waitForStepReady({ step: 'pause', timeoutMs: 100, pollIntervalMs: 1 });
    await expect(reporter.uploadArtifact({ kind: 'log', name: 'coordinator.log', body: 'log\n' })).resolves.toMatchObject({ artifactId: 'artifact_1' });
    await reporter.finish(false);

    expect(seen.some((entry) => entry.url.endsWith('/heartbeat') && (entry.body as any).currentStep === 'pause')).toBe(true);
    expect(seen.some((entry) => entry.url.endsWith('/events') && (entry.body as any).records?.[0]?.taskIndex === 5)).toBe(true);
    expect(seen.some((entry) => entry.url === 'https://upload.test' && entry.method === 'PUT')).toBe(true);
    expect(seen.at(-1)?.url).toContain('/complete');
  });

  it('keeps reporter result batches queued when send fails', async () => {
    const sentSequences: number[] = [];
    let sendAttempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body && url.startsWith('https://platform.test/') ? JSON.parse(String(init.body)) : init?.body;

      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 5, end: 7, count: 2 }, targetConcurrency: 2 }) });
      if (url.endsWith('/events')) {
        sendAttempts += 1;
        sentSequences.push((body as any).sequenceNumber);
        if (sendAttempts === 1) return new Response('temporary failure', { status: 503 });
        return jsonResponse({ eventBatch: { id: `batch_${sendAttempts}` } }, 202);
      }
      if (url.endsWith('/complete')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const reporter = await BenchmarkReporter.claim({
      baseUrl: 'https://platform.test/api/v1',
      fetch: fetchMock as typeof fetch,
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      batchSize: 1,
    });

    expect(reporter).not.toBeNull();
    if (!reporter) return;

    reporter.recordResult({ taskIndex: 5, status: 'success', latencyMs: 1 });
    await reporter.finish(false);

    expect(sentSequences).toEqual([0, 0]);
  });

  it('samples system metrics for coordinator artifacts', () => {
    const collector = createSystemMetricsCollector();
    const sample = collector.sample();
    collector.stop();

    expect(sample.ts).toEqual(expect.any(String));
    expect(sample.uptimeMs).toEqual(expect.any(Number));
    expect(sample.memRssMb).toBeGreaterThan(0);
    expect(sample.eventLoopP99Ms).toEqual(expect.any(Number));
  });

  it('runs worker finish hooks before completing the worker', async () => {
    const seen: Array<{ url: string; body: unknown; method?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body && url.startsWith('https://platform.test/') ? JSON.parse(String(init.body)) : init?.body;
      seen.push({ url, body, method: init?.method });

      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 } }) });
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/workers/00000000-0000-4000-8000-000000000002/artifacts')) return jsonResponse({ artifactId: 'artifact_1', uploadUrl: 'https://upload.test' });
      if (url === 'https://upload.test') return new Response(null, { status: 200 });
      if (url.endsWith('/complete')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    await client.runWorker({
      benchmarkSlug: 'scale',
      runId: '00000000-0000-4000-8000-000000000001',
      participantSlug: 'e2b',
      task: () => ({ ok: true }),
      onFinish: async ({ status, uploadArtifact }) => {
        expect(status).toBe('success');
        await uploadArtifact({ kind: 'log', name: 'worker.log', body: 'worker log\n' });
      },
    });

    const urls = seen.map((entry) => `${entry.method} ${entry.url}`);
    expect(urls.indexOf('PUT https://upload.test')).toBeLessThan(urls.findIndex((url) => url.includes('/complete')));
  });

  it('creates workers from a reusable bench definition', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/participants/e2b/workers/claim')) return jsonResponse({ assignment: assignment({ taskRange: { start: 0, end: 0, count: 1 } }) });
      if (url.endsWith('/events')) return jsonResponse({ eventBatch: { id: 'batch_1' } }, 202);
      if (url.endsWith('/complete')) return jsonResponse({ worker: { id: 'worker_1' }, attempt: { id: 'attempt_1' } });
      throw new Error(`unexpected request: ${url}`);
    });

    const client = createBenchmarkClient({ baseUrl: 'https://platform.test/api/v1', fetch: fetchMock as typeof fetch });
    const bench = defineBench({
      slug: 'scale',
      participantSlug: 'e2b',
      client,
      task: defineTask('noop', [defineStep('step', { readiness: 'internal' }, () => ({ ok: true }))]),
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
