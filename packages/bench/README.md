# @computesdk/bench

Tinybench-style benchmarking toolkit for ComputeSDK.

`@computesdk/bench` runs warmups + measured iterations across named pipeline steps and emits structured benchmark events.

## Installation

```bash
npm install @computesdk/bench
```

## Quick Start

```ts
import { createBench } from '@computesdk/bench';
import { compute } from 'computesdk';

const bench = createBench({
  label: 'sandbox-lifecycle',
  batch: 'burst-100k-e2b',
  shard: { index: 0, count: 100 },
  captureOutput: { file: '/root/run.log' },
});

const sandboxes: Array<{ sandboxId: string; runCommand: (cmd: string) => Promise<unknown>; destroy: () => Promise<void> } | undefined> = [];

bench
  .add('create', async (ctx) => {
    ctx.log('booting sandbox...');
    sandboxes[ctx.iteration] = await compute.sandbox.create();
  })
  .add('exec', async (ctx) => {
    await sandboxes[ctx.iteration]?.runCommand('node -v');
  }, { concurrency: 100 })
  .add('destroy', async (ctx) => {
    await sandboxes[ctx.iteration]?.destroy();
  }, { runOnFailed: true });

const result = await bench.run({
  iterations: 25,
  warmup: 3,
  mode: 'concurrent',
  concurrency: 100,
  provider: 'e2b',
});

for (const task of result.tasks) {
  console.log(`${task.taskName}: p95=${task.stats.p95Ms}ms`);
}
```

## Scale Lifecycle Pattern

For scale/lifecycle benchmarks, model each lifecycle phase as a step and let
`iterations` represent unit count.

```ts
import { createBench } from '@computesdk/bench';

const bench = createBench({ label: 'scale.e2b' });
const sandboxes: Array<any | undefined> = [];

bench
  .add('create', async (ctx) => {
    sandboxes[ctx.iteration] = await compute.sandbox.create();
  }, { concurrency: 100 })
  .add('exec.initial', async (ctx) => {
    await sandboxes[ctx.iteration]?.runCommand('node -v');
  }, { concurrency: 100 })
  .add('exec.concurrent', async (ctx) => {
    await sandboxes[ctx.iteration]?.runCommand('node -v');
  }, { concurrency: 100 })
  .add('destroy', async (ctx) => {
    await sandboxes[ctx.iteration]?.destroy();
  }, { runOnFailed: true, concurrency: 100 });

await bench.run({
  mode: 'concurrent',
  iterations: 100,
  concurrency: 100,
  warmup: 0,
});
```

This gives step-level timing (`create`, `exec.initial`, `exec.concurrent`,
`destroy`) where each step's `Runs` naturally maps to unit count.

## API

### `createBench(config)`

| Field | Type | Description |
|-------|------|-------------|
| `label` | `string` | Human-readable run label |
| `baseUrl` | `string?` | Optional base URL for ingest/query APIs. Defaults to `https://platform.computesdk.com/api/v1` |
| `apiKey` | `string?` | Optional bearer token used for ingest/query requests. Defaults to `process.env.COMPUTESDK_API_KEY` |
| `batch` | `string?` | Shared logical batch id for multi-process/sharded runs |
| `shard` | `{ index: number; count: number }?` | Shard metadata for this process. `index` is zero-based |
| `onEvent` | `function?` | Local debug hook called with every emitted event |
| `captureOutput` | `{ file: string; flushInterval?: number }?` | Tail a process log file and emit `benchmark.output` events. `flushInterval` is milliseconds and defaults to `30000` |

Returns `{ add, run, emit, progress, ...query }`.

### `bench.add(taskName, fn, options?)`

Register a named pipeline step. `fn` receives a `BenchContext`.
`add()` is chainable.

`options`:

| Field | Type | Description |
|-------|------|-------------|
| `concurrency` | `number?` | Per-step concurrency cap (used in concurrent mode) |
| `runOnFailed` | `boolean?` | Run this step for iterations that failed earlier steps (useful for cleanup) |

`BenchContext`:

| Field | Type | Description |
|-------|------|-------------|
| `ctx.iteration` | `number` | Current iteration index within the current phase (0-based) |
| `ctx.phase` | `'warmup' \| 'measured'` | Current phase |
| `ctx.taskName` | `string` | Name of the current task |
| `ctx.log(...args)` | `function` | Attach a log message to this iteration's benchmark span |

### `bench.run(options?)`

| Option | Default | Description |
|--------|---------|-------------|
| `iterations` | `25` | Measured iterations per task |
| `warmup` | `3` | Warmup iterations before measuring |
| `mode` | `'sequential'` | Run iterations sequentially or concurrently |
| `concurrency` | `iterations` | In concurrent mode, max in-flight iterations |
| `provider` | — | Provider name tag applied to all spans |
| `throwOnError` | `true` | Re-throw the first error encountered |

Returns a `BenchSuiteResult`:

```ts
{
  label: string;
  runId: string;
  tasks: Array<{
    taskName: string;
    successes: number;
    failures: number;
    stats: { count, minMs, meanMs, medianMs, p95Ms, maxMs };
  }>;
}
```

## Event Hierarchy

Each `bench.run()` emits:

```
benchmark.run    — once per run (label, tasks, provider, iterations, warmup)
  benchmark.span — once per iteration per task (timing, status, logs)
  benchmark.output — captured process output lines when captureOutput is configured
```

Execution semantics:

- Steps run in declaration order.
- In concurrent mode, each step runs across eligible iterations up to the step concurrency cap.
- Failures in one iteration do not block peer iterations in the same step.
- Later steps skip failed iterations unless that step sets `runOnFailed: true`.

All span and output events carry `runId` plus `label` so results can be grouped per run.
For sharded runs, set the same `batch` on each process and unique `shard.index` values so the API can aggregate multiple `runId`s into one logical benchmark.

## Notes

- Network upload uses `${baseUrl}/events` (`baseUrl` defaults to `https://platform.computesdk.com/api/v1`).
- For ingest auth, clients send a token via `apiKey` (Bearer auth header) and the server validates the API key.
- Network uploads are batched in the background with one in-flight request, and API failures do not fail the benchmark.
- `ctx.log()` messages are attached to span events and redacted.
- `captureOutput.file` tails from the beginning of the file, flushes periodically, and flushes once more when the run exits.
- This package does not capture env vars or payload content.
