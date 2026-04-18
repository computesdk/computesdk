import { dimension } from './packages/dimension/src/index';

interface BenchmarkResult {
  iteration: number;
  duration: number;
  success: boolean;
}

async function benchmarkDimension(iterations: number = 10): Promise<void> {
  const results: BenchmarkResult[] = [];

  const provider = dimension({
    apiKey: process.env.DIMENSION_API_KEY || 'test-key'
  });

  console.log(`Starting Dimension sandbox benchmark (${iterations} iterations)...`);
  console.log('━'.repeat(60));

  for (let i = 0; i < iterations; i++) {
    const startTime = performance.now();
    let success = false;

    try {
      const sandbox = await provider.sandbox.create();
      success = true;
      await sandbox.destroy().catch(() => {});
    } catch (error) {
      console.error(`Iteration ${i + 1} failed:`, error);
    }

    const duration = performance.now() - startTime;
    results.push({ iteration: i + 1, duration, success });

    console.log(
      `[${i + 1}/${iterations}] ${success ? '✓' : '✗'} ${duration.toFixed(0)}ms`
    );
  }

  // Calculate metrics
  const successfulRuns = results.filter(r => r.success).map(r => r.duration);
  const successRate = (successfulRuns.length / results.length) * 100;

  if (successfulRuns.length === 0) {
    console.log('\n⚠️  No successful runs to benchmark');
    return;
  }

  // Sort for percentile calculation
  const sorted = [...successfulRuns].sort((a, b) => a - b);

  // Trim outliers (bottom 5% and top 5%)
  const trimCount = Math.ceil(sorted.length * 0.05);
  const trimmed = sorted.slice(trimCount, sorted.length - trimCount);

  if (trimmed.length === 0) {
    console.log('\n⚠️  Not enough runs after outlier trimming');
    return;
  }

  // Calculate statistics
  const median = trimmed[Math.floor(trimmed.length / 2)];
  const p95Index = Math.ceil(trimmed.length * 0.95) - 1;
  const p99Index = Math.ceil(trimmed.length * 0.99) - 1;
  const p95 = trimmed[Math.max(0, p95Index)];
  const p99 = trimmed[Math.max(0, p99Index)];

  // Score calculation: score = 100 × (1 − value / 10,000ms)
  const scoreMetric = (duration: number): number => {
    return Math.max(0, 100 * (1 - duration / 10000));
  };

  const medianScore = scoreMetric(median);
  const p95Score = scoreMetric(p95);
  const p99Score = scoreMetric(p99);

  // Weighted composite score: Median (60%), P95 (25%), P99 (15%)
  const compositeScore =
    medianScore * 0.6 + p95Score * 0.25 + p99Score * 0.15;

  // Apply reliability penalty (multiply by success rate)
  const finalScore = compositeScore * (successRate / 100);

  console.log('\n' + '━'.repeat(60));
  console.log('📊 DIMENSION SANDBOX BENCHMARK RESULTS');
  console.log('━'.repeat(60));
  console.log(`Success Rate: ${successRate.toFixed(1)}%`);
  console.log(`\nTiming Metrics (after trimming outliers):`);
  console.log(`  Median:  ${median.toFixed(0)}ms (score: ${medianScore.toFixed(1)})`);
  console.log(`  P95:     ${p95.toFixed(0)}ms (score: ${p95Score.toFixed(1)})`);
  console.log(`  P99:     ${p99.toFixed(0)}ms (score: ${p99Score.toFixed(1)})`);
  console.log(`\nWeighted Scores:`);
  console.log(`  Median (60%):  ${(medianScore * 0.6).toFixed(1)}`);
  console.log(`  P95 (25%):     ${(p95Score * 0.25).toFixed(1)}`);
  console.log(`  P99 (15%):     ${(p99Score * 0.15).toFixed(1)}`);
  console.log(`\n🎯 COMPOSITE SCORE: ${finalScore.toFixed(1)}/100`);
  console.log('━'.repeat(60));
}

benchmarkDimension(10).catch(console.error);
