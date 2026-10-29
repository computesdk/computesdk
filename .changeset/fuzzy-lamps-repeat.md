---
"@computesdk/test-utils": patch
"@computesdk/browserless": patch
---

Add `skipSessionReads` to `runBrowserProviderTestSuite` for providers whose sessions materialize on client connect (or lack a sessions API); use it in the browserless suite.
