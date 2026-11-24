# @computesdk/isorun

## 0.1.29

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

## 0.1.28

### Patch Changes

- 0f42396: Refresh package descriptions and READMEs with current ComputeSDK branding, provider links, and setup instructions.
- Updated dependencies [0f42396]
  - computesdk@4.1.23
  - @computesdk/provider@2.1.29

## 0.1.27

### Patch Changes

- 3c24249: Add a standard `sizeClass` resolver: `xs`, `md`, `lg` and `xl` map to Isorun's listed 1/1, 2/4, 4/8 and 8/16 GiB shapes (md–xl with 16/32/64 GiB disk); `sm`, `2xl` and `3xl` are `unsupported`, and `snapshotId` with `sizeClass` is refused.
- Updated dependencies [eaec2cd]
  - computesdk@4.1.22
  - @computesdk/provider@2.1.28

## 0.1.26

### Patch Changes

- Updated dependencies [ce6d638]
  - computesdk@4.1.21
  - @computesdk/provider@2.1.27

## 0.1.25

### Patch Changes

- Updated dependencies [b979719]
  - computesdk@4.1.20
  - @computesdk/provider@2.1.26

## 0.1.24

### Patch Changes

- Updated dependencies [1fc7e73]
  - computesdk@4.1.19
  - @computesdk/provider@2.1.25

## 0.1.23

### Patch Changes

- computesdk@4.1.18
- @computesdk/provider@2.1.24

## 0.1.22

### Patch Changes

- Updated dependencies [8e11040]
  - @computesdk/provider@2.1.23
  - computesdk@4.1.17

## 0.1.21

### Patch Changes

- 1904e82: Native pause/resume via Isorun hibernate (memory and processes survive), and declared snapshot capabilities (whole rootfs plus memory; the source keeps running).
- 1904e82: Run commands detached and poll for completion so commands longer than Isorun's ~120s exec request cap finish (and `timeout` kills them), apply `env`/`cwd` to every part of a compound command, and move large files and command output in small verified chunks: multi-MiB downloads/exec bodies truncate and drop the sandbox console, and uploads above 4 MiB silently corrupt.
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [4924af5]
  - @computesdk/provider@2.1.22
  - computesdk@4.1.16

## 0.1.20

### Patch Changes

- Updated dependencies [24803d6]
  - computesdk@4.1.15
  - @computesdk/provider@2.1.21

## 0.1.19

### Patch Changes

- d4424cd: runCommand: capture output via guest files instead of streamed exec output. Provider exec transports can drop a contiguous chunk mid-stream (observed across all five providers during a CPU-bound quiet stretch) while still reporting success, silently corrupting captured stdout/stderr. Commands now redirect output to files inside the sandbox and the adapter reads them back with short-lived commands, verified against byte counts the command writes alongside. Microsandbox additionally records byte counts and re-reads through the alternate transport on a mismatch.

## 0.1.18

### Patch Changes

- Updated dependencies [2bd2e7d]
- Updated dependencies [0a54571]
  - @computesdk/provider@2.1.20
  - computesdk@4.1.14

## 0.1.17

### Patch Changes

- Updated dependencies [f062b5d]
  - @computesdk/provider@2.1.19

## 0.1.16

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 0.1.15

### Patch Changes

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 0.1.14

### Patch Changes

- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 0.1.13

### Patch Changes

- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 0.1.12

### Patch Changes

- 436964b: Wire `sandbox.create({ snapshotId })` to `Isorun.restore(snapshotId)` — the option was silently ignored, so restoring a snapshot booted a fresh image without the snapshotted filesystem.

## 0.1.11

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 0.1.10

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 0.1.9

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 0.1.8

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 0.1.7

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 0.1.6

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.1.5

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

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

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.1.1

### Patch Changes

- f3fe311: Add typed `SandboxResourceOptions` to `CreateSandboxOptions`

  - Introduce `SandboxResourceOptions` (CPU/memory/disk knobs), `RunloopLaunchParameters`, and `VercelSandboxResources` types, exported from `computesdk` and `@computesdk/provider`.
  - `CreateSandboxOptions` now extends `SandboxResourceOptions` and types `runtime`, `image`, `deploymentPlan`, `size`, `vmTier`, `resources`, and `launch_parameters`, so callers can replace `Record<string, any>` resource maps with `Partial<CreateSandboxOptions>` / `SandboxResourceOptions`.
  - `@computesdk/isorun`: cast `options.runtime` to the provider `Runtime` type now that the field is typed as `string`.
  - `@computesdk/runloop`: destructure `launch_parameters` out of passthrough options and merge it into the devbox `launch_parameters` instead of relying on the spread, fixing a type clash with the Runloop SDK's `LaunchParameters`.

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.1.0

- Initial release. Wraps the `isorun` SDK to expose the ComputeSDK provider interface — isolated Linux VM sandboxes for running untrusted and AI-generated code. Supports `create`, `getById`, `list`, `destroy`, `runCommand`, `getInfo`, `getUrl`, and full filesystem operations.
