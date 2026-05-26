---
"@computesdk/modal": patch
---

Build the cached `Image` once per provider instance instead of deferring to each `sandbox.create()` call. Concurrent `sandbox.create()` callers now share a single `ImageGetOrCreate` RPC for the default image (or a given template/snapshot id), instead of each call independently triggering one.
