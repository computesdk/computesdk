---
"@computesdk/e2b": patch
---

Native `instance.pause()`/`resume()` (memory and processes survive) and declared `snapshot.capabilities` (`rootfs` scope with memory; the source keeps running). The conformance suite now exercises pause/resume and snapshot restore.
