---
"@computesdk/provider": patch
"@computesdk/daytona": patch
---

Export `errorText` from `@computesdk/provider` and use it in daytona's `resolveDaytonaVolume` — object-shaped errors like `{status: 404}` now match the not-found check instead of rethrowing, so id lookups still fall back to the list scan.
