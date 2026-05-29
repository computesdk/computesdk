import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBench } from '../runner';
import type { BenchEvent } from '../types';

describe('createBench', () => {
  beforeEach(() => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs a task set and returns per-task stats', async () => {
    const events: BenchEvent[] = [];
    const bench = createBench({
      label: 'test-suite',
      onEvent: (event) => events.push(event),
    });

    bench.add('op-one', async () => {
      await Promise.resolve();
    });
    bench.add('op-two', async () => {
      await Promise.resolve();
    });

    const result = await bench.run({ iterations: 5, warmup: 1, provider: 'e2b' });

    expect(result.label).toBe('test-suite');
    expect(result.runId).toMatch(/^run_/);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].taskName).toBe('op-one');
    expect(result.tasks[0].successes).toBe(5);
    expect(result.tasks[0].stats.count).toBe(5);
    expect(result.tasks[1].taskName).toBe('op-two');

    // 1 run event + 10 span events (5 per task)
    expect(events.some((e) => e.event === 'benchmark.run')).toBe(true);
    const runEvent = events.find((e) => e.event === 'benchmark.run');
    expect(runEvent?.eventId).toMatch(/^event_/);
    expect(runEvent?.runId).toMatch(/^run_/);
    expect(runEvent?.installId).toMatch(/^install_/);
    const spanEvents = events.filter((e) => e.event === 'benchmark.span');
    expect(spanEvents).toHaveLength(10);
    expect(spanEvents[0].eventId).toMatch(/^event_/);
    expect(spanEvents[0].runId).toMatch(/^run_/);
    expect(spanEvents[0].traceId).toMatch(/^trace_/);
    expect(spanEvents[0].spanId).toMatch(/^span_/);
  });

  it('passes ctx with iteration, taskName, and log to each task', async () => {
    const events: BenchEvent[] = [];
    const capturedContexts: Array<{ iteration: number; phase: string; taskName: string }> = [];

    const bench = createBench({
      label: 'ctx-test',
      onEvent: (event) => events.push(event),
    });

    bench.add('my-task', async (ctx) => {
      capturedContexts.push({ iteration: ctx.iteration, phase: ctx.phase, taskName: ctx.taskName });
      ctx.log('hello from iteration', ctx.iteration);
    });

    await bench.run({ iterations: 3, warmup: 0 });

    expect(capturedContexts).toHaveLength(3);
    expect(capturedContexts[0]).toEqual({ iteration: 0, phase: 'measured', taskName: 'my-task' });
    expect(capturedContexts[2]).toEqual({ iteration: 2, phase: 'measured', taskName: 'my-task' });

    const spans = events.filter((e) => e.event === 'benchmark.span') as any[];
    expect(spans[0].logs[0]).toContain('hello from iteration 0');
  });

  it('rejects empty and duplicate task names', () => {
    const bench = createBench({ label: 'validation-test' });

    expect(() => bench.add('', async () => {})).toThrow(/non-empty/);
    bench.add('op', async () => {});
    expect(() => bench.add('op', async () => {})).toThrow(/already registered/);
  });

  it('includes sanitized logs on spans', async () => {
    const events: BenchEvent[] = [];
    const bench = createBench({
      label: 'log-upload-test',
      onEvent: (event) => events.push(event),
    });

    bench.add('loggy-task', async (ctx) => {
      ctx.log('token=abc123');
      ctx.log('Authorization: Bearer my-super-token');
      ctx.log(`api_key=${'x'.repeat(600)}`);
    });

    await bench.run({ iterations: 1, warmup: 0 });

    const spans = events.filter((e) => e.event === 'benchmark.span') as any[];
    expect(spans).toHaveLength(1);
    expect(spans[0].logs).toBeDefined();
    expect(spans[0].logs[0]).toContain('token=[REDACTED]');
    expect(spans[0].logs[1]).toBe('Authorization: Bearer [REDACTED]');
    expect(spans[0].logs[2]).toContain('api_key=[REDACTED]');
    expect(spans[0].logs[2]).not.toContain('[truncated]');
  });

  it('defaults apiUrl to platform endpoint and uses explicit override when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);

    const withDefault = createBench({ label: 'default-api' });
    withDefault.add('op', async () => {});
    await withDefault.run({ iterations: 1, warmup: 0 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://platform.computesdk.com/api/v1/events');

    const withOverride = createBench({ label: 'custom-api', apiUrl: 'https://example.test/events' });
    withOverride.add('op', async () => {});
    await withOverride.run({ iterations: 1, warmup: 0 });
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.test/events');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: 'benchmark.run', eventId: expect.stringMatching(/^event_/) }),
      expect.objectContaining({ event: 'benchmark.span', eventId: expect.stringMatching(/^event_/) }),
    ]));
  });

  it('does not throw when API upload fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const bench = createBench({ label: 'api-failure-test', apiUrl: 'https://example.test/events' });
    bench.add('op', async () => {});

    await expect(bench.run({ iterations: 1, warmup: 0 })).resolves.toBeDefined();
  });

  it('defaults apiUrl to platform endpoint and apiKey to COMPUTESDK_API_KEY env var', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);

    const originalKey = process.env.COMPUTESDK_API_KEY;
    process.env.COMPUTESDK_API_KEY = 'test-key-123';

    try {
      const bench = createBench({ label: 'default-api-test' });
      bench.add('op', async () => {});
      await bench.run({ iterations: 1, warmup: 0 });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://platform.computesdk.com/api/v1/events');
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-key-123');
    } finally {
      if (originalKey !== undefined) {
        process.env.COMPUTESDK_API_KEY = originalKey;
      } else {
        delete process.env.COMPUTESDK_API_KEY;
      }
    }
  });

  it('captures appended output file lines as benchmark.output events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'computesdk-bench-'));
    const file = join(dir, 'run.log');
    const events: BenchEvent[] = [];

    try {
      await writeFile(file, 'existing line\n');
      const bench = createBench({
        label: 'output-capture-test',
        captureOutput: { file, flushInterval: 1000 },
        onEvent: (event) => events.push(event),
      });

      bench.add('write-output', async () => {
        await writeFile(file, 'existing line\nnew line\npartial line');
      });

      await bench.run({ iterations: 1, warmup: 0 });

      const outputEvents = events.filter((event) => event.event === 'benchmark.output') as any[];
      expect(outputEvents.map((event) => event.message)).toEqual([
        'existing line',
        'new line',
        'partial line',
      ]);
      expect(outputEvents[0].path).toBe(file);
      expect(outputEvents[0].label).toBe('output-capture-test');
      expect(outputEvents[0].eventId).toMatch(/^event_/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('prints a summary table to stdout', async () => {
    const bench = createBench({ label: 'summary-test' });

    bench.add('op', async () => {});
    await bench.run({ iterations: 1, warmup: 0 });

    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('summary-test'));
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('Task'));
    expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('op'));
  });

  it('can continue on failures when throwOnError is false', async () => {
    const events: BenchEvent[] = [];
    const bench = createBench({
      label: 'error-test',
      onEvent: (event) => events.push(event),
    });

    let callCount = 0;
    bench.add('flaky-op', async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error('boom');
      }
    });

    const result = await bench.run({
      iterations: 3,
      warmup: 0,
      throwOnError: false,
    });

    expect(result.tasks[0].successes).toBe(2);
    expect(result.tasks[0].failures).toBe(1);
    expect(events.filter((e) => e.event === 'benchmark.span')).toHaveLength(3);
  });

  it('run event includes task names and run config', async () => {
    const events: BenchEvent[] = [];
    const bench = createBench({
      label: 'run-meta-test',
      onEvent: (event) => events.push(event),
    });

    bench.add('alpha', async () => {});
    bench.add('beta', async () => {});

    await bench.run({ iterations: 2, warmup: 1, provider: 'modal' });

    const runEvent = events.find((e) => e.event === 'benchmark.run') as any;
    expect(runEvent).toBeDefined();
    expect(runEvent.label).toBe('run-meta-test');
    expect(runEvent.tasks).toEqual(['alpha', 'beta']);
    expect(runEvent.iterations).toBe(2);
    expect(runEvent.warmup).toBe(1);
    expect(runEvent.provider).toBe('modal');
  });

  it('inherits provider from BenchConfig when run option is omitted', async () => {
    const events: BenchEvent[] = [];
    const bench = createBench({
      label: 'config-provider-test',
      provider: 'e2b',
      onEvent: (event) => events.push(event),
    });

    bench.add('op', async () => {});
    await bench.run({ iterations: 1, warmup: 0 });

    const runEvent = events.find((e) => e.event === 'benchmark.run') as any;
    const spanEvent = events.find((e) => e.event === 'benchmark.span') as any;
    expect(runEvent.provider).toBe('e2b');
    expect(spanEvent.provider).toBe('e2b');
  });

  it('includes batch and shard metadata on run, span, and output events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'computesdk-bench-'));
    const file = join(dir, 'run.log');
    const events: BenchEvent[] = [];

    try {
      await writeFile(file, 'shard starting\n');
      const bench = createBench({
        label: 'sharded-run',
        batch: 'group-1',
        shard: { index: 7, count: 100 },
        captureOutput: { file },
        onEvent: (event) => events.push(event),
      });

      bench.add('op', async () => {});
      await bench.run({ iterations: 1, warmup: 0 });

      const runEvent = events.find((event) => event.event === 'benchmark.run') as any;
      const spanEvent = events.find((event) => event.event === 'benchmark.span') as any;
      const outputEvent = events.find((event) => event.event === 'benchmark.output') as any;

      for (const event of [runEvent, spanEvent, outputEvent]) {
        expect(event.eventId).toMatch(/^event_/);
        expect(event.batch).toBe('group-1');
        expect(event.shardIndex).toBe(7);
        expect(event.shardCount).toBe(100);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe('concurrent mode', () => {
    it('fires iterations concurrently and tracks aggregate stats', async () => {
      const events: BenchEvent[] = [];
      const bench = createBench({
        label: 'concurrent-test',
        onEvent: (event) => events.push(event),
      });

      let maxConcurrent = 0;
      let currentConcurrent = 0;

      bench.add('concurrent-op', async () => {
        currentConcurrent++;
        if (currentConcurrent > maxConcurrent) {
          maxConcurrent = currentConcurrent;
        }
        await new Promise((r) => setTimeout(r, 10));
        currentConcurrent--;
      });

      const result = await bench.run({
        iterations: 10,
        warmup: 0,
        mode: 'concurrent',
        concurrency: 5,
      });

      expect(result.tasks[0].stats.count).toBe(10);
      expect(result.tasks[0].successes).toBe(10);
      expect(maxConcurrent).toBeGreaterThan(1);
      // With concurrency=5 and 10 iterations, we should hit 5 concurrent at some point
      expect(maxConcurrent).toBeLessThanOrEqual(5);

      const spans = events.filter((e) => e.event === 'benchmark.span');
      expect(spans).toHaveLength(10);
    });

    it('defaults concurrency to iterations when not specified', async () => {
      const bench = createBench({ label: 'concurrent-default-concurrency' });

      bench.add('op', async () => {
        await new Promise((r) => setTimeout(r, 5));
      });

      const result = await bench.run({ iterations: 20, warmup: 0, mode: 'concurrent' });
      expect(result.tasks[0].successes).toBe(20);
    });

    it('runs all iterations to completion even when some fail with throwOnError', async () => {
      const events: BenchEvent[] = [];
      const bench = createBench({
        label: 'concurrent-error-test',
        onEvent: (event) => events.push(event),
      });

      let callCount = 0;
      bench.add('flaky-op', async () => {
        callCount++;
        if (callCount === 3) {
          throw new Error('boom');
        }
        await new Promise((r) => setTimeout(r, 5));
      });

      await expect(
        bench.run({ iterations: 5, warmup: 0, mode: 'concurrent', throwOnError: true })
      ).rejects.toThrow('boom');

      // All 5 iterations should have emitted spans (Promise.allSettled ensures completion)
      const spans = events.filter((e) => e.event === 'benchmark.span');
      expect(spans).toHaveLength(5);
    });
  });

  describe('span metadata', () => {
    it('attaches metadata set via ctx.setMetadata to span events', async () => {
      const events: BenchEvent[] = [];
      const bench = createBench({
        label: 'metadata-test',
        onEvent: (event) => events.push(event),
      });

      bench.add('meta-op', async (ctx) => {
        ctx.setMetadata({ status: 'success', latency_ms: 42, provider_id: 'sb_123' });
      });

      await bench.run({ iterations: 1, warmup: 0 });

      const span = events.find((e) => e.event === 'benchmark.span') as any;
      expect(span).toBeDefined();
      expect(span.metadata).toBeDefined();
      expect(span.metadata.status).toBe('success');
      expect(span.metadata.latency_ms).toBe(42);
      expect(span.metadata.provider_id).toBe('sb_123');
    });

    it('merges multiple setMetadata calls', async () => {
      const events: BenchEvent[] = [];
      const bench = createBench({
        label: 'metadata-merge-test',
        onEvent: (event) => events.push(event),
      });

      bench.add('multi-meta', async (ctx) => {
        ctx.setMetadata({ phase: 'create' });
        ctx.setMetadata({ status: 'ok' });
        ctx.setMetadata({ phase: 'ready' }); // should overwrite
      });

      await bench.run({ iterations: 1, warmup: 0 });

      const span = events.find((e) => e.event === 'benchmark.span') as any;
      expect(span.metadata.phase).toBe('ready');
      expect(span.metadata.status).toBe('ok');
    });
  });

  describe('custom distributions', () => {
    it('includes expanded percentiles in stats', async () => {
      const bench = createBench({ label: 'distribution-test' });

      bench.add('timed-op', async () => {
        await new Promise((r) => setTimeout(r, 5));
      });

      const result = await bench.run({ iterations: 10, warmup: 0 });
      const stats = result.tasks[0].stats;

      expect(stats).toHaveProperty('p10Ms');
      expect(stats).toHaveProperty('p25Ms');
      expect(stats).toHaveProperty('p50Ms');
      expect(stats).toHaveProperty('p75Ms');
      expect(stats).toHaveProperty('p90Ms');
      expect(stats).toHaveProperty('p95Ms');
      expect(stats).toHaveProperty('p99Ms');
      expect(stats.p10Ms).toBeGreaterThanOrEqual(0);
      expect(stats.p99Ms).toBeGreaterThanOrEqual(stats.p10Ms);
    });
  });

  describe('metric events', () => {
    it('emits benchmark.metric events via bench.emit()', async () => {
      const events: BenchEvent[] = [];
      const bench = createBench({
        label: 'metric-test',
        onEvent: (event) => events.push(event),
      });

      bench.emit('system.cpu', { user_us: 12345, system_us: 67890 });

      const metrics = events.filter((e) => e.event === 'benchmark.metric');
      expect(metrics).toHaveLength(1);
      expect((metrics[0] as any).label).toBe('metric-test');
      expect((metrics[0] as any).provider).toBeUndefined();
      expect(metrics[0].name).toBe('system.cpu');
      expect((metrics[0] as any).data.user_us).toBe(12345);
    });

    it('emits benchmark.metric events via ctx.emitMetric during run', async () => {
      const events: BenchEvent[] = [];
      const bench = createBench({
        label: 'ctx-metric-test',
        onEvent: (event) => events.push(event),
      });

      bench.add('metric-op', async (ctx) => {
        ctx.emitMetric('sandbox.result', { latency_ms: 150, status: 'success' });
      });

      await bench.run({ iterations: 2, warmup: 0 });

      const metrics = events.filter((e) => e.event === 'benchmark.metric');
      expect(metrics).toHaveLength(2);
      expect(metrics[0].name).toBe('sandbox.result');
    });

    it('tags metric and progress events with provider from config', async () => {
      const events: BenchEvent[] = [];
      const bench = createBench({
        label: 'provider-metric-test',
        provider: 'e2b',
        onEvent: (event) => events.push(event),
      });

      bench.add('metric-op', async (ctx) => {
        ctx.emitMetric('sandbox.result', { latency_ms: 150 });
      });

      await bench.run({ iterations: 1, warmup: 0 });
      bench.progress({ done: 1, inFlight: 0, errors: 0, total: 1 });

      const metric = events.find((e) => e.event === 'benchmark.metric') as any;
      const progress = events.find((e) => e.event === 'benchmark.progress') as any;
      expect(metric.provider).toBe('e2b');
      expect(progress.provider).toBe('e2b');
    });
  });

  describe('progress events', () => {
    it('emits benchmark.progress events via bench.progress()', async () => {
      const events: BenchEvent[] = [];
      const bench = createBench({
        label: 'progress-test',
        onEvent: (event) => events.push(event),
      });

      bench.progress({ done: 50, inFlight: 10, errors: 2, total: 100, extra: { rate: 5.5 } });

      const progress = events.filter((e) => e.event === 'benchmark.progress');
      expect(progress).toHaveLength(1);
      expect((progress[0] as any).label).toBe('progress-test');
      expect((progress[0] as any).done).toBe(50);
      expect((progress[0] as any).inFlight).toBe(10);
      expect((progress[0] as any).errors).toBe(2);
      expect((progress[0] as any).total).toBe(100);
      expect((progress[0] as any).extra.rate).toBe(5.5);
    });

    it('correlates bench.progress() runId with the active run', async () => {
      const events: BenchEvent[] = [];
      const bench = createBench({
        label: 'progress-runid-test',
        onEvent: (event) => events.push(event),
      });

      bench.add('emit-progress', async () => {
        bench.progress({ done: 1, inFlight: 0, errors: 0, total: 1 });
      });

      await bench.run({ iterations: 1, warmup: 0 });

      const runEvent = events.find((e) => e.event === 'benchmark.run') as any;
      const progressEvent = events.find((e) => e.event === 'benchmark.progress') as any;
      expect(progressEvent).toBeDefined();
      expect(progressEvent.runId).toBe(runEvent.runId);
    });
  });

  describe('new event types are uploaded when apiUrl is set', () => {
    it('posts metric and progress events to API', async () => {
      const fetchMock = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('fetch', fetchMock);

      const bench = createBench({
        label: 'api-metric-test',
        apiUrl: 'https://example.test/events',
      });

      bench.emit('cpu', { usage: 0.5 });
      bench.progress({ done: 10, inFlight: 2, errors: 0, total: 100 });

      // Wait for flush
      await new Promise((r) => setTimeout(r, 1500));

      const calls = fetchMock.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const allEvents = calls.flatMap((call) => JSON.parse(call[1].body).events);
      expect(allEvents).toEqual(expect.arrayContaining([
        expect.objectContaining({ event: 'benchmark.metric' }),
        expect.objectContaining({ event: 'benchmark.progress' }),
      ]));
    });
  });

  describe('query client', () => {
    it('exposes query methods flat on the bench object', () => {
      const bench = createBench({
        label: 'query-test',
        apiUrl: 'https://platform.computesdk.com/api/v1/events',
        apiKey: 'my-key',
      });

      expect(typeof bench.listRuns).toBe('function');
      expect(typeof bench.getRun).toBe('function');
      expect(typeof bench.getBatchStats).toBe('function');
    });

    it('derives query base URL from ingest apiUrl', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ runs: [], nextCursor: null }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const bench = createBench({
        label: 'url-derive-test',
        apiUrl: 'https://platform.computesdk.com/api/v1/events',
      });

      await bench.listRuns();
      expect(fetchMock.mock.calls[0][0]).toBe('https://platform.computesdk.com/api/v1/runs');
    });

    it('uses explicit queryUrl when provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ runs: [], nextCursor: null }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const bench = createBench({
        label: 'custom-query-url-test',
        apiUrl: 'https://my-proxy.internal/bench-ingest',
        queryUrl: 'https://platform.computesdk.com/api/v1',
      });

      await bench.listRuns();
      expect(fetchMock.mock.calls[0][0]).toBe('https://platform.computesdk.com/api/v1/runs');
    });
  });
});
