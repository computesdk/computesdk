# @computesdk/bench

Client and worker helpers for the ComputeSDK benchmark orchestrator.

This package talks to the platform-owned benchmark/run/participant/worker API. It does not mint canonical run, worker, attempt, event, or task IDs. Workers claim platform-assigned work, execute task indexes in their assigned range, and send `task_results` batches back to the platform.

## Installation

```bash
npm install @computesdk/bench
```

## Define A Worker

```ts
import { defineStep, defineTask, defineWorker } from '@computesdk/bench';
import { compute } from 'computesdk';

const worker = defineWorker({
  benchmarkSlug: 'scale',
  runId: process.env.BENCHMARK_RUN_ID!,
  participantSlug: 'e2b',
  processKind: 'container',
  processKey: process.env.HOSTNAME,
  concurrency: 100,
  task: defineTask('sandbox.lifecycle', [
    defineStep('create', async ({ assignment, state }) => {
      state.sandbox = await compute.sandbox.create({
        provider: assignment.provider ?? 'e2b',
      });
    }),
    defineStep('readiness', async ({ state }) => {
      await (state.sandbox as any).runCommand('true');
    }),
    defineStep('exec.first-command', async ({ state }) => {
      await (state.sandbox as any).runCommand('node -v');
    }),
    defineStep('destroy', async ({ state }) => {
      await (state.sandbox as any).destroy();
    }),
  ]),
});

await worker.run();
```

`worker.run()` claims the next pending platform assignment for the participant. If no work is available, it returns `{ assignment: null, records: [] }`.

## Reuse A Bench Definition

```ts
import { defineBench, defineStep, defineTask } from '@computesdk/bench';

const lifecycleTask = defineTask('sandbox.lifecycle', [
  defineStep('create', async ({ state }) => {
    state.sandboxId = 'sandbox_123';
  }),
  defineStep('exec.first-command', async ({ state }) => ({
    sandboxId: String(state.sandboxId),
  })),
]);

const bench = defineBench({
  slug: 'scale',
  participantSlug: 'e2b',
  concurrency: 100,
  task: lifecycleTask,
});

const worker = bench.defineWorker({
  runId: process.env.BENCHMARK_RUN_ID!,
  processKey: process.env.HOSTNAME,
});

await worker.run();
```

## Create A Platform Run

```ts
import { createBenchmarkClient } from '@computesdk/bench';

const client = createBenchmarkClient({
  apiKey: process.env.COMPUTESDK_API_KEY,
});

await client.upsertBenchmark('scale', {
  name: 'Scale',
  kind: 'scale',
  config: { timeoutMs: 120_000 },
});

const { run } = await client.createRun('scale', {
  name: '10k smoke',
  totalTasks: 10_000,
  workerCount: 20,
  participants: ['e2b', 'modal'],
  config: { timeoutMs: 120_000 },
});

console.log(run.id);
```

## API

### Definition Helpers

```ts
defineStep(name, fn)
defineTask(name, steps)
defineWorker(options)
defineBench(options)
```

Step functions receive:

| Field | Type | Description |
|-------|------|-------------|
| `assignment` | `BenchmarkAssignment` | Platform-owned assignment for this worker |
| `taskIndex` | `number` | Deterministic task index within the benchmark run |
| `state` | `Record<string, unknown>` | Mutable per-task state shared across steps |

If a step returns a JSON object, it is merged into the task result `data` object. Defined tasks also include `taskName` in `data`.

### Low-Level Client

```ts
client.claimWorker(benchmarkSlug, runId, participantSlug, { processKind, processKey })
client.sendTaskResults({ benchmarkSlug, runId, workerId, attemptId, sequenceNumber, isFinal, records })
client.heartbeatWorker(benchmarkSlug, runId, workerId, attemptId)
client.completeWorker(benchmarkSlug, runId, workerId, attemptId)
client.failWorker(benchmarkSlug, runId, workerId, attemptId, error)
client.runWorker(options)
```

Most workers should use `defineWorker(...).run()`.

## Task Result Shape

```json
{
  "taskIndex": 0,
  "status": "success",
  "startedAt": "2026-06-03T00:00:00.000Z",
  "completedAt": "2026-06-03T00:00:01.000Z",
  "latencyMs": 1000,
  "steps": [
    { "name": "create", "status": "success", "startedAt": "...", "completedAt": "...", "latencyMs": 700 },
    { "name": "exec.first-command", "status": "success", "startedAt": "...", "completedAt": "...", "latencyMs": 120 },
    { "name": "destroy", "status": "success", "startedAt": "...", "completedAt": "...", "latencyMs": 180 }
  ],
  "data": {
    "taskName": "sandbox.lifecycle",
    "sandboxId": "..."
  }
}
```
