---
"@computesdk/cloudflare": patch
"@computesdk/namespace": patch
---

Add capture-from-sandbox template support. Cloudflare captures directory backups to R2 via the Sandbox SDK (`createBackup`/`restoreBackup`, direct mode). Namespace captures persistent volume snapshots via `SuspendInstance` plus the StorageService snapshot APIs, and surfaces them through `template.list`/`template.delete`.
