---
"@computesdk/tenki": patch
---

tenki: add snapshot create/list/delete (restore via `create({ snapshotId })`), and serve filesystem calls outside the `/home/tenki` workdir through the shell instead of failing.
