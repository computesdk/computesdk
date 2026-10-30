# @computesdk/miosa

## 1.2.6

### Patch Changes

- 946f4dc: Account-API filesystem calls (read/write/mkdir/readdir/remove) now replay 404s through a fresh sandbox's boot window instead of racing it. The control plane's `wait: true` create can still return before the VM finishes booting and `/sandboxes/:id/fs/*` answers 404 until the sandbox attaches; a 404 on a sandbox past the window still surfaces immediately as a genuine miss.
- 936ba64: Account-API fs 404s on a young sandbox now wait out the boot via exec's `wait` readiness hold plus a 10s post-attach grace, instead of replaying 404s for the whole window — a missing file on a fresh sandbox surfaces within ~10s rather than stalling for two minutes.
- 428423f: Snapshot calls on regionally-created sandboxes now fail with an actionable error naming the cause and remedy (snapshots are account-API only; recreate the sandbox with `runnerMode: false` or `MIOSA_RUNNER_MODE=0`) instead of a bare `404 NOT_FOUND` from `POST /sandboxes/:id/snapshots`.

## 1.2.5

### Patch Changes

- b1b52ea: Fix two sandbox-fidelity failures: novita `snapshot.create` now accepts (and drops) `name`/`metadata` instead of throwing — the API takes no label, so callers that always name snapshots no longer fail. Miosa filesystem ops (`readFile`, `writeFile`, `mkdir`, `readdir`, `remove`) now route to the regional runner's own `filesystem.*` routes for regionally-created sandboxes — the account API does not own those ids and answered 404.

## 1.2.4

### Patch Changes

- Updated dependencies [2bd2e7d]
- Updated dependencies [0a54571]
  - @computesdk/provider@2.1.20
  - computesdk@4.1.14

## 1.2.3

### Patch Changes

- 3b0030c: Bound the readiness poll's 404 tolerance to an attach window. waitForRunnerReady treated any 404 from the per-sandbox GET as "still launching" for the whole 180s budget, but a sandbox the runner never owned (created through the account API, then reattached via getById/list with an unrecorded origin) 404s forever — the poll stalled the command, then threw a plain error the wrong-endpoint fallback couldn't recognize, so every exec on such a handle failed instead of falling back to the account API. A 404 that outlives the 30s attach grace now rethrows, restoring the fallback. The fallback also only learns the "account" route once the account API answers a non-404: a regional sandbox still attaching 404s on the runner too, and caching the route on that signal alone would misroute the handle's later commands.

## 1.2.2

### Patch Changes

- e3f821f: Run runner execs over exec/stream instead of buffered exec, and wait for the sandbox to report ready first. The buffered request dies on the transport's 30s deadline no matter the command's own timeout, so installs and builds read as failures and the abandoned server-side exec then refuses destroy with SANDBOX_BUSY. Runner create also answers while the machine is still launching — an exec sent mid-launch parks in a server-side hold that drops the stream before the command runs — so exec now polls the sandbox's state until it is ready (a 404 while it comes up just means the record is not attached yet). Also retry a SANDBOX_BUSY destroy briefly: it is a refusal while a lifecycle op drains, not an attempted delete, so a bounded retry turns the drain window into a clean teardown instead of a leaked sandbox.

  Fold the exec stream's real wire shape: output frames arrive as flat {"text":"<chunk>"} objects (a merged stream — the {type,line} union in the SDK's declaration does not match the wire), and the terminal frame is any payload carrying an exit_code/exitCode rather than only type:"exit". Output and exit codes now reach the caller instead of reading as "stream ended without an exit event".

## 1.2.1

### Patch Changes

- Updated dependencies [f062b5d]
  - @computesdk/provider@2.1.19

## 1.2.0

### Minor Changes

- f81087c: Route sandbox create, exec and destroy through MIOSA's regional sandbox endpoint by default to cut client round-trip latency. A create falls back to the account API only when the regional endpoint provably refused it before provisioning anything, and is never sent a second time after a request that may have been delivered. Opt out with `runnerMode: false` or `MIOSA_RUNNER_MODE=0`.

  Add an opt-in `lazyCreate` option (`MIOSA_LAZY_CREATE=1`): `create()` returns without a network call and the first `runCommand()` creates the sandbox and runs the command in one request.

  Load the runner client from `@miosa/sdk/runner` when the installed SDK has that entry (falling back to the root entry), and leave the account API connection pool closed until a call first goes there while the regional endpoint is in use.

  Regional routing is on by default only against MIOSA's own account API: a provider with a custom `baseUrl` or `MIOSA_BASE_URL` stays on that control plane and never sends its key to the public regional endpoint, unless `runnerMode: true`, `MIOSA_RUNNER_MODE=1` or a `runnerBaseDomain` asks for it.

### Patch Changes

- Updated dependencies [ce95b5c]
  - @computesdk/provider@2.1.18

## 1.1.8

### Patch Changes

