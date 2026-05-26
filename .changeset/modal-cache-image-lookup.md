---
"@computesdk/modal": patch
---

Cache resolved `Image` per provider instance in `modal.sandbox.create`, sharing a single Modal API call across concurrent bursts of sandbox creations for the same template/snapshot id (or default image).
