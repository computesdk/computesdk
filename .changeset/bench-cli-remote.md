---
'@computesdk/bench-cli': minor
---

Add `--remote` mode to the `bench` CLI, which plans a benchmark run + workers on the ComputeSDK platform via `@computesdk/bench`, forks one or more local `bench-worker` processes, and reports aggregated progress back through a vitest-style TUI. Supports `--slug`, `--total`, `--workers`, `--concurrency`, `--participant`, `--api-key`, `--base-url`, `--poll-interval`, and `--timeout`.

This is a preview shape; v2 will generalize the worker story to remote hosts (SSH/Docker/Kubernetes).