- 4930f49: fix(volumes): soak-2 — settle-wrap attach + create-time mounts, daytona ready-wait, microsandbox named(), miosa computer-only error

  - factory: `attachVolume` and `create({volumes})` run inside `withVolumeSettle` — re-attaching a volume right after `destroy()` raced the provider's async unmount (blaxel "already attached", tenki `SYNC_PENDING`); the settle window absorbs it for every provider at once.
  - daytona: `volume.create` returns a ready handle and `volume.delete` waits out `pending_create` — both operations reject the transitional state.
  - microsandbox: mount via `named()` — the backend rejects the `ensure-exists` inline-create option on sandbox create.
  - miosa: `attachVolume`/`detachVolume` throw a clear "volumes attach to computers, not sandboxes" error when the record carries no `computer_id`, instead of POSTing an id that always 404s.

- Updated dependencies [4930f49]
  - @computesdk/provider@2.1.17

## 1.1.7

### Patch Changes

- a3de4ae: Volume soak fixes: `withVolumeSettle` retries volume delete while the provider reports it still attached (sandbox.destroy() returns before the control plane unmounts); daytona volume get/delete resolve by id or name (`volume.get` is name-keyed); miosa create defaults size_bytes to 1 GiB (missing field 422s); sandbox0 create sends the explicit s0fs/RWO request.
- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 1.1.6

### Patch Changes

- 1b639da: Add a unified persistent-volume surface: `CreateInstanceOptions.volumes` (create-time mounts), `compute.volume.create/get/list/delete` with multi-provider routing, and `instance.attachVolume`/`detachVolume` where the provider exposes runtime attach. Provider plumbing maps the unified `VolumeMount[]` onto each native wire shape (daytona `volumes[]`, e2b `volumeMounts`, modal `volumes` map, vercel `mounts`, namespace `volumes[]` with `persistency_kind`, northflank `volumesToAttach`, sandbox0 claim `mounts`, tenki `CreateOptions.volumes`, novita `volumeMounts`, createos `disks` attachments, plus volume managers for blaxel, declaw, beam, microsandbox, miosa).
- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 1.1.5

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 1.1.4

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 1.1.3

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 1.1.2

### Patch Changes

- ec73f3b: Open the HTTP/2 pool when the module is imported, so a caller that constructs the provider inside its own timer does not pay the first connection's handshake on its first request. Sessions stay idle-unref'd, so a script that imports the provider still exits on its own, and `MIOSA_PRECONNECT=0` opts out. A provider constructed with an explicit `baseUrl` on a different origin releases the default pool if nothing used it, and `closeMiosaConnections()` also cancels a preconnect that is still starting up.

  The `node:http2` and `node:events` modules are now loaded once per process instead of being re-imported on every request, which removes a per-request module-loader cost that is noticeable under TypeScript loaders at high concurrency.

## 1.1.1

### Patch Changes

- 162daa0: Establish HTTP/2 sessions before a cold client dispatches its first request, so the first burst spreads across the pool instead of queueing on a single session, and size the default pool at 4 sessions.
- e328cec: Bound the HTTP/2 connect phase so an unreachable endpoint rejects within the connect timeout (default 10 s, `MIOSA_HTTP2_CONNECT_TIMEOUT_MS`) instead of waiting on the operating system, and clamp the override to Node's maximum timer delay.

## 1.1.0

### Minor Changes

- fce7442: Route create/exec/destroy through `@miosa/sdk`'s SOMA one-hop runner transport (`run-<region>.miosa.ai`) instead of the control plane, for callers that opt in explicitly via `runnerMode`/`MIOSA_RUNNER_MODE` (no API key carries a region yet, so there is no key-based eligibility). Every other operation - list, getById, getInfo, getUrl/expose, filesystem, snapshots - keeps using the existing control-plane transport unchanged. Not released until `@miosa/sdk` publishes a version containing `RunnerClient`.

### Patch Changes

- fce7442: Dispatch each request to the least-loaded ready HTTP/2 session, honoring that session's own advertised concurrent-stream limit, instead of rotating blindly across every ready session. A burst now spreads across sessions as they come online rather than piling onto whichever session connected first, and only waits when every ready session is already at its own stream cap.

## 1.0.10

### Patch Changes

- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 1.0.9

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 1.0.8

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 1.0.7

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 1.0.6

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 1.0.5

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 1.0.4

### Patch Changes

- e767260: Route MIOSA sandbox requests over ready HTTP/2 sessions, with a quorum-based cold-start gate. The provider now tracks connected sessions and dispatches only onto warm connections; on a cold pool it waits for the first session to connect and up to 250 ms for a quorum of 8, improving burst median TTI. The wait is bounded by a 1 second deadline and re-armed when the pool is fully recycled, preventing hangs and stale gates.

## 1.0.3

### Patch Changes

- d7a0e73: Implement snapshot deletion: resolve the owning sandbox from an in-process index populated by create/list, falling back to scanning the caller's sandboxes; idempotent on unknown or already-deleted snapshots

## 1.0.2

### Patch Changes

- 87c6f00: Map ComputeSDK resource hints (vcpus/memory) onto MIOSA size contracts

## 1.0.1

### Patch Changes

- 4db3c80: Add the MIOSA Firecracker microVM sandbox provider.
