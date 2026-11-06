---
'@computesdk/mosaic': patch
---

Mosaic instances expose native `pause()`/`resume()` (memory and processes survive), and snapshots declare their capabilities: whole rootfs plus memory, source keeps running. The shared conformance suite now runs live against Mosaic.
