import type { BenchmarkStats } from './types';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export function buildStats(durations: number[]): BenchmarkStats {
  if (durations.length === 0) {
    return {
      count: 0,
      minMs: 0,
      maxMs: 0,
      meanMs: 0,
      medianMs: 0,
      p95Ms: 0,
    };
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, ms) => acc + ms, 0);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  return {
    count: sorted.length,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    meanMs: sum / sorted.length,
    medianMs: median,
    p95Ms: percentile(sorted, 95),
  };
}
