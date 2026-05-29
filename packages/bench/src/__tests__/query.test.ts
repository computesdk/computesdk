import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBenchQueryClient } from '../query';

describe('createBenchQueryClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('constructs URLs relative to the base', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runs: [], nextCursor: null }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const query = createBenchQueryClient({ baseUrl: 'https://platform.computesdk.com/api/v1', apiKey: 'my-key' });
    await query.listRuns({ batch: 'group_abc123' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://platform.computesdk.com/api/v1/runs?batch=group_abc123');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer my-key');
  });

  it('omits Authorization header when apiKey is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runs: [], nextCursor: null }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const query = createBenchQueryClient({ baseUrl: 'https://platform.computesdk.com/api/v1' });
    await query.listRuns();

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('GETs run detail', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        runId: 'run_abc123',
        label: 'test',
        status: 'completed',
        tasks: [],
        spans: [],
        installId: 'install_1',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const query = createBenchQueryClient({ baseUrl: 'https://api.example.com/v1' });
    const run = await query.getRun('run_abc123');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/runs/run_abc123');
    expect(run.runId).toBe('run_abc123');
    expect(run.spans).toEqual([]);
  });

  it('GETs run progress', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        runId: 'run_abc123',
        done: 50,
        inFlight: 10,
        errors: 2,
        total: 100,
        latestProgressAt: '2026-05-29T04:30:00Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const query = createBenchQueryClient({ baseUrl: 'https://api.example.com/v1' });
    const progress = await query.getRunProgress('run_abc123');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/runs/run_abc123/progress');
    expect(progress.done).toBe(50);
    expect(progress.latestProgressAt).toBe('2026-05-29T04:30:00Z');
  });

  it('GETs batch stats', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        totalSpans: 100000,
        statusCounts: { ok: 95000, error: 5000 },
        latencyDistribution: { min: 200, max: 15000, avg: 1200, p50: 1200, p95: 4500, p99: 8900 },
        failureBreakdown: [{ errorCode: 'timeout', count: 3000 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const query = createBenchQueryClient({ baseUrl: 'https://api.example.com/v1' });
    const stats = await query.getBatchStats('batch_xyz');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/batches/batch_xyz/stats');
    expect(stats.totalSpans).toBe(100000);
    expect(stats.statusCounts.ok).toBe(95000);
    expect(stats.latencyDistribution.p50).toBe(1200);
    expect(stats.failureBreakdown[0].errorCode).toBe('timeout');
  });

  it('GETs batch progress', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        runs: [
          { runId: 'run_1', done: 10, inFlight: 0, errors: 0, total: 10, latestProgressAt: '2026-05-29T04:30:00Z' },
        ],
        latestProgressAt: '2026-05-29T04:30:00Z',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const query = createBenchQueryClient({ baseUrl: 'https://api.example.com/v1' });
    const progress = await query.getBatchProgress('batch_xyz');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/batches/batch_xyz/progress');
    expect(progress.runs[0].runId).toBe('run_1');
    expect(progress.latestProgressAt).toBe('2026-05-29T04:30:00Z');
  });

  it('GETs batch metric distribution', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        count: 200,
        min: 100,
        avg: 250.5,
        max: 1200,
        p50: 220,
        p95: 700,
        p99: 950,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const query = createBenchQueryClient({ baseUrl: 'https://api.example.com/v1' });
    const stats = await query.getBatchMetricStats('batch_xyz', {
      name: 'sandbox.result',
      field: 'latency_ms',
    });

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/batches/batch_xyz/metrics/sandbox.result/distribution?field=latency_ms');
    expect(stats.count).toBe(200);
    expect(stats.p95).toBe(700);
  });

  it('throws on non-2xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    vi.stubGlobal('fetch', fetchMock);

    const query = createBenchQueryClient({ baseUrl: 'https://api.example.com/v1' });
    await expect(query.getRun('missing')).rejects.toThrow('Bench query failed: 404 Not Found');
  });

  it('URL-encodes path segments', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ runId: 'run/slash', label: 'test', status: 'completed', tasks: [], spans: [], installId: 'i' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const query = createBenchQueryClient({ baseUrl: 'https://api.example.com/v1' });
    await query.getRun('run/with/slashes');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/runs/run%2Fwith%2Fslashes');
  });
});
