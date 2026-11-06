---
"@computesdk/arker": patch
---

Add native `pause()`/`resume()` (a schedule `suspend` rule; the next run resumes the VM with its memory, processes and in-flight runs), and declare `snapshot.capabilities` (warm fork of the whole rootfs with running processes; the source keeps running). The pause/resume and snapshot conformance tests now run live.
