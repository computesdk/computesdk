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
  eventName: 'benchmark.config';
  installId: string;
  sdkVersion?: string;
  runtime?: 'node' | 'browser' | 'unknown';
  os?: string;
  arch?: string;
  providerStrategy?: 'priority' | 'round-robin';
  fallbackOnError?: boolean;
}

export interface TelemetrySpanEvent {
  eventName: 'benchmark.span';
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

export function createTelemetryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function telemetryDisabledByEnv(): boolean {
  return typeof process !== 'undefined' && process?.env?.COMPUTESDK_TELEMETRY === '0';
}

export function detectRuntime(): 'node' | 'browser' | 'unknown' {
  if (typeof window !== 'undefined') return 'browser';
  if (typeof process !== 'undefined') return 'node';
  return 'unknown';
}

export function detectOs(): string {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform;
  }
  return 'unknown';
}

export function detectArch(): string {
  if (typeof process !== 'undefined' && process.arch) {
    return process.arch;
  }
  return 'unknown';
}

export function toErrorCode(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return 'ERROR';
}

export async function emitTelemetryEvent(event: TelemetryEvent, transport: TelemetryTransport, enabled = true): Promise<void> {
  if (!enabled) return;

  if (transport.onEvent) {
    try {
      transport.onEvent(event);
    } catch {
    }
  }

  if (!transport.endpoint) return;
  const fetchImpl = transport.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!fetchImpl) return;

  await fetchImpl(transport.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(transport.headers ?? {}),
    },
    body: JSON.stringify({ events: [event] }),
  }).catch(() => {
  });
}
