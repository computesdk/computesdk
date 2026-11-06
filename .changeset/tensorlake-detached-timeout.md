---
"@computesdk/tensorlake": patch
---

Run timed foreground commands through the process API with a client-side deadline, so `nohup … &` launchers no longer have their detached children killed when the command's timeout expires.
