# @computesdk/railway

## 2.0.29

### Patch Changes

- 06d4bab: Bump provider SDKs to their latest npm releases:

  - @computesdk/aws: `@aws-sdk/client-bedrock-agentcore` 3.1176.0 -> 3.1178.0
  - @computesdk/aws: `@aws-sdk/client-ec2` 3.1176.0 -> 3.1178.0
  - @computesdk/aws: `@aws-sdk/client-s3` 3.1176.0 -> 3.1178.0
  - @computesdk/aws: `@aws-sdk/client-ssm` 3.1176.0 -> 3.1178.0
  - @computesdk/boat: `@boatdev/sdk` ^1.13.0 -> ^1.13.2
  - @computesdk/createos-sandbox: `@nodeops-createos/sandbox` ^0.8.3 -> ^0.8.5
  - @computesdk/gravixlayer: `gravixlayer` ^0.1.54 -> ^0.1.55
  - @computesdk/r2: `@tigrisdata/storage` ^3.25.0 -> ^3.26.0
  - @computesdk/railway: `railway` ^3.17.0 -> ^3.19.1
  - @computesdk/render: `@renderinc/sdk` ^1.10.0 -> ^1.11.0
  - @computesdk/s3: `@tigrisdata/storage` ^3.25.0 -> ^3.26.0
  - @computesdk/tangle: `@tangle-network/sandbox` 1.0.588 -> 1.0.619
  - @computesdk/tigris: `@tigrisdata/storage` ^3.25.0 -> ^3.26.0

- Updated dependencies [b9a5708]
  - computesdk@4.1.25
  - @computesdk/provider@2.1.31

## 2.0.28

### Patch Changes

- 2ff9301: Bump provider SDKs to their latest npm releases:

  - @computesdk/aws: `@aws-sdk/client-bedrock-agentcore` 3.1078.0 -> 3.1176.0
  - @computesdk/aws: `@aws-sdk/client-ec2` 3.1078.0 -> 3.1176.0
  - @computesdk/aws: `@aws-sdk/client-s3` 3.1078.0 -> 3.1176.0
  - @computesdk/aws: `@aws-sdk/client-ssm` 3.1078.0 -> 3.1176.0
  - @computesdk/aws: `@aws-sdk/types` 3.973.15 -> 3.975.1
  - @computesdk/beam: `@beamcloud/beam-js` ^1.0.22 -> ^1.1.6
  - @computesdk/blaxel: `@blaxel/core` ^0.3.21 -> ^0.3.41
  - @computesdk/boat: `@boatdev/sdk` ^1.9.9 -> ^1.13.0
  - @computesdk/browserbase: `@browserbasehq/sdk` ^2.0.0 -> ^2.29.0
  - @computesdk/browseruse: `browser-use-sdk` ^3.4.3 -> ^3.12.1
  - @computesdk/createos-sandbox: `@nodeops-createos/sandbox` ^0.8.1 -> ^0.8.3
  - @computesdk/freestyle: `freestyle` ^0.2.11 -> ^0.2.24
  - @computesdk/gravixlayer: `gravixlayer` ^0.1.51 -> ^0.1.54
  - @computesdk/isorun: `isorun` ^1.0.0 -> ^1.0.3
  - @computesdk/lightning: `@lightningai/sdk` ^2026.7.8 -> ^2026.11.20
  - @computesdk/miosa: `@miosa/sdk` ^3.7.14 -> ^3.9.0
  - @computesdk/modal: `modal` 0.11.0 -> 0.11.2
  - @computesdk/novita: `novita-sandbox` ^2.1.1 -> ^2.1.5
  - @computesdk/r2: `@tigrisdata/storage` ^3.6.0 -> ^3.25.0
  - @computesdk/railway: `railway` ^3.1.1 -> ^3.17.0
  - @computesdk/render: `@renderinc/sdk` ^1.8.0 -> ^1.10.0
  - @computesdk/s3: `@tigrisdata/storage` ^3.6.0 -> ^3.25.0
  - @computesdk/tangle: `@tangle-network/sandbox` 1.0.501 -> 1.0.588
  - @computesdk/tenki: `@luxorai/sandbox` ^1.5.2 -> ^1.5.3
  - @computesdk/tensorlake: `tensorlake` ^0.5.158 -> ^0.5.165
  - @computesdk/tigris: `@tigrisdata/storage` ^3.6.0 -> ^3.25.0
  - @computesdk/vercel: `@vercel/sandbox` ^4.0.0 -> ^4.1.0

