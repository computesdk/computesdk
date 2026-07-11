# Design Doc: Unified Bench CLI + SDK

## Status

Draft — July 2026

## Problem

PR #636 introduces `@computesdk/bench-cli`, a vitest-style runner for `*.bench.ts` files. The local runner is solid. The `--remote` mode and the relationship between the CLI and the `@computesdk/bench` SDK are not.

Three concrete problems:

1. **Two worker implementations that do not compose.** The SDK's `runWorker()` has real concurrency (`mapPool`), automatic heartbeats, batched flushing, and step-level concurrency barriers. The CLI's `--remote` mode ignores all of that and reimplements a sequential loop using `BenchmarkReporter.claim()` directly. `--concurrency` does nothing because the CLI never calls the code that implements it.

2. **Two authoring APIs with no clear boundary.** `bench()`/`describe()` is the simple path (ops/sec, local). `defineTask()`/`defineStep()` is the platform path (multi-step, remote). They share an import path but not an execution model. Users do not know which to use or when.

3. **`--remote` does not run remotely.** Workers fork as local child processes. The only thing remote is the platform API. The name creates a false expectation.

This doc proposes a unified design that fixes all three. Since there is zero external usage of either package, we can redesign freely.

## Design Goals

- One authoring API with two levels of complexity: `bench()` for micro-benchmarks, `defineTask()`/`defineStep()` for multi-phase workloads. Both coexist in the same `*.bench.ts` files.
- One execution path: the SDK's `runWorker()` handles concurrency, heartbeats, and flushing for both local and remote runs. The CLI does not reimplement worker logic.
- One CLI: `bench` discovers files, loads entries, runs them locally or on the platform. No fork-and-reimplement.
- Remote execution that actually runs remotely: bench files ship to the platform, the platform builds and runs them in sandboxes. No local Docker required for the default path.
- The scale coordinator pattern in `computesdk/benchmarks/src/scale/sdk-coordinator.ts` is the reference implementation for what `--remote` should look like.

## Authoring API

### Two primitives, one file

```ts
// benchmarks/sandbox-latency.bench.ts
import { bench, describe, defineTask, defineStep } from '@computesdk/bench-cli';

// Simple: measure ops/sec
describe('string operations', () => {
  bench('concatenation', () => 'a' + 'b' + 'c');
  bench('template literal', () => `${'a'}${'b'}${'c'}`);
});

// Advanced: multi-phase workload with per-step latency
defineTask('sandbox.lifecycle', [
  defineStep('create', async ({ state }) => {
    state.sandbox = await compute.sandbox.create();
  }),
  defineStep('exec.initial', async ({ state }) => {
    await state.sandbox.runCommand('node -v');
  }),
  defineStep('sandbox.live', async () => {
    await new Promise(r => setTimeout(r, 90_000));
  }),
  defineStep('exec.final', async ({ state }) => {
    await state.sandbox.runCommand('node -v');
  }),
  defineStep('destroy', async ({ state }) => {
    await state.sandbox?.destroy();
  }),
]);
```

### How they relate

| Primitive | Measures | Use case | Platform mapping |
|-----------|----------|----------|------------------|
| `bench(name, fn)` | ops/sec, mean, p50, stdev, rme | Micro-benchmarks, regression detection | Single-step task, `total` replications |
| `describe(name, fn)` | (grouping only) | Organizing related benches | Group label in task metadata |
| `defineTask(name, steps[])` | Per-step latency, status per step | Multi-phase workloads (sandbox lifecycle, API load tests) | Multi-step task, `total` replications |
| `defineStep(name, fn)` | Latency for one phase | Sub-unit of a task | `TaskStepRecord` in `TaskResultRecord` |

### What is removed from the public API

- `defineBench()` — was a wrapper around `defineWorker()` with a slug. The CLI handles slug/worker creation. Users never call this.
- `defineWorker()` — was a factory for claiming a worker and running a task. The CLI/SDK handles this internally. Users never call this.

These become internal SDK functions used by the worker execution layer. They are not exported from `@computesdk/bench-cli`.

### Options

Both primitives accept the same options shape:

```ts
interface BenchOptions {
  iterations?: number;    // measured iterations (default 100)
  warmup?: number;        // discarded warmup iterations (default 5)
  setup?: () => void | Promise<void>;
  teardown?: () => void | Promise<void>;
}
```

