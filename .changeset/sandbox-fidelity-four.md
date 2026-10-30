---
"@computesdk/novita": patch
"@computesdk/miosa": patch
---

Fix two sandbox-fidelity failures: novita `snapshot.create` now accepts (and drops) `name`/`metadata` instead of throwing — the API takes no label, so callers that always name snapshots no longer fail. Miosa filesystem ops (`readFile`, `writeFile`, `mkdir`, `readdir`, `remove`) now route to the regional runner's own `filesystem.*` routes for regionally-created sandboxes — the account API does not own those ids and answered 404.
