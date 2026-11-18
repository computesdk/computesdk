---
description: >-
  Railway provider for ComputeSDK — run commands in Railway Sandboxes, ephemeral
  compute environments backed by the Railway platform.
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

# Railway

Railway provider for ComputeSDK — run commands in [Railway Sandboxes](https://docs.railway.com/sandboxes), ephemeral compute environments backed by the Railway platform.

## Lifecycle

Snapshot capabilities declare rootfs-only capture (`memory: false`) with the source kept. Restore with `snapshotId`; running processes are not preserved.

## Installation & Setup

```bash
npm install @computesdk/railway
```

> **Requires Node.js >= 22** — the underlying `railway` SDK depends on Node 22 APIs (e.g. global `WebSocket`).

Add your Railway credentials to a `.env` file:

```bash
RAILWAY_API_TOKEN=your_token
RAILWAY_ENVIRONMENT_ID=your_environment_id
```

Create the token at [railway.com/account/tokens](https://railway.com/account/tokens); find the environment ID under your Railway project's environment settings.

## Usage

```typescript
import { railway } from '@computesdk/railway';

const compute = railway({
  token: process.env.RAILWAY_API_TOKEN,
  environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Railway!"');
console.log(result.stdout); // "Hello from Railway!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface RailwayConfig {
  /** Railway API token - falls back to the RAILWAY_API_TOKEN environment variable */
  token?: string;
  /** Railway environment ID - falls back to the RAILWAY_ENVIRONMENT_ID environment variable */
  environmentId?: string;
}
```

### Standard sizes

`sizeClass` requests an exact standard CPU/RAM size. The adapter sends it as Railway's
per-sandbox `resources` (`cpu` in vCPUs, `memoryGB` in decimal GB, so 4096 MiB is
`4.294967296`), on fresh creates and checkpoint restores (`snapshotId`) alike:

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'md' });
```

| `sizeClass` | `resources` |
| --- | --- |
| `xs` | `{ cpu: 1, memoryGB: 1.073741824 }` |
| `sm` | `{ cpu: 1, memoryGB: 2.147483648 }` |
| `md` | `{ cpu: 2, memoryGB: 4.294967296 }` |
| `lg` | `{ cpu: 4, memoryGB: 8.589934592 }` |
| `xl` | `{ cpu: 8, memoryGB: 17.179869184 }` |

`2xl` and `3xl` are `unsupported`: Railway's largest listed sandbox size is
24 vCPU / 24 GB (Pro; see [Sandbox size](https://docs.railway.com/sandboxes#sandbox-size)).
Plans cap the size per workspace (Hobby at 8 vCPU / 8 GB, Trial and Free at 2 vCPU / 2 GB),
and Railway rejects a create above the plan maximum instead of booting a smaller sandbox.
Do not combine `sizeClass` with native `resources`; that throws `InstanceSizeError` (`conflict`).

### Supported Operations

| Method       | Supported | Notes                                                                                                                                 |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `create`     | ✅         | Creates a Railway sandbox. Honors `envs`, `idleTimeoutMinutes`, `networkIsolation`, `resources`, and `sizeClass` create options.        |
| `getById`    | ✅         | Returns `null` when the sandbox is not found.                                                                                         |
| `list`       | ✅         | Connects to each listed sandbox; unreachable ones are dropped.                                                                        |
| `destroy`    | ✅         | Best-effort; ignores already-destroyed / unreachable sandboxes.                                                                       |
| `runCommand` | ✅         | Runs via Railway's `sandbox.exec`. A signal-terminated command reports exit code `-1`.                                                |
| `getInfo`    | ✅         |                                                                                                                                       |
| `getUrl`     | ❌         | Throws — Railway sandboxes cannot expose ports / public URLs. Use sandbox-to-sandbox networking within a Railway environment instead. |
| `filesystem` | ✅         | Implemented over the shell (`base64`, `ls -la`, `mkdir -p`, `rm -rf`, etc.).                                                          |

### Notes

* Railway has no dedicated filesystem or port-exposure API, so `getUrl` throws and filesystem operations are shell-backed.