- Updated dependencies [05ed179]
  - computesdk@4.1.24
  - @computesdk/provider@2.1.30

## 2.0.27

### Patch Changes

- 0f42396: Refresh package descriptions and READMEs with current ComputeSDK branding, provider links, and setup instructions.
- Updated dependencies [0f42396]
  - computesdk@4.1.23
  - @computesdk/provider@2.1.29

## 2.0.26

### Patch Changes

- f39446b: Map `sizeClass` `xs` through `xl` to exact Railway `resources` (vCPU / decimal GB) on fresh and checkpoint creates; `2xl` and `3xl` are `unsupported` (Railway's listed maximum is 24 vCPU / 24 GB).
- Updated dependencies [eaec2cd]
  - computesdk@4.1.22
  - @computesdk/provider@2.1.28

## 2.0.25

### Patch Changes

- Updated dependencies [ce6d638]
  - computesdk@4.1.21
  - @computesdk/provider@2.1.27

## 2.0.24

### Patch Changes

- Updated dependencies [b979719]
  - computesdk@4.1.20
  - @computesdk/provider@2.1.26

## 2.0.23

### Patch Changes

- Updated dependencies [1fc7e73]
  - computesdk@4.1.19
  - @computesdk/provider@2.1.25

## 2.0.22

### Patch Changes

- computesdk@4.1.18
- @computesdk/provider@2.1.24

## 2.0.21

### Patch Changes

- fbdf09f: Honor native Railway CPU and decimal-GB memory overrides for sandbox creates and checkpoint restores through the public API. Reject invalid resource values instead of silently using workspace defaults.

## 2.0.20

### Patch Changes

- Updated dependencies [8e11040]
  - @computesdk/provider@2.1.23
  - computesdk@4.1.17

## 2.0.19

### Patch Changes

- 1904e82: Add snapshot support backed by Railway sandbox checkpoints (create, list, delete, and restore via `sandbox.create({ snapshotId })`), and move the filesystem onto Railway's native `sandbox.files` API.
- 1904e82: Declare snapshot capabilities: a Railway checkpoint keeps the whole root filesystem (including `/tmp`, not `/dev/shm`), boots restores fresh without running processes, and leaves the source running; the conformance suite now runs snapshot tests live. An exec whose WebSocket never opened is retried even when its timeout fired while connecting.
- 1904e82: Stream command output natively through `sandbox.exec`, pass `env`/`cwd` through `sandbox.exec` so env reaches every part of a compound command, make command timeouts kill the process in the sandbox instead of only closing the client session, and retry execs whose session never opened.
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [4924af5]
  - @computesdk/provider@2.1.22
  - computesdk@4.1.16

## 2.0.18

### Patch Changes

- Updated dependencies [24803d6]
  - computesdk@4.1.15
  - @computesdk/provider@2.1.21

## 2.0.17

### Patch Changes

- Updated dependencies [2bd2e7d]
- Updated dependencies [0a54571]
  - @computesdk/provider@2.1.20
  - computesdk@4.1.14

## 2.0.16

### Patch Changes

- Updated dependencies [f062b5d]
  - @computesdk/provider@2.1.19

## 2.0.15

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 2.0.14

### Patch Changes

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 2.0.13

### Patch Changes

- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 2.0.12

### Patch Changes

- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 2.0.11

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 2.0.10

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 2.0.9

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 2.0.8

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 2.0.7

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 2.0.6

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 2.0.5

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 2.0.4

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 2.0.3

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 2.0.2

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 2.0.1

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 2.0.0

### Major Changes

- 30150ee: Republish @computesdk/railway as a real sandbox provider.

  The 1.x line on npm (up to 1.2.2) was a non-functional placeholder. This release
  ships the actual Railway Sandboxes provider (command execution, shell-based
  filesystem, list/get/destroy). The package baseline is realigned to the current
  npm version and bumped to 2.0.0 so the published implementation takes effect.

## 1.0.1

### Patch Changes

- 447dedf: Add Railway provider
