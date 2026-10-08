---
"@computesdk/buddy": patch
---

Run foreground `runCommand` calls through Buddy's synchronous `exec` endpoint: one request returns stdout, stderr and the exit code, instead of submit + log stream + status poll. Calls with `onStdout`/`onStderr`, `background: true` or a `timeout` keep using the `commands` resource and its log stream. Sandboxes still booting answer `exec` with 400 "Sandbox must be running"; the provider retries that like the other boot races.
