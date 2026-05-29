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

export function createBenchQueryClient(baseUrl: string, apiKey?: string): BenchQueryClient {
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
  };
}
