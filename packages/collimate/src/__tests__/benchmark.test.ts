/**
 * ComputeSDK-style benchmark: measures TTI (Time-to-Interactive).
 *
 * TTI = time from create() to first successful runCommand("node -v").
 * This mirrors exactly what ComputeSDK measures on their leaderboard.
 *
 * Modes:
 *   - Sequential: one sandbox at a time (baseline)
 *   - Staggered: 200ms delays between launches
 *   - Burst: all launched concurrently
 *
 * Usage:
 *   BENCHMARK=1 COLLIMATE_SERVER_URL=http://localhost:8080 \
 *   COLLIMATE_TEMPLATE_ID=node \
 *   npx vitest run benchmark
 */

import { describe, it, expect } from "vitest";
import { CollimateClient } from "../client.js";

const SKIP = !process.env.BENCHMARK;
const SERVER_URL = process.env.COLLIMATE_SERVER_URL || "http://localhost:18080";
const API_KEY = process.env.COLLIMATE_API_KEY || "dummy";
const TEMPLATE_ID = process.env.COLLIMATE_TEMPLATE_ID || "node";
const N = parseInt(process.env.BENCH_N || "20", 10);
const COMMAND = process.env.BENCH_CMD || "node -v";

interface TTIResult {
  sandboxId: string;
  createMs: number;
  execMs: number;
  ttiMs: number;
  stdout: string;
  success: boolean;
}

async function measureTTI(client: CollimateClient): Promise<TTIResult> {
  const t0 = performance.now();

  // Create sandbox (session)
  const session = await client.createSession(TEMPLATE_ID);
  const tCreate = performance.now();
  const createMs = tCreate - t0;

  // Run command (the "Interactive" part of TTI)
  const resp = await client.execSession(session.session_id, {
    commands: [["bash", "-lc", COMMAND]],
    timeout_seconds: 30,
  });
  const tExec = performance.now();
  const execMs = tExec - tCreate;
  const ttiMs = tExec - t0;

  // Destroy
  await client.deleteSession(session.session_id, true);

  return {
    sandboxId: session.session_id,
    createMs,
    execMs,
    ttiMs,
    stdout: resp.stdout.trim(),
    success: resp.exit_code === 0,
  };
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const pct = (p: number) => sorted[Math.min(Math.floor(p / 100 * n), n - 1)];
  return {
    min: sorted[0],
    max: sorted[n - 1],
    avg: sum / n,
    median: pct(50),
    p95: pct(95),
    p99: pct(99),
    count: n,
  };
}

function printStats(label: string, values: number[]) {
  const s = stats(values);
  console.log(`\n  ${label} (${s.count} iterations):`);
  console.log(`    Min:    ${s.min.toFixed(1)} ms`);
  console.log(`    Median: ${s.median.toFixed(1)} ms`);
  console.log(`    Avg:    ${s.avg.toFixed(1)} ms`);
  console.log(`    P95:    ${s.p95.toFixed(1)} ms`);
  console.log(`    P99:    ${s.p99.toFixed(1)} ms`);
  console.log(`    Max:    ${s.max.toFixed(1)} ms`);
}

describe.skipIf(SKIP)(`ComputeSDK Benchmark (N=${N}, cmd="${COMMAND}")`, () => {
  let client: CollimateClient;

  it("connects", () => {
    client = new CollimateClient({ serverUrl: SERVER_URL, apiKey: API_KEY });
    console.log(`\n  Server: ${SERVER_URL}`);
    console.log(`  Template: ${TEMPLATE_ID}`);
    console.log(`  Command: ${COMMAND}`);
    console.log(`  Iterations: ${N}`);
  });

  // ── Sequential: one at a time ─────────────────────────────────────
  it(`Sequential: ${N} iterations`, async () => {
    const results: TTIResult[] = [];

    for (let i = 0; i < N; i++) {
      const r = await measureTTI(client);
      results.push(r);
      expect(r.success).toBe(true);
    }

    const ttis = results.map((r) => r.ttiMs);
    const creates = results.map((r) => r.createMs);
    const execs = results.map((r) => r.execMs);

    console.log("\n=== SEQUENTIAL ===");
    printStats("TTI (create + exec)", ttis);
    printStats("Create only", creates);
    printStats("Exec only", execs);
    console.log(`  First stdout: ${results[0].stdout}`);
    console.log(`  Success: ${results.filter((r) => r.success).length}/${N}`);

    const s = stats(ttis);
    // ComputeSDK scoring: 100 * (1 - median_ms / 10000)
    const score = 100 * (1 - s.median / 10000);
    console.log(`\n  ComputeSDK composite (median-only): ${score.toFixed(1)}`);
  }, 300_000);

  // ── Staggered: 200ms delays ───────────────────────────────────────
  it(`Staggered (200ms delay): ${N} iterations`, async () => {
    const promises: Promise<TTIResult>[] = [];

    for (let i = 0; i < N; i++) {
      promises.push(measureTTI(client));
      if (i < N - 1) await new Promise((r) => setTimeout(r, 200));
    }

    const results = await Promise.all(promises);
    const ttis = results.map((r) => r.ttiMs);

    console.log("\n=== STAGGERED (200ms) ===");
    printStats("TTI", ttis);
    console.log(`  Success: ${results.filter((r) => r.success).length}/${N}`);

    expect(results.every((r) => r.success)).toBe(true);
  }, 300_000);

  // ── Burst: all concurrent ─────────────────────────────────────────
  it(`Burst: ${N} concurrent`, async () => {
    const t0 = performance.now();
    const promises = Array.from({ length: N }, () => measureTTI(client));
    const results = await Promise.all(promises);
    const wallMs = performance.now() - t0;

    const ttis = results.map((r) => r.ttiMs);

    console.log("\n=== BURST (all concurrent) ===");
    console.log(`  Wall-clock: ${wallMs.toFixed(0)} ms`);
    printStats("TTI", ttis);
    console.log(`  Success: ${results.filter((r) => r.success).length}/${N}`);

    expect(results.every((r) => r.success)).toBe(true);
  }, 300_000);
});
