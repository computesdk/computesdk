# @computesdk/declaw

## 0.2.23

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 0.2.22

### Patch Changes

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 0.2.21

### Patch Changes

- a3de4ae: Volume soak fixes: `withVolumeSettle` retries volume delete while the provider reports it still attached (sandbox.destroy() returns before the control plane unmounts); daytona volume get/delete resolve by id or name (`volume.get` is name-keyed); miosa create defaults size_bytes to 1 GiB (missing field 422s); sandbox0 create sends the explicit s0fs/RWO request.
- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 0.2.20

### Patch Changes

- 1b639da: Add a unified persistent-volume surface: `CreateInstanceOptions.volumes` (create-time mounts), `compute.volume.create/get/list/delete` with multi-provider routing, and `instance.attachVolume`/`detachVolume` where the provider exposes runtime attach. Provider plumbing maps the unified `VolumeMount[]` onto each native wire shape (daytona `volumes[]`, e2b `volumeMounts`, modal `volumes` map, vercel `mounts`, namespace `volumes[]` with `persistency_kind`, northflank `volumesToAttach`, sandbox0 claim `mounts`, tenki `CreateOptions.volumes`, novita `volumeMounts`, createos `disks` attachments, plus volume managers for blaxel, declaw, beam, microsandbox, miosa).
- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 0.2.19

### Patch Changes

- 0c30a8f: Fix `runCommand` contract violations found by the sandbox CI capabilities benchmark:

  - **Timeout dropped**: modal, vercel, declaw, and tensorlake never forwarded `options.timeout` to the underlying SDK (`timeoutMs`/`timeout` fields). Beam has no native timeout option, so the adapter now kills the process when the deadline passes.
  - **Merged stdout/stderr**: daytona, codesandbox, and sprites only expose one combined output stream; the adapters now redirect stderr to a temp file and parse it back behind a delimiter so `stderr` is populated correctly. Upstash already returns `stderr` — the adapter now forwards it.
  - **Exit code collapsed**: codesandbox hardcoded `exitCode: 0`; it now captures the real exit code in-band.

## 0.2.18

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 0.2.17

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 0.2.16

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 0.2.15

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 0.2.14

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 0.2.13

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.2.12

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.2.11

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.2.10

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.2.9

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.2.8

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.2.7

### Patch Changes

- Updated dependencies [607a11b]
  - computesdk@4.1.3
  - @computesdk/provider@2.1.3

## 0.2.6

### Patch Changes

- computesdk@4.1.2
- @computesdk/provider@2.1.2

## 0.2.5

### Patch Changes

- Updated dependencies [eca5ec2]
  - computesdk@4.1.1
  - @computesdk/provider@2.1.1

## 0.2.4

### Patch Changes

- Updated dependencies [cc79d78]
  - computesdk@4.1.0
  - @computesdk/provider@2.1.0

## 0.2.3

### Patch Changes

- d651717: Adopt `Sandbox.kill(id)` static from `@declaw/sdk` 1.1.7 in `destroy`.

## 0.2.2

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0
  - @computesdk/provider@2.0.0

## 0.2.1

### Patch Changes

- 371f667: Remove the legacy daemon/client subsystem.

  **Breaking changes (`computesdk`):**

  - Removed the `Sandbox` client class and its entire `src/client/` subsystem (WebSocket protocol, resources, terminal/run/server/watcher/file/env/sessionToken/magicLink/signal/auth/child namespaces).
  - Removed re-exports: `Sandbox`, `SandboxStatus`, `ProviderSandboxInfo`, `CommandExitError`, `isCommandExitError`, `TerminalInstance`, `FileWatcher`, `SignalService`, `WebSocketConstructor`, `encodeBinaryMessage`, `decodeBinaryMessage`, `MessageType`, `buildSetupPayload`, `encodeSetupPayload`, `SetupPayload`, `SetupOverlayConfig`.
  - Removed the 11 optional advanced namespaces (`terminal?`, `run?`, `server?`, `watcher?`, `file?`, `env?`, `sessionToken?`, `magicLink?`, `signal?`, `auth?`, `child?`) from the `SandboxInterface`.
  - Removed `SandboxOverlayConfig`, `SandboxServerConfig`, `SandboxHealthCheckConfig` types.
  - Removed `overlays` and `servers` fields from `CreateSandboxOptions`.

  These APIs were only wired against the daemon transport, which was removed from the published package earlier. No shipped provider implemented them.

  **Breaking changes (`@computesdk/workbench`):**

  - Removed `workbench connect <url> [token]` (required the deleted `Sandbox` client class).
  - Removed `workbench provider local` and local-daemon auto-attach (required the deleted `Sandbox` client class).
  - Removed `mode gateway|direct` toggle and `provider direct <name>` / `provider gateway <name>` aliases.
  - Dropped the `child`, `server`, and `terminal` REPL bindings — they delegated to daemon-only namespaces.
  - Dropped `ws` runtime dependency.

  **Breaking changes (`@computesdk/cli`):**

  - Removed `pty` mode. `compute connect`, `compute sandbox connect`, `workspace attach`, and `sandbox create --connect` now drop into the REPL (`runCommand`-based) instead of an interactive PTY shell.
  - Removed the `/shell` REPL command that dropped into PTY.

  **Other:**

  - `@computesdk/provider` drops the optional `findOrCreate` / `find` / `extendTimeout` fields from `SandboxMethods` (matching the earlier compute-wrapper cleanup).
  - 14 provider packages get a patch bump for internal destructuring cleanup (removed unused `overlays` / `servers` destructure targets).

- Updated dependencies [3ef4817]
- Updated dependencies [371f667]
  - @computesdk/provider@1.4.0
  - computesdk@3.0.0

## 0.2.0

### Minor Changes

- 44af00e: Add `@computesdk/declaw` provider for Declaw secure sandboxes with PII scanning, prompt-injection defense, and network egress filtering.

## 0.1.0

- Initial release. Wraps `@declaw/sdk` to expose the ComputeSDK provider
  interface. Supports `create`, `getById`, `list`, `destroy`, `runCommand`,
  `runCode`, `getInfo`, `getUrl`, and full filesystem operations.
