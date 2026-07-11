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
- Remote execution that actually runs remotely: the CLI orchestrates via ComputeSDK providers (multi-provider from day one). No local Docker required for the default path.
- The platform is always-on for storage/ingestion — even local runs push results. The platform handles zero execution.
- The scale coordinator pattern in `computesdk/benchmarks/src/scale/sdk-coordinator.ts` is the reference implementation for what `--platform` should look like.

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
bench --platform --image ghcr.io/computesdk/scale-coordinator:latest
bench --platform --image my-image --total 500 --workers 4 --concurrency 10
```

Renamed from `--remote` to `--platform` to accurately describe what it does: run benchmarks on remote compute via ComputeSDK providers.

The CLI uses ComputeSDK providers directly for execution. The platform handles zero execution — it is always-on for storage/ingestion only.

1. CLI discovers and loads bench files (same as local) — or uses a pre-built `--image`.
2. CLI builds image via `compute.template.create({ dockerfile, baseImage })` (if files provided, not `--image`). This uses the unified template primitive from PR #639 — multi-provider from day one.
3. CLI divides tasks among N workers (static range assignment).
4. CLI launches N worker sandboxes via `compute.sandbox.create({ template: templateId })`, each with env vars for its task range.
5. Each worker loads bench files, executes its task range through `runBenchWorker()` (real concurrency, step barriers), and streams results back to the CLI.
6. CLI collects results, aggregates, prints TUI/JSON.
7. CLI destroys sandboxes via `compute.sandbox.destroy()`.
8. CLI pushes results to the platform for storage/ingestion (always on, even for local runs).

### The platform: storage/ingestion only, always on

The platform (`platform.computesdk.com`) handles zero execution. It is the storage and ingestion layer, always on:

1. **ComputeSDK providers** (Namespace, E2B, Modal, etc.) — compute: build images via `template.create()`, launch worker sandboxes, stream logs, destroy. The CLI talks to providers directly through ComputeSDK's provider abstraction.

2. **ComputeSDK platform** (always on) — run storage, result ingestion, web UI, trend tracking, regression detection. The CLI always pushes results here after a run completes, whether local or remote.

This means:
- `bench run ./file.bench.ts` (local) — runs locally, pushes results to platform
- `bench --platform --provider namespace` (remote) — CLI orchestrates via provider, pushes results to platform
- The platform never touches execution — no building, no launching, no worker coordination
- The platform is NOT optional for storage — it is always on

### Architecture: CLI orchestrates, platform stores

The CLI is the execution orchestrator. The platform is the storage layer. Two separate concerns, cleanly separated.

```
CLI -----> ComputeSDK Providers (Namespace, E2B, Modal, ...)
  |         (execution)
  |
  |  compute.template.create({ dockerfile, baseImage })  -> build image
  |  compute.sandbox.create({ template, env })  x N     -> launch workers
  |
  |  workers execute, stream results back to CLI
  |  compute.sandbox.destroy()  x N                      -> clean up
  |
  |  CLI aggregates results, prints TUI/JSON
  |
  v
 ComputeSDK Platform (always on)
   -> POST /runs (create run record)
   -> POST /runs/:id/results (ingest results)
   -> web UI, trend tracking, regression detection
   -> ZERO execution logic
