# @computesdk/bench-cli

## 0.1.0

Initial release.

- New `bench` CLI binary and a `bench-ts` development binary.
- `bench run [files...]` runs `*.bench.ts` files via `tsx`.
- `bench list` reports the discovered benchmark graph.
- Vitest-style DSL: `bench(name, fn)` and `describe(name, fn)`.
- Re-exports `@computesdk/bench` primitives for platform-orchestrated benchmarks.
- Default reporter prints ops/sec; `--reporter json` emits machine-readable output.
