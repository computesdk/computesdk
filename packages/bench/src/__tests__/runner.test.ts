import { describe, expect, it, vi } from 'vitest';
import { createBench } from '../runner';
import type { TelemetryEvent } from '../types';

describe('createBench', () => {
  it('emits telemetry events and computes benchmark stats', async () => {
    const events: TelemetryEvent[] = [];
    const bench = createBench({
      sdkVersion: 'test',
      telemetry: {
        onEvent: (event) => events.push(event),
      },
    });

    const result = await bench.run('sandbox.create', async () => {
      await Promise.resolve();
    }, { iterations: 5, warmup: 1, provider: 'e2b' });

    expect(result.operation).toBe('sandbox.create');
    expect(result.iterations).toBe(5);
    expect(result.successes).toBe(5);
    expect(result.failures).toBe(0);
    expect(result.stats.count).toBe(5);
    expect(events.some((event) => event.eventName === 'telemetry.config')).toBe(true);

    const spanEvents = events.filter((event) => event.eventName === 'telemetry.span');
    expect(spanEvents).toHaveLength(5);
    expect(spanEvents.every((event) => event.operation === 'sandbox.create')).toBe(true);
  });

  it('can continue on failures when throwOnError is false', async () => {
    const events: TelemetryEvent[] = [];
    const bench = createBench({
      telemetry: {
        onEvent: (event) => events.push(event),
      },
    });

    const fn = vi.fn(async (iteration: number) => {
      if (iteration === 1) {
        throw new Error('boom');
      }
    });

    const result = await bench.run('sandbox.destroy', fn, {
      iterations: 3,
      warmup: 0,
      throwOnError: false,
    });

    expect(result.successes).toBe(2);
    expect(result.failures).toBe(1);
    expect(events.filter((event) => event.eventName === 'telemetry.span')).toHaveLength(3);
  });
});
