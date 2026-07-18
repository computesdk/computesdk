# @computesdk/bench-cli

## 0.2.0

- New `--remote` flag turns `bench run <file>` into a platform-orchestrated run via `@computesdk/bench`.
- Parent CLI plans the run + workers, forks local `bench-worker` processes, polls progress, and prints a summary.
- New `--slug`, `--total`, `--workers`, `--concurrency`, `--participant`, `--api-key`, `--base-url`, `--poll-interval`, `--timeout` flags.

## 0.1.0

Initial release.

- New `bench` CLI binary and a `bench-ts` development binary.
- `bench run [files...]` runs `*.bench.ts` files via `tsx`.
- `bench list` reports the discovered benchmark graph.
- Vitest-style DSL: `bench(name, fn)` and `describe(name, fn)`.
- Re-exports `@computesdk/bench` primitives for platform-orchestrated benchmarks.
- Default reporter prints ops/sec; `--reporter json` emits machine-readable output.
