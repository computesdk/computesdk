// Client-only control: real adapter, native SDK and HTTP/2; zero server delay.
// This is a mock service, not evidence of sandbox readiness or production TTI.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { cpus } from 'node:os';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

if (process.argv[2] === '--compare') {
  if (!process.argv[3]) throw new Error('Usage: bench:client --compare <alternating ruler result directory>');
  await (await import('./client-comparison.mjs')).compare(process.argv[3]);
  process.exit(0);
}

const artifactSha256 = createHash('sha256').update(readFileSync(new URL('../dist/index.mjs', import.meta.url))).digest('hex');
const sdkVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).dependencies['@tangle-network/sandbox'];

// Keep mock-server parsing/assertions off the client's event loop.
const server = fork(new URL('./client-latency-server.mjs', import.meta.url), [], {
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
});
const watchdog = setTimeout(() => server.kill(), 30_000);
watchdog.unref();
const serverExited = once(server, 'exit').then(() => { throw new Error('Mock server exited before the control finished.'); });
const [{ baseUrl }] = await Promise.race([once(server, 'message'), serverExited]);
const stats = async () => {
  const reply = once(server, 'message');
  server.send('stats');
  return (await Promise.race([reply, serverExited]))[0];
};

try {
  // Use the existing endpoint setting before import. No authenticated warm-up,
  // handshake wait, command warm-up, retries or global fetch replacement.
  process.env.TANGLE_SANDBOX_BASE_URL = baseUrl;
  const importStart = performance.now();
  const { tangle } = await import('../dist/index.mjs');
  const { createCompute } = await import('@computesdk/provider');
  const importMs = performance.now() - importStart;
  const compute = createCompute({ defaultProvider: tangle({ apiKey: 'client-control', baseUrl }) });
  // No IPC, network request or handshake wait between provider setup and timing.
  const cpuStart = process.cpuUsage();
  const burstStart = performance.now();
  const results = await Promise.allSettled(Array.from({ length: 100 }, async () => {
    const start = performance.now();
    const instance = await compute.sandbox.create();
    try {
      const result = await instance.runCommand('node -v');
      const elapsed = performance.now() - start;
      assert.ok(instance.getInstance().connection?.runtimeUrl);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, process.version + '\n');
      return elapsed;
    } finally {
      // Outside each sample's clock, overlapping later creates/commands as on the board.
      await instance.destroy();
    }
  }));
  const burstMs = performance.now() - burstStart;
  const cpuUsageMicroseconds = process.cpuUsage(cpuStart);
  const { connections, requests, live } = await stats();
  const samples = results.filter((result) => result.status === 'fulfilled').map((result) => result.value).sort((a, b) => a - b);
  const failures = results.filter((result) => result.status === 'rejected').map((result) => String(result.reason));
  const p50 = samples.length === 100 ? (samples[49] + samples[50]) / 2 : null;
  const p91 = samples.length === 100 ? samples[90] : null;
  const p95 = samples.length === 100 ? samples[94] : null;
  const weightedMs = p50 === null ? null : 0.6 * p50 + 0.25 * p91 + 0.15 * p95;
  console.log(JSON.stringify({
    scope: 'client-only, zero-delay local HTTP/2 mock; no production claim',
    measuredAt: new Date().toISOString(), artifactSha256, sdkVersion,
    node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
    concurrency: 100, success: samples.length, importMs,
    connections, requests, live, burstMs, cpuUsageMicroseconds,
    p50, p91, p95, weightedMs,
    target: { p50: 30, p95: 55, weightedMs: 40 },
    passed: samples.length === 100 && p50 <= 30 && p95 <= 55 && weightedMs <= 40,
    failures, samples,
  }, null, 2));
  assert.equal(samples.length, 100);
  assert.deepEqual(requests, { create: 100, exec: 100, destroy: 100, other: 0 });
  assert.equal(connections, 4);
  assert.equal(live, 0);
  // Report timing without making machine contention a flaky CI failure.
} finally {
  clearTimeout(watchdog);
  if (server.connected) server.disconnect();
  if (server.exitCode === null && server.signalCode === null) await once(server, 'exit');
}
