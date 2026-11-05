---
"@computesdk/createos-sandbox": patch
---

`snapshot.create` now returns a paused fork of the sandbox (its own id) and resumes the source, so snapshots survive the source being destroyed and can be restored many times.
