---
"@computesdk/archil": minor
---

Add `@computesdk/archil` provider, which executes commands against an Archil
disk via Archil's control-plane HTTP API.

The provider maps ComputeSDK sandbox lifecycle to Archil disks:
- `create()` provisions a new disk
- `getById()` resolves by disk id (with name fallback)
- `destroy()` deletes the disk

Command execution (`runCommand`/`runCode`) and filesystem helpers are executed
through Archil's disk `exec` endpoint.
