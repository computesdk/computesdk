---
'@computesdk/cli': patch
---

Sandbox spend and routing on the CLI:

- New `compute instances costs [--customer-only]` shows the org's sandbox spend (running, settled, total and per provider) from `GET /api/v1/sandboxes/costs`.
- `compute instances settings set` takes `--resources <provider>=<preset|none>` and `--warm-pool <provider[:region]>=<0..16>` (both repeatable), and `compute instances settings` prints the resources and warm-pool rows (a provider's size shows only the fields it sets, e.g. `blaxel  2048 MB`).
