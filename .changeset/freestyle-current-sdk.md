---
"@computesdk/freestyle": minor
---

Rebuild the Freestyle provider on the current `freestyle` SDK (the `freestyle-sandboxes` package it used is no longer maintained). The first sandbox on an account bakes a Node + Python runtime snapshot once and caches it (override with `snapshotId` / `FREESTYLE_SNAPSHOT_ID`); every sandbox after boots in ~200–300 ms. Commands run as root, so `HOME`, `apt`, `npm`, and `pip` work. Adds `snapshotId`, `baseUrl`, `idleTimeoutSeconds`, `persistent`, and `firewall` config options. `getUrl` is unsupported — Freestyle exposes VMs through mapped domains, not a stock per-port URL.
