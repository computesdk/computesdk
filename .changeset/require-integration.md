---
"@computesdk/test-utils": patch
---

Add `COMPUTESDK_REQUIRE_INTEGRATION=1`: provider, browser and storage suites fail instead of silently skipping their live tests when credentials are missing.
