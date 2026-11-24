---
'@computesdk/blaxel': patch
---

Add `pause` and `resume` for Blaxel sandboxes. A sandbox in standby keeps its memory, processes and files. `pause` asks for a standby through the sandbox's `POST /standby`, then waits up to 60 s for the control plane to record a standby newer than the sandbox's last activity (the call answers before the standby happens, and the platform can ignore it, for example right after start, in which case the sandbox goes to standby by itself once idle). `resume` wakes it with one request.
