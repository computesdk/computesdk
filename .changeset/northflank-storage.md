---
'@computesdk/northflank': minor
---

Add `ephemeralStorageSize` option to configure ephemeral storage per container (in MB). Passes through to `deployment.storage.ephemeralStorage.storageSize` in the Northflank API. Works at both the provider config level and per-sandbox via `create()`.
