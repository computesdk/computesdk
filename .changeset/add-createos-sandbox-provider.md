---
"@computesdk/createos-sandbox": patch
---

Add CreateOS provider — NodeOps Firecracker microVM sandboxes via `@nodeops-createos/sandbox`. Maps `create`/`runCommand`/filesystem/`getInfo` and pause-as-snapshot with `fork` onto the ComputeSDK provider contract, plus a native-handle escape hatch (`getInstance`) for pause/resume/disks/bandwidth. Template builds use the native client directly (ComputeSDK's `Provider` type can't carry the createos `dockerfile` option type-safely).