`defineTask` additionally accepts per-task options:

```ts
interface DefineTaskOptions {
  cleanup?: (ctx: CleanupContext) => Promise<void> | void;
}
```

`defineStep` accepts step-level options (unchanged from current SDK):

```ts
interface DefineStepOptions {
  reportConcurrency?: boolean;
  concurrency?: number;
  readiness?: 'poll' | 'internal';
  readyPollIntervalMs?: number;
  readyTimeoutMs?: number;
}
```

## Execution Model

### Local mode (default)

```
bench
bench run benchmarks/*.bench.ts
```

1. CLI discovers `*.bench.ts` files under `./benchmarks/` (or explicit paths).
2. CLI loads each file via `tsx`, collecting registered `bench()` and `defineTask()` entries into a fresh per-file registry.
3. CLI runs entries sequentially through the local runner:
   - `bench()` entries: measure wall-clock time per iteration, compute ops/sec, mean, p50, stdev, rme.
   - `defineTask()` entries: execute steps in order, record per-step latency and status.
4. Reporter prints results (TUI or JSON).

The local runner is the existing `runner.ts` from PR #636, extended to handle `defineTask` entries in addition to `bench()` entries.

### Remote mode (`--platform`)

```
bench --platform
bench --platform --total 500 --workers 4 --concurrency 10
```

Renamed from `--remote` to `--platform` to accurately describe what it does: orchestrate the run on the ComputeSDK platform.

1. CLI discovers and loads bench files (same as local).
2. CLI ships the bench files + `package.json` + lockfile to the platform (see Remote Execution below).
3. Platform builds the project on its own compute infrastructure (install deps, compile TS). Note: ComputeSDK is a framework that connects to sandbox providers (E2B, Modal, etc.), not a sandbox provider itself. The platform uses its own VM capacity — the same infrastructure it already uses to launch scale test workers.
4. Platform creates a benchmark run, plans workers, and spawns worker VMs from the build output.
5. Each worker VM loads the bench files, claims a task range from the platform, and executes entries through the SDK's `runWorker()`:
   - Real concurrency via `mapPool(taskIndices, concurrency, ...)`
   - Automatic heartbeats
   - Batched result flushing
   - Step-level concurrency barriers (`waitForStepReady`)
6. CLI polls progress and prints a TUI until all workers finish.
7. Platform aggregates results; CLI prints final summary.

The key change: the CLI does NOT fork local processes. It ships files to the platform, and the platform runs workers on its own VMs. The SDK's `runWorker()` is the single execution path for remote work.

## Remote Execution: Ship Files vs Docker Image

### The question

Should `--platform` build a Docker image locally and push it, or should it ship source files to the platform and let the platform build and run them?

### Recommendation: ship files by default, Docker image as opt-in

**Default path: ship files to the platform.**

```
bench --platform
```

The CLI packages the bench files, `package.json`, and lockfile, then uploads them to the platform. The platform builds the project on its own compute infrastructure (VM capacity it already uses for scale test workers) and spawns worker VMs from the build output.

Why this is the right default:

1. **No local Docker required.** The vitest mental model is "run a command, it works." Asking users to install Docker, authenticate to a registry, and wait for image builds breaks that.

2. **Iteration speed.** Shipping TS files + installing deps on a platform VM is much faster than build -> push -> pull -> run, especially with cached `node_modules` layers on the platform.

3. **The platform already has compute capacity.** It launches VMs for scale tests today. The ship-files path reuses that infrastructure with a "build from source" step instead of a pre-built Docker image. No new infrastructure needed — just a new API endpoint.

4. **The scale test is the exception, not the rule.** The existing `benchmarks/src/scale` Dockerfile exists because scale testing needs specific system-level access (provider SDKs, API keys, `/proc` access for metrics). Simple `bench()` micro-benchmarks just need Node.js and `npm install`. The default should optimize for the common case.

**Opt-in path: pre-built Docker image.**

```
bench --platform --image ghcr.io/computesdk/scale-coordinator:latest
```

For workloads that need system-level dependencies, custom runtimes, or specific provider SDKs, users can provide a pre-built image. The platform launches worker containers from that image. The image's entrypoint should be `bench-worker` (or a user-specified command that calls `runWorker`).

