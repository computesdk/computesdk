# @computesdk/cloud-run

## 0.1.12

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 0.1.11

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 0.1.10

### Patch Changes

- 0732fed: Add `execution: "persistent"` mode to the Archil provider: `create` provisions a
  persistent Archil sandbox VM (waited to `running`), `runCommand` uses the
  sandbox's interactive process API over a short-lived WebSocket connection
  (fresh connection URL per command), `getById` auto-resumes paused sandboxes,
  `destroy` deletes the sandbox, and `getUrl` resolves published endpoints.
  Default `execution: "exec"` behavior is unchanged.

  Also adds `ephemeral?: boolean` to the shared `CreateSandboxOptions` as the
  standard flag for providers with both ephemeral and persistent compute
  surfaces, and wires it through every dual-mode provider:

  - Archil: `ephemeral: true` -> exec-mode disk handle, `false` -> persistent VM.
  - Upstash: `ephemeral` -> `EphemeralBox`/`Box` (unchanged semantics, now typed).
  - Cloud Run: `ephemeral` overrides configured `executionMode` per sandbox
    (`true` -> `ephemeral`, `false` -> `stateful`).
  - Freestyle: `ephemeral` overrides configured `persistent` per sandbox
    (`true` -> deleted on stop, `false` -> kept).

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 0.1.9

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 0.1.8

### Patch Changes

- Updated dependencies [6ec91ff]
  - @computesdk/provider@2.1.5

## 0.1.7

### Patch Changes

- Updated dependencies [f3fe311]
  - computesdk@4.1.4
  - @computesdk/provider@2.1.4

## 0.1.6

### Patch Changes

- 028d47f: Add an explicit Cloud Run execution mode option with ephemeral `sandbox do` execution as the default and opt-in stateful `sandbox run`/`exec`/`delete` sessions.

## 0.1.5

### Patch Changes

- 1267b65: Configure the Cloud Run gateway setup command with benchmark-ready CPU, memory, concurrency, scaling, session affinity, and CPU boost settings.

## 0.1.4

### Patch Changes

- 90764f1: Use `sandbox do` for Cloud Run command execution instead of detached `run` sessions and `exec`.

## 0.1.3

### Patch Changes

- f2e71b2: Document that the remote Cloud Run gateway is intended to be publicly invokable and protected by the gateway secret.

## 0.1.2

### Patch Changes

- 96a248a: Use writable Cloud Run sandbox sessions in the gateway, fix bundled gateway resolution for setup, and add a credentialed smoke test.

## 0.1.1

### Patch Changes

- ec1be06: Add a Google Cloud Run Sandboxes provider and register it in the workbench provider list.

## 0.1.0

### Patch Changes

- Initial Cloud Run Sandboxes provider.
