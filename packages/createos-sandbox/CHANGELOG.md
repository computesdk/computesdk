# @computesdk/createos-sandbox

## 0.1.2

### Patch Changes

- 6d47c0e: Fix and improve createos-sandbox provider (bump to @nodeops-createos/sandbox@0.7.1).

  - Performance improvement by reducing double calls.
  - Default `ingressEnabled` to `false` (was `true`) for both create and fork requests.
  - Default rootfs to `devbox:1` when no image/runtime/rootfs is specified.
  - Use direct HTTP DELETE for sandbox destroy instead of fetching the sandbox first.
  - Add new create options: `envs`, `name`.

## 0.1.1

### Patch Changes

- bdf7c2b: Add CreateOS provider — VM sandboxes via `@nodeops-createos/sandbox`. Maps `create`/`runCommand`/filesystem/`getInfo` and pause-as-snapshot with `fork` onto the ComputeSDK provider contract, plus a native-handle escape hatch (`getInstance`) for pause/resume/disks/bandwidth. Template builds use the native client directly (ComputeSDK's `Provider` type can't carry the createos `dockerfile` option type-safely).
