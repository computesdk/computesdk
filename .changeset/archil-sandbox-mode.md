---
"@computesdk/archil": patch
"computesdk": patch
---

Add `execution: "persistent"` mode to the Archil provider: `create` provisions a
persistent Archil sandbox VM (waited to `running`), `runCommand` uses the
sandbox's interactive process API over a short-lived WebSocket connection
(fresh connection URL per command), `getById` auto-resumes paused sandboxes,
`destroy` deletes the sandbox, and `getUrl` resolves published endpoints.
Default `execution: "exec"` behavior is unchanged.

Also adds `ephemeral?: boolean` to the shared `CreateSandboxOptions` as the
standard flag for providers with both ephemeral and persistent compute
surfaces (Upstash `EphemeralBox`/`Box`, Archil exec/sandbox, Cloud Run
ephemeral/stateful); Archil's `create` honors it as a per-sandbox override.
