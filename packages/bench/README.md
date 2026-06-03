# @computesdk/bench

Client and worker helpers for the ComputeSDK benchmark orchestrator.

This package talks to the platform-owned benchmark/run/participant/shard API. It does not mint canonical run, shard, attempt, event, or task IDs. Workers claim platform-assigned shards, execute task indexes in their assigned range, and send `task_results` batches back to the platform.

## Installation

```bash
npm install @computesdk/bench
```

## Create A Benchmark Run

```ts
import { createBenchmarkClient } from '@computesdk/bench';

const bench = createBenchmarkClient({
  apiKey: process.env.COMPUTESDK_API_KEY,
});

await bench.upsertBenchmark('scale', {
  name: 'Scale',
  kind: 'scale',
  config: { timeoutMs: 120_000 },
});

const { run } = await bench.createRun('scale', {
  name: '10k smoke',
  totalTasks: 10_000,
  shardCount: 20,
  participants: ['e2b', 'modal'],
  config: { timeoutMs: 120_000 },
});

console.log(run.id);
```

## Run A Worker Shard

```ts
import { createBenchmarkClient } from '@computesdk/bench';
import { compute } from 'computesdk';

const bench = createBenchmarkClient();

await bench.runShard({
  benchmarkSlug: 'scale',
  runId: process.env.BENCHMARK_RUN_ID!,
  participantSlug: 'e2b',
  workerKind: 'container',
  workerId: process.env.HOSTNAME,
  concurrency: 100,
  async task({ taskIndex, step }) {
    const sandbox = await step('create', () => compute.sandbox.create());
    try {
      await step('exec.first-command', () => sandbox.runCommand('node -v'));
      return { sandboxId: sandbox.sandboxId, taskIndex };
    } finally {
      await step('destroy', () => sandbox.destroy());
    }
  },
});
```

`runShard()` claims the next pending shard for the participant. If no shard is available, it returns `{ assignment: null, records: [] }`.
Each task receives `step(name, fn)`, which records named step timings in `record.steps`.

## API

### `createBenchmarkClient(config?)`

| Field | Type | Description |
|-------|------|-------------|
| `baseUrl` | `string?` | API base URL. Defaults to `https://platform.computesdk.com/api/v1` |
| `apiKey` | `string?` | Bearer token. Defaults to `process.env.COMPUTESDK_API_KEY` |
| `fetch` | `typeof fetch?` | Custom fetch implementation |

### Setup Methods

```ts
client.upsertBenchmark(slug, input)
client.getBenchmark(slug)
client.listBenchmarks()
client.createRun(benchmarkSlug, input)
client.listRuns(benchmarkSlug)
client.getRun(benchmarkSlug, runId)
client.upsertParticipant(benchmarkSlug, runId, participantSlug, input)
client.listParticipants(benchmarkSlug, runId)
client.getParticipant(benchmarkSlug, runId, participantSlug)
client.listShards(benchmarkSlug, runId, participantSlug)
```

### Worker Methods

```ts
client.claimShard(benchmarkSlug, runId, participantSlug, { workerKind, workerId })
client.sendTaskResults({ benchmarkSlug, runId, shardId, attemptId, sequenceNumber, isFinal, records })
client.heartbeatShard(benchmarkSlug, runId, shardId, attemptId)
client.completeShard(benchmarkSlug, runId, shardId, attemptId)
client.failShard(benchmarkSlug, runId, shardId, attemptId, error)
client.runShard(options)
```

`runShard()` task functions receive:

| Field | Type | Description |
|-------|------|-------------|
| `assignment` | `BenchmarkAssignment` | Platform-owned shard and attempt assignment |
| `taskIndex` | `number` | Deterministic task index within the benchmark run |
| `step` | `(name, fn) => Promise<T>` | Measures a named sub-operation and attaches it to `steps` |

`sendTaskResults()` posts to:

```http
POST /api/v1/benchmarks/:benchmarkSlug/runs/:runId/shards/:shardId/events
```

with this payload shape:

```json
{
  "type": "task_results",
  "attemptId": "...",
  "sequenceNumber": 0,
  "isFinal": false,
  "records": [
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
        "sandboxId": "..."
      }
    }
  ]
}
```
