---
'@computesdk/cli': minor
---

Sandbox spend, rates and routing on the CLI:

- New `compute instances costs [--customer-only]` shows the org's sandbox spend (running, settled, total and per provider) from `GET /api/v1/sandboxes/costs`.
- New `compute instances rates` lists each provider's rate with its source (`organization`, `platform` or `builtin`) and fallback. `compute instances rates set <provider> <usd>/<unit>` (or `--usd` / `--per`) sets the org's override, and `compute instances rates rm <provider>` removes it; `rm` asks for confirmation on a terminal and needs `-y` elsewhere (it exits 1 without it).
- `compute instances settings set` takes `--resources <provider>=<preset|none>` and `--warm-pool <provider[:region]>=<0..16>` (both repeatable), and `compute instances settings` prints the resources and warm-pool rows (a provider's size shows only the fields it sets, e.g. `blaxel  2048 MB`).
