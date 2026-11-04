---
"@computesdk/sprites": patch
"@computesdk/daytona": patch
---

Preserve raw shell command semantics when capturing exit status and stderr.

Background lists, trailing comments and heredocs, and top-level exit commands no longer collide with appended wrapper syntax. Sprites no longer reports successful command completion when its completion status is missing or malformed.

This does not add remote timeout or process-cancellation support.
