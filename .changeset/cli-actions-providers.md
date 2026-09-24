---
"@computesdk/cli": patch
---

feat(cli): `compute actions providers` lists the org's registered providers

Reads `GET /api/v1/actions/providers` and prints each registered ComputeSDK
provider with its credential state, act capability, selectable regions, and
position in the org's provider order — so CI tooling can enumerate provider
ids instead of hardcoding them. `--json` prints the raw response.
