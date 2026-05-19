---
"computesdk": minor
"@computesdk/provider": minor
---

Remove `RunCommandOptions.daemon` from the public API and make command streaming callback-driven.

`sandbox.runCommand(...)` now automatically uses daemon-backed streaming internally when `onStdout` and/or `onStderr` callbacks are provided.

This also removes the need for daemon prewarming in callers and updates provider behavior/tests to treat streaming as an internal transport detail.
