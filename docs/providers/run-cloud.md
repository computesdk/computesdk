---
description: >-
  Run Cloud provider for ComputeSDK - fast Firecracker microVM sandboxes with
  configurable resources, filesystem access, and snapshots.
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

# Run Cloud

[Run Cloud](https://run.cloud) provides fast Firecracker microVM sandboxes for AI agents, CI, and untrusted code execution.

## Installation & Setup

```bash
npm install computesdk @computesdk/run-cloud
```

Create an API key in the [Run Cloud dashboard](https://run.cloud), then export it:

```bash
export RUN_CLOUD_API_KEY=rc_live_your_key
```

`RUN_CLOUD_API_TOKEN` is supported as an alias. `RUN_CLOUD_API_URL` optionally targets a custom Run Cloud deployment.

## Usage

```typescript
import { compute } from 'computesdk';
import { runCloud } from '@computesdk/run-cloud';

compute.setConfig({
  provider: runCloud({
    apiKey: process.env.RUN_CLOUD_API_KEY,
    cpu: 2,
    memory: 4096,
    disk: 40,
  }),
});

const sandbox = await compute.sandbox.create({
  templateId: 'runcloud/agent-base',
  name: 'agent-task',
});

const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/result.txt', result.stdout);

const snapshot = await compute.snapshot.create(sandbox.sandboxId, {
  name: 'after-setup',
});

await sandbox.destroy();

const restored = await compute.sandbox.create({
  snapshotId: snapshot.id,
});
```

## Configuration Options

```typescript
interface RunCloudConfig {
  apiKey?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  image?: string;
  cpu?: number;
  memory?: number;
  disk?: number;
  idlePauseSeconds?: number;
  timeout?: number;
  region?: string;
  orgId?: string;
  commandTimeout?: number;
}
```

`cpu` accepts fractional vCPUs, `memory` uses MiB, and `disk` uses GiB. `timeout` and `commandTimeout` use milliseconds; `idlePauseSeconds` uses seconds.

Per-create `templateId` or `image`, `snapshotId`, `cpu`, `memory`, `disk`, `idlePauseSeconds`, `timeoutSeconds`, `region`, `name`, `orgId`, and `idempotencyKey` override provider defaults.

Sandbox-level environment variables are not yet persisted by Run Cloud. Pass command-scoped variables through `runCommand`:

```typescript
await sandbox.runCommand('echo "$MODEL"', {
  env: { MODEL: 'gpt-5' },
});
```

## Supported Operations

| Method | Supported | Notes |
|---|---|---|
| `create` | ✅ | Fresh image boot or snapshot restore with resource overrides. |
| `getById` | ✅ | Returns `null` for missing sandboxes. |
| `list` | ✅ | Lists running sandboxes. |
| `destroy` | ✅ | Idempotent when already deleted. |
| `runCommand` | ✅ | Supports cwd, env, timeout, and background mode. |
| `getInfo` | ✅ | Refreshes lifecycle and resource metadata. |
| `getUrl` | ❌ | Public per-port URLs are not available in the current Run Cloud SDK. |
| Filesystem | ✅ | Read, write, mkdir, list, exists, and remove. |
| Snapshots | ✅ | Create, list, delete, and restore. |

Use `sandbox.getInstance()` to access the official Run Cloud client and native sandbox record.

Streaming output callbacks depend on ComputeSDK's daemon transport, which requires a
public port URL. Command output is buffered until Run Cloud exposes that capability.
