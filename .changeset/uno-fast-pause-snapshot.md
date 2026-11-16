---
"@computesdk/uno": patch
---

Faster pause, snapshots and restores. `instance.pause()` now pauses the machine in memory, so `resume()` takes milliseconds instead of a wake from disk; after `pauseInMemoryS` seconds (default 300, `0` to sleep on disk at once) the machine goes to sleep on disk on its own. `snapshot.create` copies the disk without booting the copy where the Uno API offers it, so a snapshot costs a flush and a copy-on-write copy. Waiting for a new instance asks the API to answer as soon as the machine is ready instead of polling. Older Uno APIs keep the previous behaviour.
