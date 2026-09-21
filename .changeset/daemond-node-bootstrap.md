---
"daemond": patch
"@computesdk/provider": patch
---

fix(daemond): bootstrap node into sandboxes that lack a JS runtime. `daemonSeedScriptCommand` now resolves node from PATH, a cached bootstrap under `~/.computesdk/daemond`, or a pinned static build fetched through whatever the image ships (curl, wget, busybox wget, python3), and exits 127 with a clear `daemond:` capability error when none of that works. `parseSeedInvocationOutput` and the factory's daemon path now include the raw output tail / stderr so failures are diagnosable from job logs.
