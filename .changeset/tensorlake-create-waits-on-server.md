---
'@computesdk/tensorlake': patch
---

Require `tensorlake` `^0.5.158`. From 0.5.136 to 0.5.157 the SDK's default `Sandbox.create()` sent the create with `wait: false` and then polled every 2 s, so a sandbox that was already running after a few hundred milliseconds still cost the caller the full poll interval. 0.5.158 waits on the server's own state change instead and returns as soon as the sandbox is running.

The adapter's create options are now typed as the SDK's `CreateAndConnectOptions`, which keeps the SDK's conditional return type resolved to a connected `Sandbox`. No runtime behavior in the adapter changes.
