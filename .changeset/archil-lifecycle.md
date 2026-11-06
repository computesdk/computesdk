---
'@computesdk/archil': patch
---

Native pause/resume as `instance.pause()`/`resume()` (memory and processes survive), with declared `pauseCapabilities` and `snapshot.capabilities` (rootfs forks that keep memory; the source keeps running).
