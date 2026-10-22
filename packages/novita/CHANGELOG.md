# @computesdk/novita

## 0.0.10

### Patch Changes

- a3de4ae: Volume soak fixes: `withVolumeSettle` retries volume delete while the provider reports it still attached (sandbox.destroy() returns before the control plane unmounts); daytona volume get/delete resolve by id or name (`volume.get` is name-keyed); miosa create defaults size_bytes to 1 GiB (missing field 422s); sandbox0 create sends the explicit s0fs/RWO request.
- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 0.0.9

### Patch Changes

- d7d8efc: Volume surface review fixes: list() no longer swallows real provider failures (only the not-supported stub), delete() only targets the known owning provider, novita create-mounts resolve the volume name (not the native object), namespace delete resolves id→tag, and createos snapshot forks attach requested volumes post-fork.
- 1b639da: Add a unified persistent-volume surface: `CreateInstanceOptions.volumes` (create-time mounts), `compute.volume.create/get/list/delete` with multi-provider routing, and `instance.attachVolume`/`detachVolume` where the provider exposes runtime attach. Provider plumbing maps the unified `VolumeMount[]` onto each native wire shape (daytona `volumes[]`, e2b `volumeMounts`, modal `volumes` map, vercel `mounts`, namespace `volumes[]` with `persistency_kind`, northflank `volumesToAttach`, sandbox0 claim `mounts`, tenki `CreateOptions.volumes`, novita `volumeMounts`, createos `disks` attachments, plus volume managers for blaxel, declaw, beam, microsandbox, miosa).
- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 0.0.8

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 0.0.7

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 0.0.6

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 0.0.5

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 0.0.4

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 0.0.3

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.0.2

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.0.1

### Patch Changes

- 475cdc6: Add the Novita Sandbox provider with sandbox lifecycle, native command streaming,
  filesystem operations, snapshot and template management, and Workbench configuration support.
  Include E2B-equivalent shared provider contract tests and enable Novita's shared
  CRUD integration suite only when NOVITA_RUN_INTEGRATION=1 and NOVITA_API_KEY are configured.
