---
"@computesdk/cli": patch
---

feat(cli): `compute actions inspect <run-id>` — run introspection

Reads `GET /api/v1/actions/runs/{runId}/state` and prints the context that
decided how the run behaved: each job's declared vs resolved `runs-on`
labels and the runner image actually used, `container:` pins, cache keys
saved/restored in the run window, the names (never values) of secrets
bound, concurrency groups, timeout/fetch-depth overrides, and placement
attempts with the winning provider:region. `--json` prints the raw
inspection document.
