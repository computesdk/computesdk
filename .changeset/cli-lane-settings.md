---
'@computesdk/cli': minor
---

Add `compute sandboxes settings` and `compute actions settings` (plus `settings set`) — read and update the org's per-lane routing policy over `GET/PATCH /api/v1/{lane}/settings`: provider `--order`, `--order-type` (sandbox lane supports `inherit`), whole-lane `--general-cap`, and per-size `--cap <size>=<usd>/<unit>` (or `=none` to clear). Prices require a unit, same as `--max-price`.
