import { describe, expect, it, vi } from 'vitest';
import { createTelemetryId, DEFAULT_TELEMETRY_ENDPOINT, emitTelemetryEvent, toErrorCode } from '../index';

describe('@computesdk/telemetry', () => {
  it('creates non-empty telemetry IDs', () => {
    expect(createTelemetryId().length).toBeGreaterThan(0);
  });

  it('maps unknown errors to default code', () => {
    expect(toErrorCode(new Error('boom'))).toBe('Error');
    expect(toErrorCode('boom')).toBe('ERROR');
  });

  it('emits benchmark events to callback and transport', async () => {
    const onEvent = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(undefined);

    const event = {
      eventName: 'benchmark.span' as const,
      installId: 'inst_1',
      traceId: 'trace_1',
      spanId: 'span_1',
      operation: 'sandbox.create',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      outcome: 'success' as const,
      attemptCount: 1,
      attempts: [],
    };

    await emitTelemetryEvent(event, {
      endpoint: 'https://example.com/ingest',
      onEvent,
      fetchImpl,
    });

    expect(onEvent).toHaveBeenCalledWith(event);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/ingest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events: [event] }),
    });
  });

  it('does not emit when telemetry is disabled', async () => {
    const onEvent = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(undefined);

    await emitTelemetryEvent({
      eventName: 'benchmark.config',
      installId: 'inst_2',
    }, {
      endpoint: 'https://example.com/ingest',
      onEvent,
      fetchImpl,
    }, false);

    expect(onEvent).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses default telemetry endpoint when endpoint is omitted', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(undefined);
    const event = {
      eventName: 'benchmark.config' as const,
      installId: 'inst_3',
    };

    await emitTelemetryEvent(event, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(DEFAULT_TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events: [event] }),
    });
  });
});
