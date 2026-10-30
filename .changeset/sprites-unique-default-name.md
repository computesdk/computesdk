---
"@computesdk/sprites": patch
---

fix(sprites): suffix the default sandbox name with a uuid so concurrent `sandbox.create()` calls no longer collide — `sprite-${Date.now()}` produced identical names within the same millisecond and the API returned 409 "already exists"
