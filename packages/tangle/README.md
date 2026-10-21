# @computesdk/tangle

[Tangle Sandbox](https://sandbox.tangle.tools) provider for ComputeSDK, using
the published `@tangle-network/sandbox` version pinned in `package.json`.

## Installation

Requires Node.js 20.19 or newer.

```bash
npm install computesdk @computesdk/tangle
```

Create an API key in the Tangle dashboard. Pass it as `apiKey`, or set
`TANGLE_API_KEY`. `TANGLE_SANDBOX_BASE_URL` optionally selects another deployment;
the default endpoint is `https://sandbox.tangle.tools`.

## Usage

```typescript
import { compute } from 'computesdk';
import { tangle } from '@computesdk/tangle';

compute.setConfig({ provider: tangle() });

const instance = await compute.instances.create();
try {
  const result = await instance.runCommand('echo "Hello from Tangle"');
  console.log(result.stdout);
} finally {
  await instance.destroy();
}
```

## Configuration

| Option | Meaning |
| --- | --- |
| `apiKey` | API key; falls back to `TANGLE_API_KEY` |
| `baseUrl` | API endpoint; falls back to `TANGLE_SANDBOX_BASE_URL` |
| `image` | Default Tangle environment identifier or OCI image reference |
| `cpu` | Requested CPU cores |
| `memory` | Requested memory, forwarded as the native SDK's `memoryMB` |
| `disk` | Requested disk, forwarded as the native SDK's `diskGB` |
| `timeout` | Maximum running lifetime in milliseconds |
| `createTimeout` | Create request budget in milliseconds; unset uses the SDK default |

Per-create `cpu`, `memory`, `disk`, `image` (or `templateId`), `timeout`,
`name`, `metadata` and `envs` override the corresponding defaults. An explicit
`idempotencyKey` is forwarded unchanged and derives a stable default sandbox name;
repeat requests must also keep their other options unchanged. Independent creates
receive fresh keys. `signal` cancels the create HTTP/2 stream.

Failed-create cleanup requires a native `PartialFailureError` that carries the
original allocation ID and this call's idempotency key, plus a create receipt
confirming `created` and `idempotencyKeyApplied: true`. For that exact allocation,
the provider requests retirement with one DELETE before rethrowing the original
creation error. Replayed, unknown and incomplete receipts never authorize deletion.
If retirement is not acknowledged, an `AggregateError` retains the creation and
cleanup errors, with the original creation error as its cause.

The adapter preserves allocation context when the create reply fails its safety checks. Recovery still
requires a real lifecycle qualification under production capacity authorization.
Pre-response ambiguity remains unresolved; a bounded list with no matches
cannot rule out a late allocation. This package does not promise automatic recovery
or safe replay of every create failure.

The provider does not convert memory or disk units, guess account limits, or
promise a particular isolation technology. The native SDK/API owns those properties.

## Operations and limitations

- `create` requests isolated owner context, disables agent/model provisioning,
  uses ephemeral storage, and explicitly requests open egress. One POST must return
  a running allocation, an isolated receipt with an empty `injectedSecrets` array,
  and a complete, ready filesystem incarnation. Otherwise creation fails closed.
  It does not poll readiness or retry the POST. The native handle retains normalized
  `connection` information for runtime consumers.
- `getById` returns `null` only for native not-found responses. `list` follows
  offset pagination.
- `runCommand` supports `cwd`, command-scoped `env`, and millisecond `timeout`
  in one blocking `/runtime/process/spawn` POST, without interpolating them into
  a shell string. Background mode uses one nonblocking spawn and acknowledges
  a native process ID; success means launch acceptance.
- `destroy` sends one DELETE. Success acknowledges retirement or an already absent
  allocation; physical teardown can finish later. Authentication and network
  errors remain errors. It does not issue lookup requests or retry deletion.
- `getInfo` refreshes native status. Its `timeout` is the reported expiry minus
  creation time, or zero when expiry is unknown.
- Filesystem helpers, preview URLs, template management, snapshot restore and
  persistent instances are not exposed. Unsupported operations fail clearly.
  Select a specific environment with `image` or `templateId`; `runtime` names are
  not translated.
- Live output callbacks and daemon-based processes are not qualified by this package.
  Use `getInstance()` for native SDK features beyond the ComputeSDK mapping.

## Transport

Create, command and delete requests are built by the adapter and sent directly over
four shared HTTP/2 sessions. Their buffered replies do not construct Fetch response
objects. The SDK module loads only for native access or typed failures. Native clients
and instance handles are constructed only for lookup, list, info or
`getInstance()` access. Completed buffered responses settle together on the next
event-loop turn so caller microtasks do not fragment multiplexed I/O. SDK error classes remain the public errors;
the adapter maintains the wire-error mapping and native-response normalization
against the SDK pin in `package.json`, whose private helpers are not exported.

Connections open when `tangle()` is called. Connection setup sends no HTTP request
or credentials. Sessions share no authentication state; each request carries its
caller's key. Idle sessions do not keep Node alive and close after inactivity.
A later request replaces closed or drained sessions. Request deadlines cover the
response body, and cancellation closes the stream. There are no redirects, HTTP/1.1
fallbacks, request replays, or workload-specific paths.

## Verification

`pnpm --filter @computesdk/tangle test:transport` exercises both transport forms
and the built provider over real
HTTP/2 sockets: request normalization, native access, receipt and readiness refusal,
owned-only cleanup, typed errors, malformed command replies, deadlines and aborts.

`pnpm --filter @computesdk/tangle test` exercises the public configuration boundary
without fake SDK responses. The native lifecycle test remains skipped unless the
existing `RUN_INTEGRATION=1` (or `true`) switch and `TANGLE_API_KEY` are both set.
That test creates a real sandbox and fails on cleanup errors. A skipped test is not
runtime qualification or benchmark evidence.

For the client-only control, build the package and its workspace dependencies,
then run `pnpm --filter @computesdk/tangle bench:client` with Node 24. It runs the
actual provider and native SDK against a local zero-delay HTTP/2 mock service in
a separate process, so server-side parsing does not block the client event loop.
There are 100 concurrent create + `runCommand('node -v')` calls, no warm-up or
handshake wait, and one destroy outside each sample's timer. JSON output includes
all samples, success count, request/session counts, CPU time, and
`W = 0.6*p50 + 0.25*p91 + 0.15*p95`. Here p91 and p95 are the 91st and 95th
fastest of 100; the board labels them p95 and p99 after trimming.
The control reports whether p50 <= 30 ms, p95 <= 55 ms and W <= 40 ms.
It fails on protocol or success-count errors, not host-dependent timing.
This mock supplies command output; it does not run a real sandbox or measure
production latency. `pnpm --filter @computesdk/tangle test:transport` checks real
local HTTP/2 sockets, aborts, interrupted responses and connection replacement.

Production benchmark execution
and publication use the maintained [ComputeSDK benchmarks](https://github.com/computesdk/benchmarks)
provider-onboarding route after package publication and maintainer credential setup.

To recompute a retained nine-pair ruler comparison, run
`pnpm --filter @computesdk/tangle bench:client --compare /absolute/result/directory`.
It validates arm order and installed artifact hashes from `manifest.json`, all raw
100/100 outcomes and mock counters, then writes `comparison.json` with all W values,
medians and R-7 quartiles. Client-only latency is not a production readiness claim.
