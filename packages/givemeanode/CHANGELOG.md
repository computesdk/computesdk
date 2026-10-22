# @computesdk/givemeanode

## 1.2.9

### Patch Changes

- Updated dependencies [cbabd5a]
- Updated dependencies [a3de4ae]
- Updated dependencies [2c5eb0c]
  - @computesdk/provider@2.1.16

## 1.2.8

### Patch Changes

- Updated dependencies [d7d8efc]
- Updated dependencies [1b639da]
  - computesdk@4.1.13
  - @computesdk/provider@2.1.15

## 1.2.7

### Patch Changes

- ef8770f: Docs: update examples to the canonical `compute.instances` API (`Instance*` type names, `instanceId`, `methods.instances`). `compute.sandbox` / `Sandbox*` / `methods.sandbox` remain working deprecated aliases.
- Updated dependencies [ef8770f]
  - @computesdk/provider@2.1.14
  - computesdk@4.1.12

## 1.2.6

### Patch Changes

- aadc200: Rename `compute.sandbox` to `compute.instances` and `Sandbox` to `Instance` across the SDK so the abstraction covers all compute forms (sandbox, VM, baremetal). `kind: 'sandbox' | 'vm' | 'baremetal'` is now a field on `CreateInstanceOptions`, `InstanceInfo`, and provider configs. `compute.sandbox`, `methods.sandbox`, `sandboxId`, and all `Sandbox*` type names remain as deprecated aliases so existing providers and callers keep working unchanged. CLI: `compute sandboxes` is now `compute instances` (`sandboxes`/`sbx` aliases preserved).
- Updated dependencies [aadc200]
  - computesdk@4.1.11
  - @computesdk/provider@2.1.13

## 1.2.5

### Patch Changes

- Updated dependencies [16074f4]
  - @computesdk/provider@2.1.12

## 1.2.4

### Patch Changes

- 7240d21: feat: sandbox egress router — `egress` option on `CreateSandboxOptions` plus a self-contained on-box MITM shim that terminates TLS for credentialed hosts and relays decrypted requests to an off-box credential injector; `sandbox.egress` reports `{ proxyUrl, caCertPath }` and `sandboxEgressEnvVars()` maps it to `HTTPS_PROXY`/`ALL_PROXY`/CA cert env vars
- Updated dependencies [7240d21]
  - computesdk@4.1.10
  - @computesdk/provider@2.1.11

## 1.2.3

### Patch Changes

- Updated dependencies [f1a8578]
  - @computesdk/provider@2.1.10
  - computesdk@4.1.9

## 1.2.2

### Patch Changes

- computesdk@4.1.8
- @computesdk/provider@2.1.9

## 1.2.1

### Patch Changes

- Updated dependencies [7e65fe7]
  - @computesdk/provider@2.1.8
  - computesdk@4.1.7

## 1.2.0

### Minor Changes

- d578e4d: One HTTP/2 session per provider on Node, opened when the provider is constructed (nothing is sent on it until the first operation; `warm: 'prime'` pays the fast-token prime up front as well), every request a stream on it. An idle session does not keep the process alive, and `GmnClient.close()` lets it go. A burst of 100 concurrent creates over `fetch` opened 100 TLS connections whose handshakes ran one after another on the one thread; over one session the same burst measured a 40 ms median time-to-interactive against 211 ms, from us-east-1. `fetch` stays the fallback where `node:http2` is missing or a session cannot be opened, and is selected by an injected `fetch`; `transport: 'fetch' | 'http2' | 'auto'` chooses explicitly.

  `fastToken` defaults to `absorb` again: the door has answered a `gmnt_` token from memory since the day `prime` became the default, and the prime itself is a workspace listing that crosses to the database (113 to 140 ms). Measured from us-east-1 at 100 concurrent creates over one session, 56 to 106 ms median time-to-interactive with no prime against 166 ms waiting on one. `warm: 'prime'` and `fastToken: 'prime'` keep the warm-up for callers who want it.

## 1.1.2

### Patch Changes

- Updated dependencies [0732fed]
  - computesdk@4.1.6
  - @computesdk/provider@2.1.7

## 1.1.1

### Patch Changes

- Updated dependencies [3914faa]
  - computesdk@4.1.5
  - @computesdk/provider@2.1.6

## 1.1.0

### Minor Changes

- 7ff592a: `fastToken` now defaults to `prime`: one cheap, single-flighted warm-up request per process, so even the first creates of a burst present the signed credential instead of each paying the authentication read. Pass `fastToken: 'absorb'` to keep the previous behaviour (no extra request; the first request pays the ordinary cost).

## 1.0.2

### Patch Changes

- 88e078e: Surface the API's error message instead of `[object Object]`.

  The door answers a refusal with `{"error": {"code", "message"}}`, but the
  client ran `String()` over that object, so every non-2xx response arrived
  with its explanation discarded. Since the check sits in the shared request
  path, this affected every operation: create, exec, fork, snapshot and
  prepare-image.

## 1.0.1

### Patch Changes

- d0d29df: Add givemeanode provider
- d0d29df: givemeanode: map `vcpus`/`cpus`/`resources.vcpus` onto named instance types, surface the door's 1 MiB stdout truncation on stderr, fall back to the service token when a signed credential is refused early, keep the request deadline over the response body, refuse a plaintext `baseUrl`, and treat `memory` as decimal MB.
