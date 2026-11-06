---
'@computesdk/vercel': patch
---

Native pause/resume for persistent sandboxes (`instance.pause()` stops, `instance.resume()` starts a fresh session with the filesystem restored), declared pause and snapshot capabilities (whole-rootfs snapshots, no memory; snapshotting stops the source), and `destroy` now deletes the sandbox and its automatic snapshots instead of only stopping it.
