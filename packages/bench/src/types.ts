import type { TelemetryAttempt, TelemetryConfigEvent, TelemetryEvent, TelemetrySpanEvent, TelemetryTransport } from '@computesdk/telemetry';
export type { TelemetryAttempt, TelemetryConfigEvent, TelemetryEvent, TelemetrySpanEvent, TelemetryTransport };

export interface BenchConfig {
  enabled?: boolean;
  installId?: string;
  sdkVersion?: string;
  telemetry?: TelemetryTransport;
}

export interface BenchRunOptions {
  iterations?: number;
  warmup?: number;
  provider?: string;
  parentSpanId?: string;
  throwOnError?: boolean;
}

export interface BenchmarkStats {
  count: number;
  minMs: number;
  maxMs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
}

export interface BenchResult {
  operation: string;
  benchmarkRunId: string;
  iterations: number;
  warmup: number;
  successes: number;
  failures: number;
  stats: BenchmarkStats;
}
