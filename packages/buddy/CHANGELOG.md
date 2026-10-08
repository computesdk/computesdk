# @computesdk/buddy

## 1.0.9

### Patch Changes

- db6fb25: Run foreground `runCommand` calls through Buddy's synchronous `exec` endpoint: one request returns stdout, stderr and the exit code, instead of submit + log stream + status poll. Calls with `onStdout`/`onStderr`, `background: true` or a `timeout` keep using the `commands` resource and its log stream. Sandboxes still booting answer `exec` with 400 "Sandbox must be running"; the provider retries that like the other boot races.

## 1.0.8

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 1.0.7

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 1.0.6

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 1.0.5

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 1.0.4

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 1.0.3

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 1.0.2

### Patch Changes

- 9725ad3: Update `@buddy-works/sandbox-sdk` to 0.1.9 and sharpen the package description.

## 1.0.1

### Patch Changes

- d5fe811: Add the Buddy provider: Ubuntu sandboxes served from Buddy's pre-warmed pool, with streamed command output, native filesystem endpoints, public tunnels via `getUrl`, and snapshots doubling as templates. Built on `@buddy-works/sandbox-sdk`.
