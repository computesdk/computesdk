---
"@computesdk/microsandbox": patch
---

Use `namedWith(name, "ensure-exists")` for unified volume mounts — a mount issued right after `Volume.create` raced the volume landing and crashed sandbox boot (verify-run SIGABRT).
