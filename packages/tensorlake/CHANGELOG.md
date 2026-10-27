# @computesdk/tensorlake

## 0.1.30

### Patch Changes

- d24737a: Retry sandbox create briefly on "reached its quota": terminate() resolves before the project quota slot is released, so a destroy→create cycle could fail even with nothing still running.
- d24737a: Retry the writable-workdir probe before falling back to "/". Right after create() the exec endpoint can lag the sandbox's reported readiness, so a single failed probe sent relative runCommand calls to an unwritable "/" cwd.

## 0.1.29

### Patch Changes

- 7668bf8: tensorlake: default `runCommand`/`streamCommand` cwd to the writable workdir already probed for filesystem paths — the sandbox default cwd is `/`, which isn't writable, so relative-path commands (e.g. `mkdir bench-rootfs`) failed with EACCES.

  sandbox0: retry `sandbox.cmd` context creation on the transient "runtime access is not ready for this generation" response (and retryable 429/5xx), bounded by the command deadline — a claimed sandbox can race its runtime coming up.

## 0.1.28

### Patch Changes

- b040637: Require `tensorlake` `^0.5.158`. From 0.5.136 to 0.5.157 the SDK's default `Sandbox.create()` sent the create with `wait: false` and then polled every 2 s, so a sandbox that was already running after a few hundred milliseconds still cost the caller the full poll interval. 0.5.158 waits on the server's own state change instead and returns as soon as the sandbox is running.

  The adapter's create options are now typed as the SDK's `CreateAndConnectOptions`, which keeps the SDK's conditional return type resolved to a connected `Sandbox`. No runtime behavior in the adapter changes.

- Updated dependencies [f062b5d]
  - @computesdk/provider@2.1.19

## 0.1.27

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 0.1.26

### Patch Changes

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 0.1.25

### Patch Changes

- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 0.1.24

### Patch Changes

- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 0.1.23

### Patch Changes

- 0c30a8f: Fix `runCommand` contract violations found by the sandbox CI capabilities benchmark:

  - **Timeout dropped**: modal, vercel, declaw, and tensorlake never forwarded `options.timeout` to the underlying SDK (`timeoutMs`/`timeout` fields). Beam has no native timeout option, so the adapter now kills the process when the deadline passes.
  - **Merged stdout/stderr**: daytona, codesandbox, and sprites only expose one combined output stream; the adapters now redirect stderr to a temp file and parse it back behind a delimiter so `stderr` is populated correctly. Upstash already returns `stderr` — the adapter now forwards it.
  - **Exit code collapsed**: codesandbox hardcoded `exitCode: 0`; it now captures the real exit code in-band.

## 0.1.22

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 0.1.21

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 0.1.20

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 0.1.19

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 0.1.18

### Patch Changes

- 5c1fe5d: `getUrl` exposes the port via the SDK's additive `SandboxClient.exposePorts` instead of a read-modify-write `update()`, so concurrent calls can't clobber each other's ports and a failed `info()` read can no longer unexpose existing ports.
- 5bdd15d: Fix `getUrl` returning unusable preview URLs: build the URL on `sandbox.tensorlake.ai` (swapping `api.` → `sandbox.` in the API hostname) instead of the API host, and register the port in `exposed_ports` with `allow_unauthenticated_access` before returning so the URL is publicly reachable.

## 0.1.17

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 0.1.16

### Patch Changes

- 620c463: Skip the line-less terminal event Tensorlake's follow streams emit at end-of-stream; interpolating it unconditionally appended a literal `undefined` line to every streamed command's stdout and stderr. Buffered output (`getStdout`/`getStderr`) is filtered the same way.
- 182c992: Update the `tensorlake` SDK from 0.5.33 to 0.5.135.

## 0.1.15

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.1.14

### Patch Changes

- 1f0a8f4: Resolve relative `filesystem.*` paths to an absolute workdir before calling the provider's filesystem API (which requires absolute paths). Relative paths now resolve against the sandbox's exec cwd — falling back to `$HOME` on Tensorlake when the cwd isn't writable — matching what `runCommand` execs see. `.` and duplicate slashes normalize; `..` is preserved for physical resolution.

## 0.1.13

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.1.12

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.1.11

### Patch Changes

- 3914faa: Fix disk sizing on sandbox create: `ephemeralDiskMb` was passed under a name the Tensorlake SDK's `Sandbox.create` ignores — it now maps to `diskMb`, so the requested disk size is honored. `SandboxResourceOptions` gains a typed `diskMb` field (Tensorlake), and the adapter accepts `diskMb` directly with `ephemeralDiskMb` kept as an alias.
- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.1.10

### Patch Changes

- 6ec91ff: Stream a command's output while it runs, over a provider's own process API. Providers can now implement `streamCommand` to serve `onStdout`/`onStderr` themselves instead of using the daemond SSE bridge, which needs a routable port inside the sandbox, and `streamCommandViaProcess` from `@computesdk/provider` does the whole lifecycle for them — deadline, best-effort kill, exit polling and recovering the tail when a follow connection drops — so a provider supplies only its start/follow/status/kill calls. Tensorlake is the first to use it, so a long-running command there reports line by line rather than only at exit.
- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.1.9

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.1.8

### Patch Changes

- a60152c: Update the Tensorlake SDK dependency to 0.5.33.

## 0.1.7

### Patch Changes

- f4af9af: Update the Tensorlake SDK dependency to 0.5.31.

## 0.1.6

### Patch Changes

- Updated dependencies [607a11b]
  - computesdk@4.1.3
  - @computesdk/provider@2.1.3

## 0.1.5

### Patch Changes

- computesdk@4.1.2
- @computesdk/provider@2.1.2

## 0.1.4

### Patch Changes

- Updated dependencies [eca5ec2]
  - computesdk@4.1.1
  - @computesdk/provider@2.1.1

## 0.1.3

### Patch Changes

- Updated dependencies [cc79d78]
  - computesdk@4.1.0
  - @computesdk/provider@2.1.0

## 0.1.2

### Patch Changes

- 7c6b99b: Remove hardcoded default image name and resource values when creating Tensorlake sandboxes; let the server choose defaults when options are omitted.

## 0.1.1

### Patch Changes

- e07d46f: Fix `timeout` unit mismatch in the Tensorlake provider. `config.timeout` (passed to `tensorlake({ timeout: ... })`) was being forwarded to the underlying SDK as seconds while `options.timeout` (passed to `compute.sandbox.create({ timeout: ... })`) was correctly treated as milliseconds, contradicting the `TensorlakeConfig` interface comment. Both inputs are now consistently milliseconds and converted to seconds at the SDK boundary, matching the convention used by every other ComputeSDK provider.

## 0.1.0

### Minor Changes

- b4ad62c: Add `@computesdk/tensorlake` provider for stateful MicroVM sandboxes powered by Tensorlake (https://tensorlake.ai), aimed at agentic applications and LLM-generated code execution. Wraps the `tensorlake` SDK and is auto-detected by the `computesdk` gateway via the `TENSORLAKE_API_KEY` environment variable.

## 0.0.1

### Patch Changes

- Initial release of the Tensorlake provider for ComputeSDK