This mirrors the existing `benchmarks/src/scale` flow: build the image in CI, push to a registry, point the CLI at it.

### Platform build flow (ship-files path)

```
CLI                          Platform API                    Build/Worker VMs
 |                               |                              |
 |  POST /benchmarks/:slug       |                              |
 |  POST /runs (totalTasks)      |                              |
 |  POST /runs/:id/artifact      |                              |
 |    (upload bench files zip)   |                              |
 |  POST /runs/:id/build         |                              |
 |                               |  launch build VM             |
 |                               |  -> install deps             |
 |                               |  -> compile TS               |
 |                               |  <- build ready              |
 |                               |  launch worker VMs           |
 |                               |    from build output         |
 |                               |                              |
 |  GET /runs/:id/progress       |                              |
 |  <--- progress updates ------+                              |
 |                               |                              |
 |  GET /runs/:id/results        |                              |
 |  <--- final summary ---------+                              |
```

The `POST /runs/:id/build` endpoint is new. It tells the platform to take the uploaded artifact (bench files + package.json), build it on a VM, and spawn worker VMs from the result. This keeps the build logic on the platform side, where it can be cached, shared across workers, and reproduced.

### What about the existing scale coordinator?

The existing `computesdk/benchmarks/src/scale` flow (build Docker image, push, `start.ts` launches VMs) continues to work for scale testing. The CLI's `--platform --image` path is the integration point: the scale coordinator image is built in CI, and `bench --platform --image <scale-image>` launches it through the platform API instead of the custom `start.ts` script.

Over time, `start.ts` can be replaced by `bench --platform --image` + a `benchmarks/scale.bench.ts` file that uses `defineTask`/`defineStep`, unifying the scale test under the same CLI.

## CLI Surface

### Commands

```
bench [run] [files...]     Run benchmarks (default subcommand)
bench list [files...]      List discovered benchmarks without running
bench --platform [files..] Run on the ComputeSDK platform
```

### Flags

Local flags:
```
-i, --iterations <n>     Iterations per benchmark (default 100)
-w, --warmup <n>         Warmup iterations (default 5)
-r, --reporter <fmt>     Reporter: default | json
--bail                   Stop on first failure
--cwd <path>             Working directory
```

Platform flags:
```
--platform               Run on the ComputeSDK platform
--total <n>              Replications per benchmark function (default 100)
--workers <n>            Worker sandboxes to spawn (default 1)
--concurrency <n>        Parallel task slots per worker (default 1)
--participant <slug>     Participant identifier (default bench-cli)
--slug <slug>            Benchmark slug (default derived from filename)
--run-name <name>        Run display name (default derived from filename)
--image <image>          Pre-built Docker image (skips platform build)
--api-key <key>          Platform API key (default env COMPUTESDK_ADMIN_API_KEY)
--base-url <url>         Platform base URL
--poll-interval <ms>     Progress poll interval (default 1000)
--timeout <seconds>      Wall-clock timeout (default 0 = unlimited)
```

General:
```
-h, --help               Show help
-V, --version            Print version
```

### `bench list` output

```
benchmarks/strings.bench.ts  (3)
  • string operations > concatenation
  • string operations > template literal
  • string operations > Array#join

benchmarks/sandbox.bench.ts  (1)
  • sandbox.lifecycle [5 steps: create, exec.initial, sandbox.live, exec.final, destroy]

4 benchmark(s) across 2 file(s).
```

Both `bench()` and `defineTask()` entries are listed. Steps are shown for `defineTask` entries so users can see the structure.

## SDK Changes (`@computesdk/bench`)

### What stays

- `BenchmarkClient` interface and `createBenchmarkClient()` — HTTP plumbing, unchanged
- `BenchmarkReporter` class — claim/flush/heartbeat mechanics, unchanged
- `runWorker()` / `runBenchmarkWorker()` — the concurrent worker execution engine, unchanged
- `TaskResultRecord`, `TaskStepRecord`, `BenchmarkAssignment` — platform types, unchanged

### What changes

