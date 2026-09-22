---
"@computesdk/cli": patch
---

feat(cli): `compute actions dispatch` accepts `--provider`/`--provider-region`

Passes the run's provider override through to the v1 dispatch API (`provider`,
`providerRegion`) so a manually dispatched run can be pinned to one provider
(and optionally one region) instead of following the org provider order.
`compute actions run` also prints `dispatched to: provider[:region]` when the
run carries an override.
