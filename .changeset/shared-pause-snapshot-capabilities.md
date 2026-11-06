---
"computesdk": patch
"@computesdk/provider": patch
"@computesdk/test-utils": patch
---

Add optional `instance.pause()`/`resume()` (providers implement `pause`/`resume` and declare `pauseCapabilities`, surfaced as `provider.sandbox.pause`) and `snapshot.capabilities` describing what a snapshot keeps (`scope`, `path`, `memory`, `destroysSource`, `createOptions`). The conformance suite gains opt-in `supportsPauseResume` and `supportsSnapshots` tests.