- `defineBench()` and `defineWorker()` are removed from the public exports. They become internal functions used by the CLI/worker layer.
- `defineTask()` and `defineStep()` remain public. They are the advanced authoring primitives.
- The worker execution layer gains a new function: `runBenchWorker(options)` — like `runWorker()` but accepts bench entries (`BenchmarkEntry[]`) instead of a `DefinedTask`. Each `bench()` entry is internally translated to a single-step task. `defineTask()` entries pass through with their full step graph.

### New: `runBenchWorker`

```ts
interface RunBenchWorkerOptions {
  benchmarkSlug: string;
  runId: string;
  participantSlug: string;
  entries: readonly BenchmarkEntry[];  // bench() and defineTask() entries
  total: number;                       // replications per entry
  concurrency?: number;
  batchSize?: number;
  apiKey?: string;
  baseUrl?: string;
  onResult?: (record: TaskResultRecord) => void;
}

async function runBenchWorker(options: RunBenchWorkerOptions): Promise<RunWorkerResult>;
```

Internally:
- Each `bench()` entry becomes a task with a single step (`fn` is the step function).
- Each `defineTask()` entry becomes a task with its steps.
- Task index -> entry mapping: `benchIdx = Math.floor(taskIndex / total)`, `repIdx = taskIndex % total`.
- The existing `mapPool(taskIndices, concurrency, ...)` provides parallelism.
- Results include rich metrics in `TaskResultRecord.data` (hz, meanMs, p50, stdev, rme for `bench()` entries; per-step latencies for `defineTask()` entries).

This is the function the CLI calls in `--platform` mode. It replaces the current `runRemoteWorker()` in `bench-cli/src/remote-worker.ts`.

## Package Structure

### `@computesdk/bench` (SDK)

- `createBenchmarkClient`, `BenchmarkClient`, `BenchmarkReporter` — platform plumbing
- `runWorker`, `runBenchmarkWorker` — low-level worker execution
- `runBenchWorker` — new, bench-entry-aware worker execution
- `defineTask`, `defineStep` — advanced authoring primitives
- Types: `TaskResultRecord`, `TaskStepRecord`, `BenchmarkAssignment`, `RunProgress`, etc.
- NOT exported: `defineBench`, `defineWorker` (internal)

### `@computesdk/bench-cli` (CLI)

- `bench`, `describe` — simple authoring primitives
- `defineTask`, `defineStep` — re-exported from `@computesdk/bench` (advanced authoring)
- `runCommand`, `listCommand` — CLI commands
- `discoverBenchFiles`, `loadBenchFile` — file discovery and loading
- `runBenchmarks`, `runSingleBenchmark` — local execution
- `createReporter`, `DefaultReporter`, `JsonReporter` — output
- `runCli` — CLI entry point
- Types: `BenchmarkEntry`, `BenchmarkResult`, `BenchOptions`, etc.

The CLI re-exports `defineTask`/`defineStep` from the SDK so users can import everything from one package. It does NOT re-export `defineBench`/`defineWorker`/`createBenchmarkClient`/`BenchmarkReporter` — those are internal.

## Reporter

### Local TUI

```
 bench  running 2 file(s)
  benchmarks/strings.bench.ts
  benchmarks/sandbox.bench.ts

  ✓ concatenation  12.4M ops/sec  (0.08 µs / iter)
  ✓ template literal  8.2M ops/sec  (0.12 µs / iter)
  ✓ Array#join  3.1M ops/sec  (0.32 µs / iter)
  ✓ sandbox.lifecycle  [create: 420ms, exec.initial: 12ms, live: 90.0s, exec.final: 8ms, destroy: 180ms]

 ✓ 4 benchmark(s) passed in 92.1s across 2 file(s)
```

`bench()` entries show ops/sec. `defineTask()` entries show per-step latencies.

### Platform TUI

```
 bench  planning  sandbox-latency on bench-cli
  file:        benchmarks/sandbox.bench.ts
  benchmarks:  3
  total/bench: 500
  totalTasks:  1500
  workers:     4
  concurrency: 10

 bench  run run-76 started. building on platform...

 progress  status=in_progress  workers=4/4  tasks=750/1500  errors=2
```

### JSON output (`--reporter json`)