```

The CLI does everything `start.ts` does today, but as a CLI using ComputeSDK providers:
1. Load bench files, compute entry count and total tasks
2. Divide tasks among N workers (static assignment — each worker gets a range)
3. Build image via `compute.template.create({ dockerfile, baseImage })` (if files provided, not `--image`)
4. Launch N worker sandboxes via `compute.sandbox.create({ template, env })`, each with env vars for its task range
5. Workers execute their range, stream results back (stdout/IPC)
6. CLI collects, aggregates, prints
7. CLI destroys sandboxes via `compute.sandbox.destroy()`
8. CLI pushes results to the platform (always on)

The platform has zero execution logic. It receives results and stores them. That's it.

### Worker coordination (CLI-orchestrated, no platform claiming)

The CLI assigns task ranges directly — no platform claiming needed:

- CLI computes `totalTasks = entryCount * total`
- CLI divides `totalTasks` among N workers: worker 0 gets tasks 0..K-1, worker 1 gets K..2K-1, etc.
- Each worker receives its range via env vars (`BENCH_TASK_START`, `BENCH_TASK_COUNT`)
- Workers execute their range and stream results back to the CLI

This is simpler than dynamic claiming (no claim/release lifecycle, no platform round-trips). The tradeoff is no dynamic rebalancing — if one worker is slow, others can't steal its work. For benchmark workloads (uniform per-task cost), this is fine. For scale tests with variable per-task latency, dynamic claiming may still be valuable as a future enhancement.

Step readiness barriers (`waitForStepReady`) need rethinking without the platform as a coordinator. Options:
- CLI-orchestrated barriers: CLI waits for all workers to report step completion before signaling them to proceed
- Provider-level coordination: use provider networking (e.g., shared volumes, message queues) for barriers

This is an open question — see Open Questions below.

### Platform API shape (storage/ingestion, always on)

The platform needs endpoints for storage and ingestion only:

1. `POST /runs` — create a run record (CLI calls at start of run)
2. `POST /runs/:id/results` — ingest results (CLI pushes after completion)
3. `GET /runs` — list past runs
4. `GET /runs/:id/results` — fetch past results for comparison

The platform does NOT need endpoints for building, launching, or coordinating workers. Those happen in the CLI via ComputeSDK providers.

## Remote Execution: Ship Files vs Docker Image

### Two modes, both via ComputeSDK providers

**Mode 1: Pre-built image**

```
bench --platform --image my-registry/bench:latest --provider namespace
```

CLI launches worker sandboxes directly from the image via `compute.sandbox.create({ template: imageRef })`. Works with any provider. User (or CI) builds the image beforehand.

**Mode 2: Build from files (default)**

```
bench --platform --provider namespace
```

CLI calls `compute.template.create({ dockerfile, baseImage })` with a generated Dockerfile + bench files. Provider builds the image via the unified template primitive (PR #639). CLI gets `templateId` back. CLI launches workers from that template. No local Docker required — the provider builds on its infrastructure.

This uses `template.create()` from PR #639, which is already multi-provider. Any provider that implements `template.create()` with build-from-spec (E2B, Modal, Daytona, Runloop, Beam, etc.) works immediately. Providers that don't support it fall back to Mode 1 (`--image`).

### Execution flow (CLI orchestrates directly)

```
CLI                     ComputeSDK Provider (Namespace/E2B/Modal)
  |                              |
  |  template.create({dockerfile, baseImage})
  |  --------------------------->|
  |  <-- templateId -------------|  (skip if --image provided)
  |                              |
  |  sandbox.create({template, env: {TASK_START, TASK_COUNT, ...}}) x N
  |  --------------------------->|
  |  <-- sandboxes launched -----|
  |                              |
  |  (each worker:               |
  |    load bench files          |
  |    execute task range        |
  |    stream results to CLI)    |
  |                              |
  |  <-- results stream back ----|
  |                              |
  |  sandbox.destroy() x N       |
  |  --------------------------->|
  |                              |
  |  CLI aggregates, prints      |
  |                              |
  v
 ComputeSDK Platform (always on)
   POST /runs (create record)
   POST /runs/:id/results (ingest)
```

The CLI is the orchestrator. The provider handles all compute (build, launch, destroy). Workers stream results back to the CLI, which aggregates and prints. The CLI always pushes results to the platform for storage.

For `--image` mode, skip the `template.create()` step — the user provides the image reference directly.

### Template/image caching

If the provider supports `template.create()` with build-from-spec, the CLI can hash the Dockerfile + bench file contents and cache the built template. On subsequent runs with the same content, skip the build. This gives fast iteration without manual image management. The caching mechanism is provider-specific (Namespace uses blueprints, E2B uses template IDs, etc.).

### What about the existing scale coordinator?

The existing `computesdk/benchmarks/src/scale` flow (build Docker image, push, `start.ts` launches VMs) continues to work for scale testing. The CLI's `--platform --image` path is the integration point: the scale coordinator image is built in CI, and `bench --platform --image <scale-image>` launches it through the platform API instead of the custom `start.ts` script.

Over time, `start.ts` can be replaced by `bench --platform --image` + a `benchmarks/scale.bench.ts` file that uses `defineTask`/`defineStep`, unifying the scale test under the same CLI.

## CLI Surface

### Commands

```
bench [run] [files...]     Run benchmarks (default subcommand)
bench list [files...]      List discovered benchmarks without running
bench --platform [files..] Run on the benchmark runner platform
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
--platform               Run on the benchmark runner platform
--total <n>              Replications per benchmark function (default 100)
--workers <n>            Worker VMs to spawn (default 1)
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
- CLI pushes results to the platform for storage/ingestion (always on, even for local runs)
- This is a clean, shippable local benchmark runner with platform storage

