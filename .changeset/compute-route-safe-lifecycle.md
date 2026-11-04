---
"@computesdk/leap0": patch
"@computesdk/lelantos": patch
"@computesdk/upstash": patch
---

Propagate non-missing lookup and deletion errors, validate route-safe resource
references and canonical identities, and honor native deletion acknowledgement
contracts. Leap0 retains its canonical client mapping after failed deletion.
Lelantos uses a metadata precheck and direct native kill rather than reconnecting
to destroy. Native terminal records remain visible.
