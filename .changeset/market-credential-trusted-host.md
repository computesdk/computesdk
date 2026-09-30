---
"@computesdk/cli": patch
---

cli(market): refuse `market credential connect` to untrusted hosts — the credential field metadata a host returns selects which local env vars get read and posted back, so `--allow-untrusted-host` no longer extends to it (same guard as vault values)
