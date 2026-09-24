# @computesdk/cli

## 1.0.10

### Patch Changes

- f0a227a: `compute actions history <repo> --workflow <path|name>` — recent run history with per-job/step failure rates (the flakiness signal from `GET /api/v1/actions/history`), with `--branch`, `--job`, `--limit`, and `--json`.
- b3020fb: feat(cli): `compute actions providers` gains `configure`, `verify`, `remove`

  `configure <provider>` saves the org's provider credential via
  `PUT /api/v1/actions/providers/{provider}/key` (`--key` or `--field
name=value`), `--verify` runs the placement probe,
  `verify <provider>` re-runs it, and `remove <provider>` deletes the stored
  key. Requires an owner/admin-level org API key.

- 4c9bf19: feat(cli): `compute actions providers` lists the org's registered providers

  Reads `GET /api/v1/actions/providers` and prints each registered ComputeSDK
  provider with its credential state, act capability, selectable regions, and
  position in the org's provider order — so CI tooling can enumerate provider
  ids instead of hardcoding them. `--json` prints the raw response.

- 1067ad4: feat(cli): `compute actions dispatch` accepts `--provider`/`--provider-region`

  Passes the run's provider override through to the v1 dispatch API (`provider`,
  `providerRegion`) so a manually dispatched run can be pinned to one provider
  (and optionally one region) instead of following the org provider order.
  `compute actions run` also prints `dispatched to: provider[:region]` when the
  run carries an override.

## 1.0.9

### Patch Changes

- 866ef0b: Add `compute actions` command group — drive the benchmarks-platform Actions v1 API end-to-end:

  - `actions dispatch <repo> --workflow <path|name> [--ref <ref>] [--inputs k=v...]` — resolves the workflow via `/workflows`, dispatches, prints run id + dashboard URL
  - `actions runs <repo> [--status ...] [--branch ...]` — recent run list
  - `actions run <run-id>` — full detail incl. jobs, provider:region placement, placement attempts
  - `actions logs <run-id> [--job] [--step] [--follow]` — byte-offset resumable slices; `--follow` uses SSE (single job) or the multiplexed run stream (all jobs), resuming cursors on reconnect
  - `actions cancel|rerun <run-id>`
  - `actions artifacts <run-id> [--job] [--out <dir>]` — list or download

  Auth via `COMPUTE_API_KEY` or `--api-key`; `--base-url` overrides the platform.computesdk.com default; every subcommand supports `--json`.

  Fold the bench CLI under compute: `compute bench <args>` dispatches to `@benchsdk/runner`'s `run()`, covering the full `bench` surface (`run`, `check`, `auth`, `org`, `benchmarks`, `runs`, `results`, `iterations`, `artifacts`, `logs`, `export`) — one implementation, both bins.

  Also fixes `@computesdk/cli` failing to start at all: `providers.ts` imported `PROVIDER_NAMES`/`isProviderAuthComplete`/etc. from `computesdk`, which no longer exports them — provider detection is now env-var based, and `installer.ts` had an undefined `resolveApiKey` reference.

- 04b5ac9: Rename the `compute actions` env vars to `COMPUTE_API_KEY` and `COMPUTE_PLATFORM_URL` (the `BENCHMARKS_PLATFORM_*` names remain as fallback aliases).
  - computesdk@4.1.7

## 1.0.8

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6

## 1.0.7

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5

## 1.0.6

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4

## 1.0.5

### Patch Changes

- Updated dependencies [607a11b]
  - computesdk@4.1.3

## 1.0.4

### Patch Changes

- computesdk@4.1.2

## 1.0.3

### Patch Changes

- Updated dependencies [eca5ec2]
  - computesdk@4.1.1

## 1.0.2

### Patch Changes

- Updated dependencies [cc79d78]
  - computesdk@4.1.0

## 1.0.1

### Patch Changes

- Updated dependencies [aa4ca58]
  - computesdk@4.0.0

## 1.0.0

### Major Changes

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

### Patch Changes

- Updated dependencies [371f667]
  - computesdk@3.0.0

## 0.1.2

### Patch Changes

- Updated dependencies [a321f01]
  - computesdk@2.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [3e6a91a]
  - computesdk@2.5.4

## 0.1.1

### Patch Changes

- Updated dependencies [9a312d2]
  - computesdk@2.5.4

## 0.1.1

### Patch Changes

- Updated dependencies [b34d97f]
  - computesdk@2.5.4
