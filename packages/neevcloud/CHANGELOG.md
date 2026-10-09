# @computesdk/neevcloud

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
