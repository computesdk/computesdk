---
"@computesdk/tensorlake": patch
---

`getUrl` exposes the port via the SDK's additive `SandboxClient.exposePorts` instead of a read-modify-write `update()`, so concurrent calls can't clobber each other's ports and a failed `info()` read can no longer unexpose existing ports.
