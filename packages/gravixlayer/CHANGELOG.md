# @computesdk/gravixlayer

## 1.0.26

### Patch Changes

- a76eb1a: Bump `gravixlayer` to ^0.1.53. Default placement changes from `aws` / `us-east-1` to `gravix` / `us-central-1` when `cloud`/`region` (or `GRAVIXLAYER_CLOUD`/`GRAVIXLAYER_REGION`) are not set. Set them explicitly to keep the previous placement. Docs and test fixtures updated to match.
- a76eb1a: `volume.create` now waits for the backing bucket to reach `active` before returning. Buckets come back `provisioning` and stay unmountable for a short window, so a `volume.create` → `sandbox.volumes.mount` sequence raced and failed with `bucket not active`. The wait is bounded (60s) and throws on terminal statuses (`failed`, `error`, `deleted`) instead of polling forever.

## 1.0.25

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

## 1.0.24

### Patch Changes

- 0f42396: Refresh package descriptions and READMEs with current ComputeSDK branding, provider links, and setup instructions.
- Updated dependencies [0f42396]
  - computesdk@4.1.23
  - @computesdk/provider@2.1.29

## 1.0.23

### Patch Changes

- Updated dependencies [eaec2cd]
  - computesdk@4.1.22
  - @computesdk/provider@2.1.28

## 1.0.22

### Patch Changes

- Updated dependencies [ce6d638]
  - computesdk@4.1.21
  - @computesdk/provider@2.1.27

## 1.0.21

### Patch Changes

- afe5173: `readFile` now streams through the binary download endpoint, and `writeFile` above 1 MiB routes through the binary upload endpoint — writes and reads larger than the JSON body cap succeed instead of failing.
- 6da0b5b: Add `sizeClass` support: all six tiers (`xs` through `2xl`) boot the per-size `base-*` templates (`base-xsmall` through `base-2xlarge`), `sizeTemplates` config overrides the tier names, and a missing mapped template fails with remediation guidance.

  Accept `image` on create instead of throwing: it is a template name — `image: 'node:22'` boots the template named `node:22` — so a differing `templateId` is a conflict and a missing template fails with remediation guidance (`template.create` or `sizeTemplates`).

- Updated dependencies [b979719]
  - computesdk@4.1.20
  - @computesdk/provider@2.1.26

## 1.0.20

### Patch Changes

- Updated dependencies [1fc7e73]
  - computesdk@4.1.19
  - @computesdk/provider@2.1.25

## 1.0.19

### Patch Changes

- computesdk@4.1.18
- @computesdk/provider@2.1.24

## 1.0.18

### Patch Changes

- dfda0fc: Add bucket-mount volume support: `compute.volume` (managed buckets via `storage.buckets`), `volumes` create-option mounts, and `attachVolume`/`detachVolume`. Bumps `gravixlayer` to ^0.1.51 for the mounts/storage APIs.
- Updated dependencies [8e11040]
  - @computesdk/provider@2.1.23
  - computesdk@4.1.17

## 1.0.17

### Patch Changes

- 1904e82: Snapshots now default to `hot` (filesystem and memory), so `/tmp` contents are restored. Pass `metadata: { kind: 'cold' }` for a filesystem-only snapshot.
- 1904e82: Native pause/resume (`instance.pause()`/`resume()`, keeping memory and running processes), declared `snapshot.capabilities` (hot rootfs snapshots that keep processes and leave the source running), and a generated snapshot name when none is given.
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [1904e82]
- Updated dependencies [4924af5]
  - @computesdk/provider@2.1.22
  - computesdk@4.1.16

## 1.0.16

### Patch Changes

- Updated dependencies [24803d6]
  - computesdk@4.1.15
  - @computesdk/provider@2.1.21

## 1.0.15

### Patch Changes

- Updated dependencies [2bd2e7d]
- Updated dependencies [0a54571]
  - @computesdk/provider@2.1.20
  - computesdk@4.1.14

## 1.0.14

### Patch Changes

- Updated dependencies [f062b5d]
  - @computesdk/provider@2.1.19

## 1.0.13

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 1.0.12

### Patch Changes

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 1.0.11

### Patch Changes

- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 1.0.10

### Patch Changes

- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 1.0.9

### Patch Changes

- a0409a6: Send the create lease as `timeout` and the HTTP budget as `requestTimeoutMs`.
  In the new SDK, `timeout` is the product duration in seconds on every call —
  matching what ComputeSDK's own millisecond `timeout` always meant — and
  `timeoutSeconds` was removed. The 180s boot budget moves to
  `requestTimeoutMs`, the per-call HTTP deadline, so it can no longer be
  mistaken for a lifetime. Floors the SDK at ^0.1.36.

## 1.0.8

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 1.0.7

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 1.0.6

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 1.0.5

### Patch Changes

- e13a18e: Floor the `gravixlayer` SDK at ^0.1.34.

## 1.0.4

### Patch Changes

- d404179: Resolve a provider config object once in `getClient` — repeated calls on the same provider instance skip option resolution entirely, while instances with equivalent options still share one client and its session pool.
- 8d8adf6: Floor the `gravixlayer` SDK at ^0.1.32 so installs resolve the current transport with the eager session pool and `connect()` pre-connect API.

## 1.0.3

### Patch Changes

- 1b608c6: Floor the `gravixlayer` SDK at ^0.1.30 so installs resolve the pooled HTTP/2 transport the provider documents.

## 1.0.2

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 1.0.1

### Patch Changes

- c70043c: Add GravixLayer provider
- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9
