---
"@computesdk/modal": patch
"@computesdk/sprites": patch
---

Propagate sandbox lookup and deletion failures instead of reporting absence or
success. Modal now queries its public sandbox handle before returning it and
does not guess absence from raw RPC errors. Sprites accepts only documented HTTP
404 as absence and validates the returned organization-scoped sprite name.
