---
"@computesdk/namespace": patch
"@computesdk/createos-sandbox": patch
---

namespace: send size_mb on runtime volume attaches — a fresh persistent volume with no size can't be provisioned and the instance is destroyed while waiting for readiness. createos: wait for mount_status=mounted after create/attachDisk (the in-VM agent mounts asynchronously); mount_error surfaces on failure.
