---
"@computesdk/vercel": patch
"@computesdk/hopx": patch
"@computesdk/beam": patch
"@computesdk/blaxel": patch
---

Validate native command completion rather than substituting successful exit status for missing or malformed completion metadata.

Vercel preserves explicit detached launch acknowledgements while validating foreground completion. HopX validates output and status, preserving complete nonzero compatibility results without treating a caught exception as successful execution. Beam uses authoritative completion information rather than a stale handle status. Blaxel rejects nonterminal or inconsistent final records instead of inheriting startup status or guessing success from a terminal label.

Malformed completion now raises safe protocol errors. Valid native exit statuses are not restricted to an unsigned byte. Existing ordinary native-error behavior remains unchanged; these checks do not establish raw-wire integrity, remote cancellation, or live-provider compatibility.
