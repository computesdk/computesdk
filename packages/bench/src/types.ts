export interface TelemetryAttempt {
  provider: string;
  candidateIndex: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outcome: 'success' | 'failure';
  errorCode?: string;
}

export interface TelemetryConfigEvent {
  eventName: 'telemetry.config';
  installId: string;
  sdkVersion?: string;
  runtime?: 'node' | 'browser' | 'unknown';
  os?: string;
  arch?: string;
}

export interface TelemetrySpanEvent {
  eventName: 'telemetry.span';
  installId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  outcome: 'success' | 'failure';
  provider?: string;
  attemptCount: number;
  attempts: TelemetryAttempt[];
  errorCode?: string;
  sdkVersion?: string;
  runtime?: 'node' | 'browser' | 'unknown';
  os?: string;
  arch?: string;
  benchmarkRunId?: string;
  iteration?: number;
  phase?: 'warmup' | 'measured';
}

export type TelemetryEvent = TelemetryConfigEvent | TelemetrySpanEvent;

export interface TelemetryTransport {
  endpoint?: string;
  headers?: Record<string, string>;
  onEvent?: (event: TelemetryEvent) => void;
  fetchImpl?: typeof fetch;
}

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
