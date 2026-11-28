# @computesdk/kosa8

## 1.0.11

### Patch Changes

- Updated dependencies [b9a5708]
  - computesdk@4.1.25
  - @computesdk/provider@2.1.31

## 1.0.10

### Patch Changes

- Updated dependencies [05ed179]
  - computesdk@4.1.24
  - @computesdk/provider@2.1.30

## 1.0.9

### Patch Changes

- 0f42396: Refresh package descriptions and READMEs with current ComputeSDK branding, provider links, and setup instructions.
- Updated dependencies [0f42396]
  - computesdk@4.1.23
  - @computesdk/provider@2.1.29

## 1.0.8

### Patch Changes

- 95826a8: Add standard `sizeClass` resolvers: boat (`type` presets for md–2xl), northflank (`deploymentPlan` for xs–2xl), neevcloud and microsandbox (exact CPU/memory for every tier). hopx, kosa8 and lelantos take a `sizeTemplates` config with one template per size and report `unconfigured` for sizes without one.

## 1.0.7

### Patch Changes

- Updated dependencies [eaec2cd]
  - computesdk@4.1.22
  - @computesdk/provider@2.1.28

## 1.0.6

### Patch Changes

- Updated dependencies [ce6d638]
  - computesdk@4.1.21
  - @computesdk/provider@2.1.27

## 1.0.5

### Patch Changes

- 6a0b829: Run commands on the sandbox's host directly when the create answer offers it (`direct`), falling back to the API when the host did not run the command.
- 6a0b829: Send requests over one HTTP/2 session per origin, opened when the provider is configured (and to a sandbox's host when it is created), instead of a TLS connection per request; `fetch` remains the fallback.
- 2f5a5be: `getInfo()` reports a sleeping sandbox as `running`: any command or file call wakes it in about a second. Stopped, deleted and expired sandboxes still report `stopped`.
- 2f5a5be: Add snapshots (`provider.snapshot` create, list and delete, and `create({ snapshotId })` to restore one, memory and running processes included), boot OCI images with `create({ image })`, and move file content as raw bytes through kosa8's file stream at any path: straight to the sandbox's host with the direct token when it covers files, else through the API; one request up to 64 MiB, parallel 64 MiB offset/range parts above that, and exec on older hosts. `runCommand` results report output the API truncated (`truncated`, `stdoutTruncated`, `stderrTruncated`, `stdoutBytes`, `stderrBytes`).
- Updated dependencies [b979719]
  - computesdk@4.1.20
  - @computesdk/provider@2.1.26

## 1.0.4

### Patch Changes

- Updated dependencies [1fc7e73]
  - computesdk@4.1.19
  - @computesdk/provider@2.1.25

## 1.0.3

### Patch Changes

- computesdk@4.1.18
- @computesdk/provider@2.1.24

## 1.0.2

### Patch Changes

- 6adbee1: kosa8: measure the exec argument limit in UTF-8 bytes; report exit 124 only when a timed command actually hit its deadline (an early exit 137 is kept); read KOSA8_TEMPLATE and KOSA8_REGION defaults; add SVG logos.

## 1.0.1

### Patch Changes

- 066aa1b: Add kosa8 provider
