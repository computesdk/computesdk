# @computesdk/bench

Tinybench-style benchmarking helpers for ComputeSDK benchmark events.

`@computesdk/bench` runs warmups + measured iterations and emits `benchmark.config` and `benchmark.span` events with timing and attempt metadata.

## Installation

```bash
npm install @computesdk/bench
```

## Quick Start

```ts
import { createBench } from '@computesdk/bench';

const bench = createBench({
  sdkVersion: '4.x',
  telemetry: {
    endpoint: 'https://bench.example.com/api/v1/events',
  },
});

const result = await bench.run('sandbox.create', async () => {
  // your operation under test
}, {
  iterations: 50,
  warmup: 5,
  provider: 'e2b',
});

console.log(result.stats.p95Ms);
```

## Notes

- Telemetry can be disabled with `COMPUTESDK_TELEMETRY=0`.
- This package does not capture env vars or payload content.
