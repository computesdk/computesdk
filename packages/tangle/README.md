# @computesdk/tangle

[Tangle Sandbox](https://sandbox.tangle.tools) provider for ComputeSDK, using
`@tangle-network/sandbox` 0.60.14.

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
receive fresh keys. `signal` is forwarded to the SDK's create request.

Creation failure recovery remains unqualified: the pinned SDK can allocate an
instance and then throw a readiness error without its allocation ID or create
receipt. A bounded list returning no matches cannot rule out a late allocation.
This provider does not promise automatic cleanup or safe replay of that failure;
the native SDK must preserve the allocation receipt before this path is qualified.

The provider does not convert memory or disk units, guess account limits, or
promise a particular isolation technology. The native SDK/API owns those properties.

## Operations and limitations

- `create` requests isolated owner context, disables agent/model provisioning,
  uses ephemeral storage, and explicitly requests open egress. It returns after
  the native SDK resolves creation.
- `getById` returns `null` only for native not-found responses. `list` follows
  offset pagination.
- `runCommand` supports `cwd`, command-scoped `env`, and millisecond `timeout`
  through native SDK options, without interpolating them into a shell string.
  Background mode acknowledges a native process ID; success means launch acceptance.
- `destroy` requests removal and verifies absence through the API. An authentication,
  network, or cleanup failure is surfaced rather than swallowed.
- `getInfo` refreshes native status. Its `timeout` is the reported expiry minus
  creation time, or zero when expiry is unknown.
- Filesystem helpers, preview URLs, template management, snapshot restore and
  persistent instances are not exposed. Unsupported operations fail clearly.
  Select a specific environment with `image` or `templateId`; `runtime` names are
  not translated.
- Live output callbacks and daemon-based processes are not qualified by this package.
  Use `getInstance()` for native SDK features beyond the ComputeSDK mapping.

## Verification

`pnpm --filter @computesdk/tangle test` exercises the public configuration boundary
without fake SDK responses. The native lifecycle test remains skipped unless the
existing `RUN_INTEGRATION=1` (or `true`) switch and `TANGLE_API_KEY` are both set.
That test creates a real sandbox and fails on cleanup errors. A skipped test is not
runtime qualification or benchmark evidence.

The package itself supplies no startup or performance results. Benchmark execution
and publication use the maintained [ComputeSDK benchmarks](https://github.com/computesdk/benchmarks)
provider-onboarding route after package publication and maintainer credential setup.
