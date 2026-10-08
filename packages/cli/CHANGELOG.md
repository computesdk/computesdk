# @computesdk/cli

## 2.2.0

### Minor Changes

- 7c14764: `compute sandboxes`: add `quote` (`size`/resources, region, timeout, order type, max price) and `create --size <small|medium|large|xlarge>` plus `--max-price`/`--max-price-per`, `--order-type`/`--market`, mirroring the platform-sizes API.

## 2.1.1

### Patch Changes

- a0b4dae: fix(cli): pass flags inside `sandboxes exec`/`spawn` commands through to the sandbox. `exec <id> uname -a` and `spawn <id> node -e "…"` no longer get eaten as CLI options; CLI options go before the command and `--` still works.

## 2.1.0

### Minor Changes

- 8cd26d2: Add `compute org` and a one-off org override.

  - `compute org list` / `compute org use <slug>` / `compute org current` (alias:
    `compute whoami`), backed by `GET`/`POST /api/v1/organizations` and
    `GET /api/v1/me` via `@benchsdk/cli` — mirrors `bench org`. The active org is
    stored per user and client on the platform, so `org use` applies everywhere
    the login is shared.
  - `--org <slug>` (root flag, or on any `sandboxes` / `actions` / `market`
    subcommand) and the `COMPUTE_ORG` env var send `X-Org-Slug` on requests.
    Precedence: `--org` > `COMPUTE_ORG` > the stored login's org. The platform
    ignores the header for org API keys.
  - `compute login` now prints the active org after authenticating:
    "Logged in as you@… — active org: acme (change with `compute org use <slug>`)".

  Requires `@benchsdk/cli@^0.7.1` (org/credentials helpers are exported there).

### Patch Changes

- a6c94b9: Remove the gateway `COMPUTESDK_API_KEY` entry from `compute providers` — the CLI no longer uses it for anything.

## 2.0.0

### Major Changes

- d05ef7c: Remove the legacy console auth and its commands. `compute create`,
  `compute sandbox`, `compute connect`, `compute workspace`, `compute run`, and
  the interactive REPL are gone — sandbox management lives under
  `compute sandboxes` (the platform `/api/v1/sandboxes` API).

  Auth now follows the Actions CLI: `compute login` / `compute logout` /
  `compute --login` / `compute --logout` run the platform OAuth device flow
  through `@benchsdk/cli` and share `~/.benchsdk/credentials.json` with
  `compute bench auth login` (which still works). The browser flow to
  console.computesdk.com and the `~/.computesdk/credentials.json` store were
  deleted — run `compute login` once after upgrading.

## 1.0.16

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10

## 1.0.15

### Patch Changes

- bc6f23e: `compute sandboxes` covers the new `/v1` surface: `spawn --stdin` keeps a job's stdin pipe open, `stdin`/`close-stdin` write and close it (`--data`, `--file`, or piped; `--base64` for binary), `snapshots`/`snapshot`/`snapshot-delete` wrap the snapshot CRUD, and `get`/`list`/`attach` now show the effective image and attach region.

## 1.0.14

### Patch Changes

- 9e17bee: `compute actions dispatch` gains `--max-bid <usd>` and `--max-bid-per <second|minute|hour>`: an optional per-dispatch market price ceiling sent as `maxPriceUsd`/`maxPricePer`. Jobs that can't be filled at the price fall through to the next provider-order entry.
- 5cfe41c: cli(market): refuse `market credential connect` to untrusted hosts — the credential field metadata a host returns selects which local env vars get read and posted back, so `--allow-untrusted-host` no longer extends to it (same guard as vault values)
- 68475a8: cli(market): `compute market replace <listing-id>` pauses a listing and evicts every live sale on it; `compute market replace --fill <fill-id>` evicts one sale. Evicted sales settle for seconds lived and an Actions job on the capacity re-places on the buyer's next provider. Replaced sales now show their state in `market book`.
- abdaf3e: `compute market` — the sell side of the compute market, for orgs the platform flags `market_provider` (same org API key as `compute actions`). Post listings with `market sell --price` (`--per` defaults to second), manage them with `listings`/`price`/`pause`/`resume`/`withdraw`, read the book with `market book`, payouts with `market settlements`, seller identity with `market status`, and connect the executor credential listings fill under with `market credential connect` (fields resolved from `<PROVIDER>_<FIELD>` env vars, e.g. `TENSORLAKE_API_KEY`).
- 0d238ab: `compute sandboxes` (`sbx`) — drive sandboxes through the platform's `/v1` API: create/list/get/destroy, `exec` one-shot commands, `spawn`/`ps`/`logs`/`wait`/`kill` detached daemon processes, `ls`/`cat`/`write`/`mkdir`/`rm` filesystem ops, and `url` port resolution.
- Updated dependencies [f1a8578]
  - computesdk@4.1.9

## 1.0.13

### Patch Changes

- 81c7153: Add `compute actions vault ls|set|get|rm` for the org vault (secrets and variables) over `/api/v1/vault`. `set` reads the value from stdin or `--from-file` and sends it exactly as read; `get` prints a variable or a secret created `--revealable`.

## 1.0.12

### Patch Changes

- 1718c06: Harden `compute actions`: structured JSON error envelope under `--json`, stored `compute bench auth login` platform credentials as an auth fallback (flag > env > stored), HTTPS required for non-loopback base URLs, and an explicit `--manual` dispatch option.

## 1.0.11

### Patch Changes

- c77a730: feat(cli): `compute actions inspect <run-id>` — run introspection

  Reads `GET /api/v1/actions/runs/{runId}/state` and prints the context that
  decided how the run behaved: each job's declared vs resolved `runs-on`
  labels and the runner image actually used, `container:` pins, cache keys
  saved/restored in the run window, the names (never values) of secrets
  bound, concurrency groups, timeout/fetch-depth overrides, and placement
  attempts with the winning provider:region. `--json` prints the raw
  inspection document.

- d52afb5: feat(cli): `compute actions summary` + inline failure digest in `compute actions run`

  Reads `GET /api/v1/actions/runs/{runId}/summary` and prints each failed job
  with its failed steps and a bounded, secret-redacted tail of the failing
  output — so debugging a red run does not mean paging the full log. `compute
actions run <id>` prints the same digest inline for failed runs when the
  deployment serves the summary route; `--json` carries it as `summary`.

  - computesdk@4.1.8

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