```json
{
  "summaries": [
    {
      "file": "benchmarks/strings.bench.ts",
      "results": [
        {
          "id": "string operations / concatenation",
          "name": "concatenation",
          "iterations": 100,
          "hz": 12400000,
          "meanMs": 0.00008,
          "p50Ms": 0.00008,
          "stdevMs": 0.00001,
          "rme": 0.012,
          "status": "success"
        }
      ],
      "totalMs": 12.4,
      "pass": 3,
      "failed": 0
    },
    {
      "file": "benchmarks/sandbox.bench.ts",
      "results": [
        {
          "id": "sandbox.lifecycle",
          "name": "sandbox.lifecycle",
          "steps": [
            { "name": "create", "latencyMs": 420, "status": "success" },
            { "name": "exec.initial", "latencyMs": 12, "status": "success" },
            { "name": "sandbox.live", "latencyMs": 90000, "status": "success" },
            { "name": "exec.final", "latencyMs": 8, "status": "success" },
            { "name": "destroy", "latencyMs": 180, "status": "success" }
          ],
          "status": "success",
          "pass": 1,
          "failed": 0
        }
      ],
      "totalMs": 90620,
      "pass": 1,
      "failed": 0
    }
  ]
}
```

## Migration Path

### Phase 1: Ship the local runner (from PR #636, trimmed)

- Keep: `bench()`, `describe()`, DSL, discovery, loader, local runner, reporter
- Remove: `--remote` mode, `remote.ts`, `remote-worker.ts`, `remote-worker-entry.ts`, `bench-worker` binary
- Remove: all `@computesdk/bench` re-exports from `index.ts`
- Remove: `commander` dependency
- Fix: changeset bumps to `patch`
- This is a clean, shippable local benchmark runner

### Phase 2: Add `defineTask`/`defineStep` to the CLI

- Re-export `defineTask`/`defineStep` from `@computesdk/bench`
- Extend the local runner to handle `defineTask` entries (execute steps, record per-step latency)
- Extend the reporter to show per-step results
- Extend `bench list` to show steps

### Phase 3: Add `runBenchWorker` to the SDK

- Implement `runBenchWorker()` in `@computesdk/bench`
- Translates `bench()` entries to single-step tasks
- Passes `defineTask()` entries through with full step graph
- Uses existing `mapPool` for concurrency, existing heartbeat/flush infrastructure

### Phase 4: Add `--platform` mode to the CLI

- CLI ships files to platform (new `POST /runs/:id/build` endpoint)
- Platform builds on a VM, spawns worker VMs from build output
- Worker VMs call `runBenchWorker()` with the loaded entries
- CLI polls progress, prints TUI
- Add `--image` flag for pre-built Docker image path

### Phase 5: Migrate scale tests

- Replace `benchmarks/src/scale/sdk-coordinator.ts` with a `scale.bench.ts` file using `defineTask`/`defineStep`
- Replace `start.ts` with `bench --platform --image`
- The scale coordinator's step graph (worker.ready -> create -> exec.initial -> sandbox.live -> exec.final -> destroy) maps directly to `defineStep` calls

## Open Questions

1. **Platform build endpoint.** Does the platform API already have a way to upload and build source files on a VM, or does `POST /runs/:id/build` need to be added? The existing `createWorkerArtifact` / `uploadWorkerArtifact` endpoints upload artifacts, but there is no "build from source" endpoint.

2. **Worker VM base image.** When the platform builds bench files and spawns worker VMs, what base image do the workers use? A Node.js image with the bench CLI pre-installed? Or does the build step produce a self-contained bundle?

3. **Secrets management.** Scale tests need provider API keys (E2B, Modal, etc.) inside the worker VM. How do secrets flow from the user's environment to the platform to the worker VM? The existing flow uses env vars set in the Docker image or VM startup script. The ship-files path needs a `--env` or `--secret` flag.

4. **Multiple files in `--platform` mode.** Local mode can run multiple files. Should `--platform` mode also support multiple files (ship a zip, build all, run all), or should it be limited to one file per run for simplicity?

5. **Step readiness barriers.** The scale coordinator uses `waitForStepReady` to coordinate across workers (e.g., "all workers reach create phase before any starts exec"). Should the CLI expose this as a `defineStep` option, or should it be implicit? The current SDK already supports `readiness: 'poll'` on `DefineStepOptions`.
