---
'@computesdk/bench-cli': minor
---

Add `@computesdk/bench-cli`: a vitest-style runner for `*.bench.ts` files. Introduces the new `benchmarks/` folder convention as a sibling to `tests/` and `examples/`.

Use `bench` to auto-discover files under `./benchmarks/`, or `bench run <file>` for a single benchmark. The CLI installs a `bench` binary and re-exports the `@computesdk/bench` DSL helpers (`defineBench`, `defineTask`, `defineStep`, `defineWorker`) so power users can opt into platform-orchestrated benchmarks from the same import path.
