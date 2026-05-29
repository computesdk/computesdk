export interface BenchRunSummary {
  runId: string;
  label: string;
  provider?: string;
  batch?: string;
  status: string;
  startedAt: string;
  endedAt?: string;
}

export interface BenchRunDetail {
  runId: string;
  label: string;
  batch?: string;
  shardIndex?: number;
  shardCount?: number;
  tasks: string[];
  provider?: string;
  iterations: number;
  warmup: number;
  benchVersion?: string;
  runtime?: string;
  os?: string;
  arch?: string;
  installId: string;
  ingestedAt?: string;
  spans: unknown[];
}

export interface BenchRunProgress {
  runId: string;
  done: number;
  inFlight: number;
  errors: number;
  total: number;
  latestProgressAt: string;
}

export interface BenchBatchStats {
  totalSpans: number;
  statusCounts: { ok: number; error: number };
  latencyDistribution: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  failureBreakdown: Array<{ errorCode: string; count: number }>;
}

export interface BenchBatchProgress {
  runs: BenchRunProgress[];
  latestProgressAt: string | null;
}

export interface BenchMetricDistribution {
  count: number;
  min: number | null;
  avg: number | null;
  max: number | null;
  p10?: number | null;
  p25?: number | null;
  p50: number | null;
  p75?: number | null;
  p90?: number | null;
  p95: number | null;
  p99: number | null;
  p999?: number | null;
}

export interface BenchGroupedMetricDistribution {
  field: string;
  groupBy: string;
  groups: Array<{
    key: string;
    count: number;
    min: number | null;
    avg: number | null;
    max: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
  }>;
}

export interface BenchMetricCounts {
  field: string;
  total: number;
  counts: Array<{ key: string; count: number }>;
}

export interface BenchMetricTimeline {
  field: string;
  interval: '1s';
  agg: 'sum' | 'avg' | 'max' | 'count';
  points: Array<{ ts: string; value: number }>;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export interface BenchQueryClient {
  /** List runs filtered by batch */
  listRuns(params?: {
    batch?: string;
    limit?: number;
    cursor?: string;
  }): Promise<PaginatedResponse<BenchRunSummary>>;

  /** Get a single run by ID (includes all spans) */
  getRun(runId: string): Promise<BenchRunDetail>;

  /** Get latest progress for a single run */
  getRunProgress(runId: string): Promise<BenchRunProgress>;

  /** Get aggregate stats for a batch */
  getBatchStats(batchId: string): Promise<BenchBatchStats>;

  /** Get per-run progress aggregated for a batch */
  getBatchProgress(batchId: string): Promise<BenchBatchProgress>;

  /** Get aggregate distribution stats for a metric field in a batch */
  getBatchMetricStats(batchId: string, opts: {
    name: string;
    field: string;
    groupBy?: string;
  }): Promise<BenchMetricDistribution | BenchGroupedMetricDistribution>;

  /** Get categorical counts for a metric field in a batch */
  getBatchMetricCounts(batchId: string, opts: {
    name: string;
    field: string;
  }): Promise<BenchMetricCounts>;

  /** Get timeline points for a numeric metric field in a batch */
  getBatchMetricTimeline(batchId: string, opts: {
    name: string;
    field: string;
    interval?: '1s';
    agg?: 'sum' | 'avg' | 'max' | 'count';
  }): Promise<BenchMetricTimeline>;
}

export interface BenchQueryClientConfig {
  /** Base URL for query endpoints (default: https://platform.computesdk.com/api/v1) */
  baseUrl?: string;
  /** Bearer token for query requests (default: process.env.COMPUTESDK_API_KEY) */
  apiKey?: string;
}

function getHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function get<T>(url: string, apiKey?: string): Promise<T> {
  const fetchImpl = typeof fetch !== 'undefined' ? fetch : undefined;
  if (!fetchImpl) {
    throw new Error('fetch is not available');
  }
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: getHeaders(apiKey),
  });
  if (!response.ok) {
    throw new Error(`Bench query failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function buildQueryString(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    qs.append(key, String(value));
  }
  const str = qs.toString();
  return str ? `?${str}` : '';
}

const DEFAULT_BASE_URL = 'https://platform.computesdk.com/api/v1';

export function createBenchQueryClient(config: BenchQueryClientConfig = {}): BenchQueryClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const apiKey = config.apiKey ?? process.env.COMPUTESDK_API_KEY;

  function url(path: string, params?: Record<string, unknown>): string {
    return `${baseUrl}${path}${params ? buildQueryString(params) : ''}`;
  }

  return {
    async listRuns(params = {}) {
      const data = await get<{
        runs: BenchRunSummary[];
        nextCursor: string | null;
      }>(url('/runs', params), apiKey);
      return { items: data.runs, nextCursor: data.nextCursor };
    },

    async getRun(runId) {
      return get<BenchRunDetail>(url(`/runs/${encodeURIComponent(runId)}`), apiKey);
    },

    async getRunProgress(runId) {
      return get<BenchRunProgress>(url(`/runs/${encodeURIComponent(runId)}/progress`), apiKey);
    },

    async getBatchStats(batchId) {
      return get<BenchBatchStats>(url(`/batches/${encodeURIComponent(batchId)}/stats`), apiKey);
    },

    async getBatchProgress(batchId) {
      return get<BenchBatchProgress>(url(`/batches/${encodeURIComponent(batchId)}/progress`), apiKey);
    },

    async getBatchMetricStats(batchId, opts) {
      return get<BenchMetricDistribution | BenchGroupedMetricDistribution>(
        url(`/batches/${encodeURIComponent(batchId)}/metrics/${encodeURIComponent(opts.name)}/distribution`, {
          field: opts.field,
          groupBy: opts.groupBy,
        }),
        apiKey,
      );
    },

    async getBatchMetricCounts(batchId, opts) {
      return get<BenchMetricCounts>(
        url(`/batches/${encodeURIComponent(batchId)}/metrics/${encodeURIComponent(opts.name)}/counts`, {
          field: opts.field,
        }),
        apiKey,
      );
    },

    async getBatchMetricTimeline(batchId, opts) {
      return get<BenchMetricTimeline>(
        url(`/batches/${encodeURIComponent(batchId)}/metrics/${encodeURIComponent(opts.name)}/timeline`, {
          field: opts.field,
          interval: opts.interval ?? '1s',
          agg: opts.agg ?? 'sum',
        }),
        apiKey,
      );
    },
  };
}
