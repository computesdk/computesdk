# @computesdk/microsandbox

## 0.1.17

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 0.1.16

### Patch Changes

- 4930f49: fix(volumes): soak-2 — settle-wrap attach + create-time mounts, daytona ready-wait, microsandbox named(), miosa computer-only error

  - factory: `attachVolume` and `create({volumes})` run inside `withVolumeSettle` — re-attaching a volume right after `destroy()` raced the provider's async unmount (blaxel "already attached", tenki `SYNC_PENDING`); the settle window absorbs it for every provider at once.
  - daytona: `volume.create` returns a ready handle and `volume.delete` waits out `pending_create` — both operations reject the transitional state.
  - microsandbox: mount via `named()` — the backend rejects the `ensure-exists` inline-create option on sandbox create.
  - miosa: `attachVolume`/`detachVolume` throw a clear "volumes attach to computers, not sandboxes" error when the record carries no `computer_id`, instead of POSTing an id that always 404s.

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 0.1.15

### Patch Changes

- a3de4ae: Volume soak fixes: `withVolumeSettle` retries volume delete while the provider reports it still attached (sandbox.destroy() returns before the control plane unmounts); daytona volume get/delete resolve by id or name (`volume.get` is name-keyed); miosa create defaults size_bytes to 1 GiB (missing field 422s); sandbox0 create sends the explicit s0fs/RWO request.
- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 0.1.14

### Patch Changes

- 9ea2fa0: Use `namedWith(name, "ensure-exists")` for unified volume mounts — a mount issued right after `Volume.create` raced the volume landing and crashed sandbox boot (verify-run SIGABRT).
- 1b639da: Add a unified persistent-volume surface: `CreateInstanceOptions.volumes` (create-time mounts), `compute.volume.create/get/list/delete` with multi-provider routing, and `instance.attachVolume`/`detachVolume` where the provider exposes runtime attach. Provider plumbing maps the unified `VolumeMount[]` onto each native wire shape (daytona `volumes[]`, e2b `volumeMounts`, modal `volumes` map, vercel `mounts`, namespace `volumes[]` with `persistency_kind`, northflank `volumesToAttach`, sandbox0 claim `mounts`, tenki `CreateOptions.volumes`, novita `volumeMounts`, createos `disks` attachments, plus volume managers for blaxel, declaw, beam, microsandbox, miosa).
- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 0.1.13

### Patch Changes

- 41cea92: Remove the named sandbox when `create` fails after the sandbox already exists
  (for example, a cloud sandbox that does not reach `running` before the SDK's
  readiness wait expires). These sandboxes were previously left behind because
  the caller never received an id to destroy. `destroy` now also stops sandboxes
  in any non-terminal state (`created`, `starting`, `paused`) before removing them.

## 0.1.12

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 0.1.11

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 0.1.10

### Patch Changes

- 16074f4: Serialize process-global provider credentials with a shared config gate

  Adds `createConfigGate` / `createConfigStamp` to `@computesdk/provider` and applies them to the adapters whose vendor SDKs hold credentials in module-global state: beam (`beamOpts` + singleton client), blaxel (`initialize()` mutates global settings), microsandbox (`setDefaultBackend`), and lightning (refactored from its local gate onto the shared one).

  Same-config operations still run concurrently. A different config waits for the active operations to drain, then installs itself once — so two API keys on one process can no longer clobber each other mid-request. Created and connected sandboxes are stamped with their config so instance operations (runCommand, filesystem, getUrl) re-enter the gate under their originating credentials.

  For `@computesdk/microsandbox` this replaces the one-backend-per-process pin that threw "Microsandbox supports one backend configuration per process": distinct explicit selections now serialize instead of failing.

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 0.1.9

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 0.1.8

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 0.1.7

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.1.6

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.1.5

### Patch Changes

- 4f2394e: Remove backend serialization for concurrent operations using one backend configuration per process, rejecting conflicting configurations before changing the SDK backend. Accept memoryMib and rootDiskMib in sandbox create options so requested resources are not silently replaced by defaults. Retry sandbox shutdown and deletion, and report failed cleanup of cancelled sandbox creation. Require Microsandbox SDK 0.6.18 or newer within the 0.6 release line. Default to ephemeral sandboxes with a 15-minute idle timeout; support explicit persistent and idle timeout overrides.

## 0.1.4

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.1.3

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.1.2

### Patch Changes

- 42a5158: Update microsandbox to 0.6.12 so the provider works on Linux systems with glibc 2.28 and newer.

## 0.1.1

### Patch Changes

- 183f0f1: Add a microsandbox provider with local and cloud backends, native command streaming, filesystem access, and local port and snapshot support.
