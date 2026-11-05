---
"@computesdk/run-cloud": patch
---

Stream `runCommand` output live: `onStdout`/`onStderr` now fire as the Run Cloud exec stream delivers bytes (served as native `streamCommand`) instead of once after the command exits.
