---
"@computesdk/archil": patch
---

Add `execution: "sandbox"` mode to the Archil provider: `create` provisions a
persistent Archil sandbox VM (waited to `running`), `runCommand` uses the
sandbox's interactive process API over a short-lived WebSocket connection
(fresh connection URL per command), `getById` auto-resumes paused sandboxes,
`destroy` deletes the sandbox, and `getUrl` resolves published endpoints.
Default `execution: "exec"` behavior is unchanged.
