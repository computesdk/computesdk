# @computesdk/neevcloud

## 1.0.15

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 1.0.14

### Patch Changes

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 1.0.13

### Patch Changes

- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 1.0.12

### Patch Changes

- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 1.0.11

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 1.0.10

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 1.0.9

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 1.0.8

### Patch Changes

- 2c9a0b1: NeevCloud: move to `@neevcloud/sdk` 0.8 and cover more of the provider contract.

  - `create()` now honors `name`, `envs`, `cpu`, `memory`, `timeout` (sandbox lifetime), `snapshotId` and `signal`.
  - Snapshots: `snapshot.create` / `list` / `delete`, restored through `create({ snapshotId })`.
  - Templates: `template.list()` returns the sandbox template catalogue.
  - `onStdout` / `onStderr` stream through the NeevCloud exec API instead of the in-sandbox daemon, and a command past its `timeout` returns exit code 124.
  - `getInfo()` reports the sandbox lifetime and its name, region and template.
  - `filesystem.remove()` deletes a non-empty directory instead of failing.
  - Paths: an absolute path is now used as is instead of being re-rooted at the workspace, so `/workspace/a.txt` and `/tmp/a.txt` mean what they say in `filesystem` calls and `runCommand`. Code that wrote `/app.txt` to mean the workspace file should use `app.txt`.

## 1.0.7

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 1.0.6

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 1.0.5

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 1.0.4

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 1.0.3

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 1.0.2

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 1.0.1

### Patch Changes

- fc7ddc9: Add NeevCloud provider
- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5