### Phase 2: Add `defineTask`/`defineStep` + `runBenchWorker` to the SDK

- Re-export `defineTask`/`defineStep` from `@computesdk/bench` in the CLI
- Implement `runBenchWorker()` in `@computesdk/bench` (translates `bench()` entries to single-step tasks, passes `defineTask()` entries through with full step graph)
- Extend the local runner to handle `defineTask` entries (execute steps, record per-step latency)
- Extend the reporter to show per-step results
- Extend `bench list` to show steps

### Phase 3: Add `--platform` mode to the CLI (multi-provider execution)

- CLI accepts `--provider <name>`, `--image <ref>`, `--workers <n>`, `--total <n>`, `--concurrency <n>` flags
- `--image` mode: CLI launches N worker sandboxes via `compute.sandbox.create({ template: imageRef, env })`
- Build-from-files mode: CLI calls `compute.template.create({ dockerfile, baseImage })` (from PR #639's unified template primitive), then launches workers from the built template
- CLI divides tasks among N workers (static range assignment via env vars)
- Each worker executes its range via `runBenchWorker()`, streams results back to CLI
- CLI aggregates results, prints TUI, destroys sandboxes, pushes results to platform
- Multi-provider from day one — works with any ComputeSDK provider that implements `template.create()` (E2B, Modal, Daytona, Runloop, Beam, etc.)
- This replaces `start.ts` from `benchmarks/src/scale`

### Phase 4: Migrate scale tests to the CLI

- Replace `benchmarks/src/scale/sdk-coordinator.ts` with a `scale.bench.ts` file using `defineTask`/`defineStep`
- Replace `start.ts` with `bench --platform --provider namespace --image <scale-image>`
- The scale coordinator's step graph (worker.ready -> create -> exec.initial -> sandbox.live -> exec.final -> destroy) maps directly to `defineStep` calls
- Barrier coordination: CLI orchestrates barriers (wait for all workers to report step completion before signaling proceed)

## Open Questions

1. **Namespace `template.create()` implementation.** PR #639 adds the unified `template` primitive to the Provider interface, but Namespace is listed as Tier 3 ("not-implemented") in the feature matrix. Namespace needs a `template` block added that wraps `ImageService.CreateBlueprint` + `Build` for build-from-spec mode. This is the first provider implementation needed for `bench --platform --provider namespace` (build-from-files mode).

2. **Provider capability detection.** Not all providers support `template.create()` with build-from-spec. Should the CLI detect this at runtime and fall back to `--image` mode? Or should the API advertise capabilities per provider?

3. **Secrets management.** Scale tests need provider API keys (E2B, Modal, etc.) inside the worker sandbox. How do secrets flow from the user's environment to the worker sandbox? Secrets should not be baked into the image — they should be injected at sandbox launch time via env vars. The CLI needs a `--env` or `--secret` flag.

4. **Step readiness barriers without the platform.** The scale coordinator uses `waitForStepReady` to coordinate across workers (e.g., "all workers reach create phase before any starts exec"). Without the platform as a coordination point, how do workers coordinate barriers? Options: CLI-orchestrated barriers (CLI waits for all workers to report, then signals proceed), or provider-level networking (shared volumes, message queues).

5. **Multiple files in `--platform` mode.** Local mode can run multiple files. Should `--platform` mode also support multiple files (build all into one image, run all), or should it be limited to one file per run for simplicity?

6. **Template lifecycle.** Should the CLI cache built templates across runs (content-addressed by file hash)? What is the retention/cleanup policy? This applies to all providers' template build output.

7. **CLI crash recovery.** If the CLI crashes mid-run, worker sandboxes may be orphaned. Should the CLI register cleanup handlers (SIGTERM/SIGINT) to destroy sandboxes? Should sandboxes have a TTL so they self-destruct?
