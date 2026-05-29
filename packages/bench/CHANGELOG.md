# @computesdk/bench

## 0.1.4

### Patch Changes

- 42d5a76: Refine bench step scheduling for concurrent lifecycle workloads.

  - Make `bench.add(...)` chainable and add optional step controls:
    - `concurrency` to cap a specific step
    - `runOnFailed` to run cleanup/finalizer steps for failed iterations
  - Use pipeline-style stage execution by default so steps run in declaration order across iterations.
  - Keep same-stage execution resilient by continuing peer iterations when one iteration fails.
  - Skip failed iterations in later steps unless `runOnFailed` is enabled for that step.
  - Update bench README examples/docs to match the new step scheduling semantics.

## 0.1.3

### Patch Changes

- fc2cd47: Unify bench SDK read/write configuration around `baseUrl` with sane defaults.

  - `createBench({ baseUrl?, apiKey?, ... })`
    - `baseUrl` now defaults to `https://platform.computesdk.com/api/v1`
    - ingest endpoint resolves to `${baseUrl}/events`
  - `createBenchQueryClient({ baseUrl?, apiKey? })`
    - now accepts optional config object
    - defaults match `createBench`
  - Query methods exposed on `createBench(...)` continue to use the same shared base URL and auth.

## 0.1.2

### Patch Changes

- 1bc008e: Add scale-benchmark support to bench SDK

  - **Burst mode**: `run({ mode: 'burst', concurrency: 100 })` fires iterations concurrently with built-in semaphore limiting and tracks aggregate latency distributions.
  - **Per-span metadata**: `ctx.setMetadata({ ... })` accumulates arbitrary key/value data that gets merged into the emitted `benchmark.span` event.
  - **Expanded distributions**: `BenchmarkStats` now includes p10, p25, p50, p75, p90, p95, and p99 percentiles.
  - **Metric events**: New `benchmark.metric` event kind and public `bench.emit(name, data)` / `ctx.emitMetric(name, data)` APIs for mid-flight system metrics.
  - **Progress events**: New `benchmark.progress` event kind and public `bench.progress({ done, inFlight, errors, total })` API for heartbeat-style progress reporting.
  - **Mid-flight span updates**: `BenchContext.setMetadata` and `emitMetric` allow attaching data to the currently-open span before it is finalized.

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
