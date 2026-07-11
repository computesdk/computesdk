# @computesdk/bench-cli

Run TypeScript benchmark files locally with a vitest-style DSL, on top of the
`@computesdk/bench` SDK. Drop `*.bench.ts` files into a `benchmarks/` folder and
execute them with `bench`.

This package introduces the **benchmarks** folder convention: a sibling to the
familiar `tests/` and `examples/` folders, but tuned for performance work. The
shape is intentionally familiar to anyone who has used vitest.

```
benchmarks/
  strings.bench.ts
  arrays.bench.ts
  sorting.bench.ts
```

## Install

```bash
pnpm add -D @computesdk/bench-cli
```

The package registers two binaries: `bench` (production) and `bench-ts`
(development, runs through `tsx`).

## Usage

Run every benchmark in `./benchmarks/`:

```bash
bench
```

Run specific files:

```bash
bench run benchmarks/strings.bench.ts benchmarks/sorting.bench.ts
```

List the discovered benchmarks without executing them:

```bash
bench list
```

Tune iterations and warmup:

```bash
bench --iterations 500 --warmup 25
```

Emit machine-readable JSON instead of the default TUI:

```bash
bench --reporter json
```

## Authoring a benchmark file

```ts
// benchmarks/strings.bench.ts
import { bench, describe } from '@computesdk/bench-cli';

describe('string operations', () => {
  bench('concatenation', () => {
    'a' + 'b' + 'c' + 'd';
  });

  bench('template literal', () => {
    `${'a'}${'b'}${'c'}${'d'}`;
  });
});
```

The CLI measures wall-clock time per run, reports throughput in ops/sec, and
groups results by `describe` calls.

## Using `@computesdk/bench` from the same file

For platform-orchestrated benchmarks (the `@computesdk/bench` SDK claims work
from the ComputeSDK platform and reports results back), import the same helpers
you already use there:

```ts
import { defineBench, defineStep, defineTask } from '@computesdk/bench-cli';

export const lifecycle = defineTask('sandbox.lifecycle', [
  defineStep('create', async ({ state }) => {
    state.handles += 1;
  }),
  defineStep('destroy', async () => {}),
]);
```

## File discovery

The CLI looks for files matching `**/*.{bench.ts,bench.mts,bench.cts,bench.js,bench.mjs}`.
When no explicit file or directory is supplied, it scans `./benchmarks/` at the
current working directory.

## Commands

- `bench run [files...]` (default) — run benchmarks. Accepts file paths,
  directory paths, or glob patterns.
- `bench list [files...]` — list discovered files and the benchmarks inside.

## Programmatic API

```ts
import { runCommand, listCommand, loadBenchFile, runBenchmarks } from '@computesdk/bench-cli';

const { summaries } = await runCommand([], { iterations: 100 });
```

## Why a new folder?

`tests/` answers "does it work" and `examples/` shows "how a human uses it".
`benchmarks/` answers "how fast does it go" — third leg of the chair for any
project that cares about regressions in latency. Following the precedent set by
vitest, the convention is to put a single file per concern so diffs stay
isolated and CI can target a single benchmark with `bench run benchmarks/x.bench.ts`.

## Remote execution (preview)

Pass `--remote` to ship the benchmark to the ComputeSDK platform
orchestrator instead of running it on the local box. The CLI talks to the
existing `BenchmarkClient` + `BenchmarkReporter` API from `@computesdk/bench`,
plans a run + workers on the platform, and forks `--workers` local processes
that each claim work from the platform until the assigned task range is drained.

```bash
bench run benchmarks/strings.bench.ts --remote \
  --slug strings --total 500 --workers 4 --concurrency 10
```

Flag reference for `--remote`:

- `--slug <slug>` benchmark slug (default derived from filename)
- `--run-name <name>` display name for the run
- `--total <n>` replications per registered `bench()` function (default 100)
- `--workers <n>` local worker processes to fork (default 1)
- `--concurrency <n>` parallel task slots per worker (default 1)
- `--participant <slug>` participant identifier (default `bench-cli`)
- `--api-key <key>` / `--base-url <url>` overrides for the platform client
- `--poll-interval <ms>` parent status poll interval (default 1000)
- `--timeout <seconds>` parent wall-clock timeout (default 0 = unlimited)

Each forked worker is invoked as `bench-worker` and reads its configuration
from environment variables set by the parent, so the worker itself has no
configuration surface of its own. v1 assumes workers run on the same host;
turning them into remote workers (SSH/[Docker]/Kubernetes) is a follow-up.

The CLI ships a vitest-style progress TUI (`status=… workers=… tasks=…`) and
prints a final pass/fail summary when the run finishes.
