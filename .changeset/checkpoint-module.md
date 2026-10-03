---
"daemond": patch
---

Add a daemon module op family (`module.install` / `module.exec` / `module.list` over the seed socket, protocol v5) and ship the first module: `checkpoint`, a pure-stdlib in-box capture/restore engine — sha256 content-addressed blob store, hand-written streaming zip writer, ranged central-directory restore, manifest diffing, and pluggable object-store drivers (plain HTTP, S3 SigV4, presigned POST/PUT).
