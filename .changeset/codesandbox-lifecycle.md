---
'@computesdk/codesandbox': patch
---

Expose hibernate/resume as `instance.pause()`/`resume()` and declare pause and snapshot capabilities: hibernation and fork snapshots keep the whole VM, memory and running processes included, snapshotting leaves the source running (its session is reopened after the fork), and each restore is an independent fork.
