# @computesdk/bench

## 0.1.1

### Patch Changes

- 607a11b: Redesign `@computesdk/bench` with a suite-based API and move benchmark recording into the bench package.

  **`@computesdk/bench` (breaking)**

  - Replace single-shot `bench.run(operation, fn, options)` with a suite API: `bench.add(name, fn)` + `bench.run(options)`
  - `createBench()` now requires a `label` field — the human-readable suite name used as the primary grouping key in benchmark events
  - Task functions receive a `BenchContext` (`ctx.iteration`, `ctx.phase`, `ctx.taskName`, `ctx.log(...)`) instead of a bare iteration index
  - `ctx.log()` entries are attached as redacted `logs[]` on the benchmark span for that iteration
  - Remove `sdkVersion` from `BenchConfig` — version is now auto-detected via build-time injection
  - Add optional `apiUrl` / `apiKey` on `BenchConfig`; when omitted, events are local-only via `onEvent`
  - Upload benchmark events in background batches with a bounded queue and best-effort final flush
  - Add optional `groupId` and `shard` metadata for multi-process/sharded benchmark runs
  - Add optional `captureOutput.file` / `captureOutput.flushInterval` to emit tailed process output as `benchmark.output` events
  - Return type changes from `BenchResult` to `BenchSuiteResult` with per-task stats

  **`@computesdk/bench` benchmark primitives**

  - Add `BenchSuiteEvent` (`benchmark.suite`) emitted once per `bench.run()` with label, task names, provider, iterations, and warmup
  - Add `BenchEvent`, `BenchSpanEvent`, `BenchOutputEvent`, and `BenchAttempt` types
  - Add shared benchmark helpers for IDs, runtime detection, error codes, and event emission
  - Print a Tinybench-style summary table to stdout after `bench.run()` completes

  **`computesdk` (patch)**

  - Remove the experimental automatic telemetry configuration/export surface while bench is redesigned independently

## 0.1.0

- Initial release.
- Add Tinybench-style `createBench().run(...)` API.
- Emit ComputeSDK-compatible `benchmark.config` and `benchmark.span` events.
