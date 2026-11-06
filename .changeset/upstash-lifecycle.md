---
'@computesdk/upstash': patch
---

Expose native pause/resume as `instance.pause()`/`resume()` and declare pause and snapshot capabilities: the root filesystem survives except tmpfs mounts (`/var/tmp`, `/var/cache`, `/var/log`, `/root`, `/run`, `/dev/shm`); running processes do not.
