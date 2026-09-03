---
'@computesdk/givemeanode': patch
---

Surface the API's error message instead of `[object Object]`.

The door answers a refusal with `{"error": {"code", "message"}}`, but the
client ran `String()` over that object, so every non-2xx response arrived
with its explanation discarded. Since the check sits in the shared request
path, this affected every operation: create, exec, fork, snapshot and
prepare-image.
