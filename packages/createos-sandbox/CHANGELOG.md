# @computesdk/createos-sandbox

## 0.1.1

### Patch Changes

- bdf7c2b: Add CreateOS provider — VM sandboxes via `@nodeops-createos/sandbox`. Maps `create`/`runCommand`/filesystem/`getInfo` and pause-as-snapshot with `fork` onto the ComputeSDK provider contract, plus a native-handle escape hatch (`getInstance`) for pause/resume/disks/bandwidth. Template builds use the native client directly (ComputeSDK's `Provider` type can't carry the createos `dockerfile` option type-safely).
