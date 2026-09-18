---
"@computesdk/archil": patch
"@computesdk/cloud-run": patch
"@computesdk/freestyle": patch
"@computesdk/upstash": patch
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
surfaces, and wires it through every dual-mode provider:

- Archil: `ephemeral: true` -> exec-mode disk handle, `false` -> persistent VM.
- Upstash: `ephemeral` -> `EphemeralBox`/`Box` (unchanged semantics, now typed).
- Cloud Run: `ephemeral` overrides configured `executionMode` per sandbox
  (`true` -> `ephemeral`, `false` -> `stateful`).
- Freestyle: `ephemeral` overrides configured `persistent` per sandbox
  (`true` -> deleted on stop, `false` -> kept).
