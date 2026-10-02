---
"@computesdk/miosa": minor
---

Route create/exec/destroy through `@miosa/sdk`'s SOMA one-hop runner transport (`run-<region>.miosa.ai`) instead of the control plane, for API keys that carry a region segment (`msk_<region>_...`) or that opt in explicitly via `runnerMode`/`MIOSA_RUNNER_MODE`. Every other operation - list, getById, getInfo, getUrl/expose, filesystem, snapshots - keeps using the existing control-plane transport unchanged. Not released until `@miosa/sdk` publishes a version containing `RunnerClient`.
