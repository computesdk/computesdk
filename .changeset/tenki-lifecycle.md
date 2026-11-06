---
"@computesdk/tenki": patch
---

Sandboxes can now be paused and resumed with `sandbox.pause()` / `sandbox.resume()` (memory and running processes survive), and the provider declares what its snapshots keep: memory snapshots of the root filesystem except `/tmp`, which Tenki empties on the source while capturing; the source keeps running.
