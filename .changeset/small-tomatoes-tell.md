---
"@computesdk/bench": patch
---

Refine bench step scheduling for concurrent lifecycle workloads.

- Make `bench.add(...)` chainable and add optional step controls:
  - `concurrency` to cap a specific step
  - `runOnFailed` to run cleanup/finalizer steps for failed iterations
- Use pipeline-style stage execution by default so steps run in declaration order across iterations.
- Keep same-stage execution resilient by continuing peer iterations when one iteration fails.
- Skip failed iterations in later steps unless `runOnFailed` is enabled for that step.
- Update bench README examples/docs to match the new step scheduling semantics.
