import { nanoid } from 'nanoid';

export interface BenchAttempt {
  provider: string;
  candidateIndex: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: 'ok' | 'error';
  errorCode?: string;
}

export interface BenchConfigEvent {
  event: 'benchmark.config';
  installId: string;
  benchVersion?: string;
  runtime?: 'node' | 'browser' | 'unknown';
  os?: string;
  arch?: string;
  providerStrategy?: 'priority' | 'round-robin';
  fallbackOnError?: boolean;
}

export interface BenchRunEvent {
  event: 'benchmark.run';
  eventId: string;
  runId: string;
  label: string;
  batch?: string;
  shardIndex?: number;
  shardCount?: number;
  tasks: string[];
  provider?: string;
  iterations: number;
  warmup: number;
  installId: string;
  benchVersion: string;
  runtime: 'node' | 'browser' | 'unknown';
  os: string;
  arch: string;
}

export interface BenchSpanEvent {
  event: 'benchmark.span';
  eventId: string;
  runId: string;
  label: string;
  installId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: 'ok' | 'error';
  provider?: string;
  attemptCount: number;
  attempts: BenchAttempt[];
  errorCode?: string;
  benchVersion?: string;
  runtime?: 'node' | 'browser' | 'unknown';
  os?: string;
  arch?: string;
  batch?: string;
  shardIndex?: number;
  shardCount?: number;
  taskName?: string;
  logs?: string[];
  benchmarkRunId?: string;
  iteration?: number;
  phase?: 'warmup' | 'measured';
  /** Arbitrary caller-supplied metadata attached to this span */
  metadata?: Record<string, unknown>;
}

export interface BenchOutputEvent {
  event: 'benchmark.output';
  eventId: string;
  runId: string;
  label: string;
  installId: string;
  batch?: string;
  shardIndex?: number;
  shardCount?: number;
  timestamp: string;
  source: 'file';
  path: string;
  message: string;
  benchVersion?: string;
  runtime?: 'node' | 'browser' | 'unknown';
  os?: string;
  arch?: string;
}

export interface BenchMetricEvent {
  event: 'benchmark.metric';
  eventId: string;
  runId: string;
  label: string;
  installId: string;
  batch?: string;
  shardIndex?: number;
  shardCount?: number;
  timestamp: string;
  /** Metric name / category */
  name: string;
  /** Arbitrary metric payload */
  data: Record<string, unknown>;
  provider?: string;
  benchVersion?: string;
  runtime?: 'node' | 'browser' | 'unknown';
  os?: string;
  arch?: string;
}

export interface BenchProgressEvent {
  event: 'benchmark.progress';
  eventId: string;
  runId: string;
  label: string;
  installId: string;
  batch?: string;
  shardIndex?: number;
  shardCount?: number;
  timestamp: string;
  /** Progress counters */
  done: number;
  inFlight: number;
  errors: number;
  total: number;
  /** Optional extra fields */
  extra?: Record<string, unknown>;
  provider?: string;
  benchVersion?: string;
  runtime?: 'node' | 'browser' | 'unknown';
  os?: string;
  arch?: string;
}

export type BenchEvent = BenchConfigEvent | BenchRunEvent | BenchSpanEvent | BenchOutputEvent | BenchMetricEvent | BenchProgressEvent;

type NetworkBenchEvent = BenchRunEvent | BenchSpanEvent | BenchOutputEvent | BenchMetricEvent | BenchProgressEvent;

const API_BATCH_SIZE = 100;
const API_FLUSH_INTERVAL = 1000;
const API_MAX_QUEUE_SIZE = 10000;
const API_FINAL_FLUSH_TIMEOUT = 1000;

export interface BenchTransport {
  onEvent?: (event: BenchEvent) => void;
  apiUrl?: string;
  apiKey?: string;
  queue?: NetworkBenchEvent[];
  flushTimer?: ReturnType<typeof setTimeout>;
  flushing?: Promise<void>;
}

function isNetworkEvent(event: BenchEvent): event is NetworkBenchEvent {
  return event.event === 'benchmark.span' || event.event === 'benchmark.run' || event.event === 'benchmark.output' || event.event === 'benchmark.metric' || event.event === 'benchmark.progress';
}

export function createPrefixedId(prefix: string): string {
  return `${prefix}_${nanoid(12)}`;
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

export function createBenchTransport(config: {
  onEvent?: (event: BenchEvent) => void;
  apiUrl?: string;
  apiKey?: string;
}): BenchTransport {
  return {
    onEvent: config.onEvent,
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    queue: [],
  };
}

function getHeaders(transport: BenchTransport): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (transport.apiKey) {
    headers.Authorization = `Bearer ${transport.apiKey}`;
  }
  return headers;
}

async function uploadBatch(transport: BenchTransport, batch: NetworkBenchEvent[]): Promise<void> {
  if (!transport.apiUrl || batch.length === 0) return;

  const fetchImpl = typeof fetch !== 'undefined' ? fetch : undefined;
  if (!fetchImpl) return;

  await fetchImpl(transport.apiUrl, {
    method: 'POST',
    headers: getHeaders(transport),
    body: JSON.stringify({ events: batch }),
  }).catch(() => {});
}

function scheduleFlush(transport: BenchTransport): void {
  if (transport.flushTimer || transport.flushing) return;

  transport.flushTimer = setTimeout(() => {
    transport.flushTimer = undefined;
    void flushBenchTransport(transport);
  }, API_FLUSH_INTERVAL);
  transport.flushTimer.unref?.();
}

export function emitBenchEvent(
  event: BenchEvent,
  transport: BenchTransport,
): void {
  if (transport.onEvent) {
    try {
      transport.onEvent(event);
    } catch {
    }
  }

  if (!isNetworkEvent(event)) return;
  if (!transport.apiUrl) return;

  const queue = transport.queue ?? (transport.queue = []);
  if (queue.length >= API_MAX_QUEUE_SIZE) return;

  queue.push(event);
  if (queue.length >= API_BATCH_SIZE) {
    void flushBenchTransport(transport);
    return;
  }

  scheduleFlush(transport);
}

export async function flushBenchTransport(transport: BenchTransport): Promise<void> {
  if (transport.flushTimer) {
    clearTimeout(transport.flushTimer);
    transport.flushTimer = undefined;
  }

  if (transport.flushing) {
    return transport.flushing;
  }

  transport.flushing = (async () => {
    const queue = transport.queue;
    while (queue && queue.length > 0) {
      const batch = queue.splice(0, API_BATCH_SIZE);
      await uploadBatch(transport, batch);
    }
  })();
  try {
    await transport.flushing;
  } finally {
    transport.flushing = undefined;
  }

  if (transport.queue && transport.queue.length > 0) {
    scheduleFlush(transport);
  }
}

export async function flushBenchTransportBestEffort(transport: BenchTransport): Promise<void> {
  const flush = async () => {
    while (transport.queue && transport.queue.length > 0) {
      await flushBenchTransport(transport);
    }
  };

  await Promise.race([
    flush(),
    new Promise<void>((resolve) => setTimeout(resolve, API_FINAL_FLUSH_TIMEOUT)),
  ]).catch(() => {});
}
