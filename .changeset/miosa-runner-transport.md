---
"@computesdk/miosa": minor
---

Route create/exec/destroy through `@miosa/sdk`'s SOMA one-hop runner transport (`run-<region>.miosa.ai`) instead of the control plane, for callers that opt in explicitly via `runnerMode`/`MIOSA_RUNNER_MODE` (no API key carries a region yet, so there is no key-based eligibility). Every other operation - list, getById, getInfo, getUrl/expose, filesystem, snapshots - keeps using the existing control-plane transport unchanged. Not released until `@miosa/sdk` publishes a version containing `RunnerClient`.
