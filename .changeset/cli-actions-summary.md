---
"@computesdk/cli": patch
---

feat(cli): `compute actions summary` + inline failure digest in `compute actions run`

Reads `GET /api/v1/actions/runs/{runId}/summary` and prints each failed job
with its failed steps and a bounded, secret-redacted tail of the failing
output — so debugging a red run does not mean paging the full log. `compute
actions run <id>` prints the same digest inline for failed runs when the
deployment serves the summary route; `--json` carries it as `summary`.
