---
"@computesdk/vercel": patch
"@computesdk/hopx": patch
---

Stop masking sandbox lookup and deletion failures. Validate native identities
and use conservative, documented native absence signals. Vercel destroy now
permanently deletes the sandbox rather than merely stopping its resumable
session; orphan snapshots and separately owned drives remain untouched.
HopX preserves its existing public connection effects and propagates ambiguous
native errors rather than guessing sandbox absence.
