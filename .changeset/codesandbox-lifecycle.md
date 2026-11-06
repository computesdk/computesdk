---
'@computesdk/codesandbox': patch
---

Expose hibernate/resume as `instance.pause()`/`resume()` and declare pause and snapshot capabilities: hibernation and fork snapshots keep the whole VM, memory and running processes included, and snapshotting leaves the source running.
