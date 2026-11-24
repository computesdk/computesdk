---
"computesdk": patch
"@computesdk/blaxel": patch
---

Fail fast when a Blaxel create mounts a volume that a running sandbox holds: the adapter marks that error `volumeHeld: true` and `withVolumeSettle` rethrows such errors at once instead of retrying for the 180 s settle window. A holder that is being deleted is still waited for.
