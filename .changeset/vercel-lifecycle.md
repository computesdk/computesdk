---
'@computesdk/vercel': patch
---

Native pause/resume for persistent sandboxes (`instance.pause()` stops, `instance.resume()` starts a fresh session with the filesystem restored), declared pause and snapshot capabilities (whole-rootfs snapshots, no memory; snapshotting stops the source), and `destroy` now deletes the sandbox and its automatic snapshots instead of only stopping it.

Snapshot capabilities declare `source: 'stopped'`, since the stopped source still exists and needs destroying, and `list()` keeps stopped persistent (paused) sandboxes so they can be found and resumed.
