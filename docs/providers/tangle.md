---
description: >-
  Tangle Sandbox provider for ComputeSDK, with isolated ephemeral instances and
  native command execution.
layout:
  width: default
  title:
    visible: true
  description:
    visible: false
  tableOfContents:
    visible: true
  outline:
    visible: true
  pagination:
    visible: true
  metadata:
    visible: true
  tags:
    visible: true
  actions:
    visible: true
---

# Tangle Sandbox

[Tangle Sandbox](https://sandbox.tangle.tools) runs isolated ephemeral instances
through its published TypeScript SDK.

## Installation & Setup

Requires Node.js 20.19 or newer.

```bash
npm install computesdk @computesdk/tangle
```

Create a key in the Tangle dashboard and set `TANGLE_API_KEY`, or pass `apiKey`
directly. The default endpoint is `https://sandbox.tangle.tools`;
`TANGLE_SANDBOX_BASE_URL` selects another deployment.

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

`image` chooses a Tangle environment identifier or OCI reference. `cpu`,
`memory` and `disk` map directly to the SDK's `cpuCores`, `memoryMB` and
`diskGB` fields; account shape limits and unit interpretation come from Tangle.
`timeout` controls maximum running lifetime in milliseconds, while
`createTimeout` sets the create request budget.

Create options support `image` or `templateId`, resources, `name`, `metadata`,
`envs`, `timeout`, `signal` and `idempotencyKey`. Command options support
`cwd`, `env`, `timeout` and `background`.

Instances use isolated owner context, disable agent/model provisioning and request
open egress explicitly. No VM/container or concurrency guarantee is inferred.
Destroy sends one DELETE and accepts retirement acknowledgement or an already
absent allocation; physical teardown can finish later. Cleanup errors remain errors.
Failed-create cleanup requires an exact allocation/key and a native receipt
confirming a newly created allocation with its idempotency key applied.
Replayed, unknown or incomplete receipts do not authorize deletion. Cleanup
failure retains both the creation and cleanup errors.
The pinned SDK retains allocation context on readiness failure. Real lifecycle
and cleanup qualification still require production capacity authorization. See
the package README for recovery limits.

The SDK loads at module scope. Four HTTP/2 sessions per API origin carry mapped
operations. Import opens connections without sending requests or credentials;
idle connections do not keep Node alive. Configured endpoints must support HTTP/2.
Create retains the native handle's validated connection details. Direct runtime
routing and its server-side audit/activity validation are separate work.

Filesystem helpers, preview URLs, template management, snapshot restore and
persistent instances are not exposed. `runtime` names are not translated; use an
explicit environment instead. Native SDK features remain available through
`instance.getInstance()`. See the [package README](https://github.com/computesdk/computesdk/tree/main/packages/tangle)
for complete behavior and verification details.
