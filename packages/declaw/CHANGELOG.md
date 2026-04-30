# @computesdk/declaw

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
