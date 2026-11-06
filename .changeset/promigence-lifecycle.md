---
'@computesdk/promigence': patch
---

Native `instance.pause()` / `instance.resume()` (files, memory and running processes kept), declared as `provider.sandbox.pause = { memory: true }`; `provider.snapshot.capabilities` declares whole-sandbox snapshots with memory that leave the source running.
