# @computesdk/tenki

## 0.1.30

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

## 0.1.29

### Patch Changes

- 0f42396: Refresh package descriptions and READMEs with current ComputeSDK branding, provider links, and setup instructions.
- Updated dependencies [0f42396]
  - computesdk@4.1.23
  - @computesdk/provider@2.1.29

## 0.1.28

### Patch Changes

- 703129f: Add the standard `sizeClass` mapping: every size from `xs` to `3xl` maps to exact per-create `cpuCores` / `memoryMb`, with the platform's 5/10/20/40 GiB root disk for `sm`–`xl`. Native `cpuCores`/`memoryMb` with `sizeClass` is a conflict, and `snapshotId` restores are `unknown`.
- Updated dependencies [eaec2cd]
  - computesdk@4.1.22
  - @computesdk/provider@2.1.28

## 0.1.27

### Patch Changes

- Updated dependencies [ce6d638]
  - computesdk@4.1.21
  - @computesdk/provider@2.1.27

## 0.1.26

### Patch Changes

- Updated dependencies [b979719]
  - computesdk@4.1.20
  - @computesdk/provider@2.1.26

## 0.1.25

### Patch Changes

- 43a9bd7: Rebrand the Tenki provider as Luxor. The package and provider id remain `tenki`/`@computesdk/tenki` for compatibility, while the provider exports `luxor`, prefers `LUXOR_*` credentials and endpoint variables with `LUXORAI_*`/`TENKI_*` fallbacks, and updates docs/metadata to luxor.ai.
- Updated dependencies [1fc7e73]
  - computesdk@4.1.19
  - @computesdk/provider@2.1.25

## 0.1.24

### Patch Changes

- computesdk@4.1.18
- @computesdk/provider@2.1.24

## 0.1.23

### Patch Changes

- Updated dependencies [8e11040]
  - @computesdk/provider@2.1.23
  - computesdk@4.1.17

## 0.1.22

### Patch Changes

- 1904e82: Sandboxes can now be paused and resumed with `sandbox.pause()` / `sandbox.resume()` (memory and running processes survive), and the provider declares what its snapshots keep: memory snapshots of the root filesystem except `/tmp`, which Tenki empties on the source while capturing; the source keeps running.
- 1904e82: tenki: add snapshot create/list/delete (restore via `create({ snapshotId })`), and serve filesystem calls outside the `/home/tenki` workdir through the shell instead of failing.
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [4924af5]
  - @computesdk/provider@2.1.22
  - computesdk@4.1.16

## 0.1.21

### Patch Changes

- Updated dependencies [24803d6]
  - computesdk@4.1.15
  - @computesdk/provider@2.1.21

## 0.1.20

### Patch Changes

- Updated dependencies [2bd2e7d]
- Updated dependencies [0a54571]
  - @computesdk/provider@2.1.20
  - computesdk@4.1.14

## 0.1.19

### Patch Changes

- f062b5d: Restore native `volumes` passthrough in `create()`. The unified-volume surface made `options.volumes` mean `VolumeMount[]` on every provider, which silently mangled provider-native volume specs callers were already passing: entries without a `volume` key resolved `name`/`volumeId` to `undefined`, so e.g. blaxel's `{name, type, sizeMb, mountPath}` hit the wire as `{"mountPath":"/","type":"persistent"}` and failed validation (`Volume binding 'name' and 'mountPath' must be strings`). Modal's native `volumes` dict was dropped entirely.

  `volumes` is now treated as unified mounts only when it is a non-empty array where every entry carries `volume` (new `isUnifiedVolumeMounts` guard in `@computesdk/provider`). Anything else stays in provider options and reaches the provider untouched, restoring the pre-unified passthrough.

- Updated dependencies [f062b5d]
  - @computesdk/provider@2.1.19

## 0.1.18

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 0.1.17

### Patch Changes

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 0.1.16

### Patch Changes

- a3de4ae: Volume soak fixes: `withVolumeSettle` retries volume delete while the provider reports it still attached (sandbox.destroy() returns before the control plane unmounts); daytona volume get/delete resolve by id or name (`volume.get` is name-keyed); miosa create defaults size_bytes to 1 GiB (missing field 422s); sandbox0 create sends the explicit s0fs/RWO request.
- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 0.1.15

### Patch Changes

- 1b639da: Add a unified persistent-volume surface: `CreateInstanceOptions.volumes` (create-time mounts), `compute.volume.create/get/list/delete` with multi-provider routing, and `instance.attachVolume`/`detachVolume` where the provider exposes runtime attach. Provider plumbing maps the unified `VolumeMount[]` onto each native wire shape (daytona `volumes[]`, e2b `volumeMounts`, modal `volumes` map, vercel `mounts`, namespace `volumes[]` with `persistency_kind`, northflank `volumesToAttach`, sandbox0 claim `mounts`, tenki `CreateOptions.volumes`, novita `volumeMounts`, createos `disks` attachments, plus volume managers for blaxel, declaw, beam, microsandbox, miosa).
- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 0.1.14

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 0.1.13

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 0.1.12

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 0.1.11

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 0.1.10

### Patch Changes

- 475a432: Update the Tenki sandbox SDK to 1.4 and report timed-out commands as failures while preserving their partial output.
- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 0.1.9

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.1.7

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.1.5

### Patch Changes

- 67676e8: Update the Tenki sandbox SDK to 1.0.3.
- 6431e9f: Update the Tenki sandbox SDK to 1.0.4.

## 0.1.4

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.1.3

### Patch Changes

- d92e1e3: Update `@tenkicloud/sandbox` to 0.5.4 and replace project scope with server-side workspace inference.

## 0.1.2

### Patch Changes

- e324fd6: Update @tenkicloud/sandbox to 0.4.0 and map the new USER_SHUTDOWN session state to "stopped" in getInfo().
- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.1.1

### Patch Changes

- 1ffe0e3: Add Tenki Cloud provider. MicroVM sandboxes with native filesystem operations, public preview URLs via getUrl, sh -lc command execution, and automatic workspace/project resolution from the API key.
