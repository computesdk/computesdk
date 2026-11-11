---
'@computesdk/cli': minor
---

`compute instances list` takes the dashboard's filters and sort: `--customer-only` (leave out idle platform sandboxes), `--search <text>` (label, id, provider, provider sandbox id or product), `--sort created|name|cost|runtime` and `--direction asc|desc`. `--status` help now names `active` (every status but destroyed), which the API already accepted.
