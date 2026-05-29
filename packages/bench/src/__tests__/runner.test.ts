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

  it('posts run/span events in a batch only when apiUrl is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', fetchMock);

    const withoutApi = createBench({ label: 'no-api' });
    withoutApi.add('op', async () => {});
    await withoutApi.run({ iterations: 1, warmup: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(0);

    const withApi = createBench({ label: 'with-api', apiUrl: 'https://example.test/events' });
    withApi.add('op', async () => {});
    await withApi.run({ iterations: 1, warmup: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/events');
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
});
