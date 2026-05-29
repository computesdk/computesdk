---
"@computesdk/bench": patch
---

Add scale-benchmark support to bench SDK

- **Burst mode**: `run({ mode: 'burst', concurrency: 100 })` fires iterations concurrently with built-in semaphore limiting and tracks aggregate latency distributions.
- **Per-span metadata**: `ctx.setMetadata({ ... })` accumulates arbitrary key/value data that gets merged into the emitted `benchmark.span` event.
- **Expanded distributions**: `BenchmarkStats` now includes p10, p25, p50, p75, p90, p95, and p99 percentiles.
- **Metric events**: New `benchmark.metric` event kind and public `bench.emit(name, data)` / `ctx.emitMetric(name, data)` APIs for mid-flight system metrics.
- **Progress events**: New `benchmark.progress` event kind and public `bench.progress({ done, inFlight, errors, total })` API for heartbeat-style progress reporting.
- **Mid-flight span updates**: `BenchContext.setMetadata` and `emitMetric` allow attaching data to the currently-open span before it is finalized.
