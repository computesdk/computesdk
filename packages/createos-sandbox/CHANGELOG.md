# @computesdk/createos-sandbox

## 0.1.21

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 0.1.20

### Patch Changes

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 0.1.19

### Patch Changes

- a3de4ae: Volume soak fixes: `withVolumeSettle` retries volume delete while the provider reports it still attached (sandbox.destroy() returns before the control plane unmounts); daytona volume get/delete resolve by id or name (`volume.get` is name-keyed); miosa create defaults size_bytes to 1 GiB (missing field 422s); sandbox0 create sends the explicit s0fs/RWO request.
- 3d44808: Volume fixes round 3: namespace delete paginates the id→tag lookup and tolerates list outages (falls back to the given tag); createos forks destroy themselves when a post-fork volume attach fails instead of leaking a running sandbox.
- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 0.1.18

### Patch Changes

- d7d8efc: Volume surface review fixes: list() no longer swallows real provider failures (only the not-supported stub), delete() only targets the known owning provider, novita create-mounts resolve the volume name (not the native object), namespace delete resolves id→tag, and createos snapshot forks attach requested volumes post-fork.
- 1b639da: Add a unified persistent-volume surface: `CreateInstanceOptions.volumes` (create-time mounts), `compute.volume.create/get/list/delete` with multi-provider routing, and `instance.attachVolume`/`detachVolume` where the provider exposes runtime attach. Provider plumbing maps the unified `VolumeMount[]` onto each native wire shape (daytona `volumes[]`, e2b `volumeMounts`, modal `volumes` map, vercel `mounts`, namespace `volumes[]` with `persistency_kind`, northflank `volumesToAttach`, sandbox0 claim `mounts`, tenki `CreateOptions.volumes`, novita `volumeMounts`, createos `disks` attachments, plus volume managers for blaxel, declaw, beam, microsandbox, miosa).
- Updated dependencies [1b639da]
  - @computesdk/provider@2.1.15

## 0.1.17

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14

## 0.1.16

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - @computesdk/provider@2.1.13

## 0.1.15

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 0.1.14

### Patch Changes

- Updated dependencies [7240d21]
  - @computesdk/provider@2.1.11

## 0.1.13

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10

## 0.1.12

### Patch Changes

- @computesdk/provider@2.1.9

## 0.1.11

### Patch Changes

- ea5be06: Harden the relative `filesystem.*` path resolution: `remove(''|'.'|'./')` no longer collapses to the sandbox workdir (it is rejected before resolution instead of recursively deleting it), and a failed `pwd` workdir probe is evicted instead of being cached as `/` forever — the next filesystem operation probes again.

## 0.1.10

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8

## 0.1.9

### Patch Changes

- a5b4353: Accept relative paths in `sandbox.filesystem` operations. Providers whose native file APIs require absolute paths (Modal `filesystem.*`, createos `files.*`, Sail `fs.*`) previously rejected or misrouted relative paths; they are now resolved against the sandbox's exec working directory — probed once via `pwd` and cached — so `filesystem.writeFile('a.txt', ...)` and `runCommand('cat a.txt')` address the same file. Absolute paths skip the probe entirely; `.` segments and duplicate slashes are normalized, while `..` segments are left for the sandbox filesystem to resolve physically.

## 0.1.8

### Patch Changes

- @computesdk/provider@2.1.7

## 0.1.7

### Patch Changes

- @computesdk/provider@2.1.6

## 0.1.6

### Patch Changes

- b832bc8: Bump `@nodeops-createos/sandbox` to `^0.8.1` and track `latest` for `@opencomputer/sdk`.

## 0.1.5

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.1.4

### Patch Changes

- 45e4f80: Forward timeout to createos-sandbox exec requests

  The `runCommand` method now passes `options.timeout` as `timeoutMs` to the underlying `@nodeops-createos/sandbox` exec call. Previously the timeout was ignored and the SDK used a hardcoded 60s default, causing long-running commands (e.g. dax benchmark) to time out.

## 0.1.3

### Patch Changes

- Updated dependencies [f3fe311]
  - @computesdk/provider@2.1.4

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
