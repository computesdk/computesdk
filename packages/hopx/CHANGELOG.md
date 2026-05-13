# @computesdk/hopx

## 0.2.22

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0
  - @computesdk/provider@2.0.0

## 0.2.21

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

## 0.2.20

### Patch Changes

- Updated dependencies [a321f01]
  - computesdk@2.6.0
  - @computesdk/provider@1.3.0

## 0.2.19

### Patch Changes

- 7c53d28: Add `buildShellCommand` utility to unify shell command building across providers

  Centralizes cwd/env handling into a single `buildShellCommand` function in
  `@computesdk/provider`, fixing bugs where env vars didn't work with cwd set
  (docker, sprites, hopx) and where values weren't properly quoted (namespace,
  sprites, hopx). All shell-based providers now use the shared utility.

- Updated dependencies [7c53d28]
  - @computesdk/provider@1.2.0

## 0.2.18

### Patch Changes

- Updated dependencies [3e6a91a]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.2.18

### Patch Changes

- Updated dependencies [9a312d2]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.2.18

### Patch Changes

- Updated dependencies [b34d97f]
  - @computesdk/provider@1.1.0
  - computesdk@2.5.4

## 0.2.17

### Patch Changes

- Updated dependencies [45f918b]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33

## 0.2.17

### Patch Changes

- Updated dependencies [0b97465]
  - computesdk@2.5.3
  - @computesdk/provider@1.0.33

## 0.2.16

### Patch Changes

- Updated dependencies [5f1b08f]
  - computesdk@2.5.2
  - @computesdk/provider@1.0.32

## 0.2.13

### Patch Changes

- Updated dependencies [3c4e595]
  - computesdk@2.4.0
  - @computesdk/provider@1.0.29

## 0.2.12

### Patch Changes

- Updated dependencies [d49d036]
  - computesdk@2.3.0
  - @computesdk/provider@1.0.28

## 0.2.11

### Patch Changes

- f0bf381: Update packages for direct providers, fix runloop keep_alive default, and update daytona list method

## 0.2.10

### Patch Changes

- Updated dependencies [5b010a3]
  - computesdk@2.2.1
  - @computesdk/provider@1.0.27

## 0.2.9

### Patch Changes

- Updated dependencies [55b793e]
  - computesdk@2.2.0
  - @computesdk/provider@1.0.26

## 0.2.8

### Patch Changes

- Updated dependencies [a5a7f63]
  - computesdk@2.1.2
  - @computesdk/provider@1.0.25

## 0.2.7

### Patch Changes

- Updated dependencies [2c9468b]
  - computesdk@2.1.1
  - @computesdk/provider@1.0.24

## 0.2.6

### Patch Changes

- Updated dependencies [9e7e50a]
  - computesdk@2.1.0
  - @computesdk/provider@1.0.23

## 0.2.5

### Patch Changes

- Updated dependencies [e3ed89b]
  - computesdk@2.0.2
  - @computesdk/provider@1.0.22

## 0.2.4

### Patch Changes

- ca82472: Bump versions to skip burned version numbers from rollback.

## 0.2.3

### Patch Changes

- Updated dependencies [53506ed]
  - computesdk@2.0.1
  - @computesdk/provider@1.0.21

## 0.2.2

### Patch Changes

- Updated dependencies [9946e72]
  - computesdk@1.21.1
  - @computesdk/provider@1.0.20

## 0.2.1

### Patch Changes

- Updated dependencies [7ba17e1]
  - computesdk@1.21.0
  - @computesdk/provider@1.0.19

## 0.2.0

### Minor Changes

- 8cc4035: add hopx to providers
