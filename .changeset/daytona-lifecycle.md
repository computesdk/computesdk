---
'@computesdk/daytona': patch
---

Daytona instances expose `pause()`/`resume()` (stop/start: the rootfs survives, processes do not), and `snapshot.capabilities` declares rootfs filesystem snapshots that leave the source running. Snapshot creation waits up to 15 minutes.
