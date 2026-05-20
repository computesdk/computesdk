import { buildStats } from './stats';
import {
  createTelemetryId,
  detectArch,
  detectOs,
  detectRuntime,
  emitTelemetryEvent,
  telemetryDisabledByEnv,
  toErrorCode,
} from '@computesdk/telemetry';
import type {
  BenchConfig,
  BenchResult,
  BenchRunOptions,
  TelemetryAttempt,
  TelemetryConfigEvent,
  TelemetryEvent,
  TelemetrySpanEvent,
} from './types';

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function isoNow(): string {
  return new Date().toISOString();
}

export function createBench(config: BenchConfig = {}) {
  const enabled = (config.enabled ?? true) && !telemetryDisabledByEnv();
  const installId = config.installId ?? createTelemetryId();
  const runtime = detectRuntime();
  const os = detectOs();
  const arch = detectArch();

  async function emit(event: TelemetryEvent): Promise<void> {
    await emitTelemetryEvent(event, config.telemetry ?? {}, enabled);
  }

  async function emitConfig(): Promise<void> {
    const event: TelemetryConfigEvent = {
      eventName: 'benchmark.config',
      installId,
      sdkVersion: config.sdkVersion,
      runtime,
      os,
      arch,
    };
    await emit(event);
  }

  async function run<T>(
    operation: string,
    fn: (iteration: number) => Promise<T> | T,
    options: BenchRunOptions = {}
  ): Promise<BenchResult> {
    const iterations = options.iterations ?? 25;
    const warmup = options.warmup ?? 3;
    const throwOnError = options.throwOnError ?? true;
    const benchmarkRunId = createTelemetryId();
    const traceId = createTelemetryId();
    const measuredDurations: number[] = [];
    let successes = 0;
    let failures = 0;

    await emitConfig();

    for (let i = 0; i < warmup; i++) {
      await fn(i);
    }

    for (let i = 0; i < iterations; i++) {
      const startedAtMs = nowMs();
      const startedAt = isoNow();
      const attempts: TelemetryAttempt[] = [];
      let spanError: unknown;

      try {
        await fn(i);
        const durationMs = nowMs() - startedAtMs;
        measuredDurations.push(durationMs);
        successes += 1;

        attempts.push({
          provider: options.provider ?? 'unknown',
          candidateIndex: 0,
          startedAt,
          endedAt: isoNow(),
          durationMs,
          outcome: 'success',
        });

        const event: TelemetrySpanEvent = {
          eventName: 'benchmark.span',
          installId,
          traceId,
          spanId: createTelemetryId(),
          parentSpanId: options.parentSpanId,
          operation,
          startedAt,
          endedAt: isoNow(),
          durationMs,
          outcome: 'success',
          provider: options.provider,
          attemptCount: attempts.length,
          attempts,
          sdkVersion: config.sdkVersion,
          runtime,
          os,
          arch,
          benchmarkRunId,
          iteration: i,
          phase: 'measured',
        };
        await emit(event);
      } catch (error) {
        spanError = error;
        failures += 1;
        const durationMs = nowMs() - startedAtMs;
        attempts.push({
          provider: options.provider ?? 'unknown',
          candidateIndex: 0,
          startedAt,
          endedAt: isoNow(),
          durationMs,
          outcome: 'failure',
          errorCode: toErrorCode(error),
        });

        const event: TelemetrySpanEvent = {
          eventName: 'benchmark.span',
          installId,
          traceId,
          spanId: createTelemetryId(),
          parentSpanId: options.parentSpanId,
          operation,
          startedAt,
          endedAt: isoNow(),
          durationMs,
          outcome: 'failure',
          provider: options.provider,
          attemptCount: attempts.length,
          attempts,
          errorCode: toErrorCode(error),
          sdkVersion: config.sdkVersion,
          runtime,
          os,
          arch,
          benchmarkRunId,
          iteration: i,
          phase: 'measured',
        };
        await emit(event);
      }

      if (spanError && throwOnError) {
        throw spanError;
      }
    }

    return {
      operation,
      benchmarkRunId,
      iterations,
      warmup,
      successes,
      failures,
      stats: buildStats(measuredDurations),
    };
  }

  return {
    run,
    emitConfig,
  };
}
