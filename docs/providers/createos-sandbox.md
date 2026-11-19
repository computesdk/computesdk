---
description: >-
  CreateOS provider for ComputeSDK — NodeOps VM sandboxes with pause/resume/fork
  snapshots. A thin adapter over the official @nodeops-createos/sandbox package.
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
tags:
  - tag: benchmarked
    primary: true
---

# CreateOS

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/createos/" %}

CreateOS provider for ComputeSDK — NodeOps VM sandboxes with pause/resume/fork snapshots. A thin adapter over the official `@nodeops-createos/sandbox` package.

## Lifecycle

`pause()`/`resume()` preserve memory and processes. Snapshots are separate paused VM forks, preserving the rootfs and memory. Capture briefly pauses a running source, makes a `start_paused` fork, then resumes the source; an already-paused source stays paused. The snapshot id differs from the source id. Restore with `snapshotId` and delete the paused fork when finished.

## Installation & Setup

```bash
npm install @computesdk/createos-sandbox
```

Add your CreateOS credentials to a `.env` file:

```bash
CREATEOS_SANDBOX_API_KEY=your_createos_api_key
# Optional: override the control-plane base URL (defaults to https://api.sb.createos.sh)
CREATEOS_SANDBOX_BASE_URL=https://api.sb.createos.sh
```

## Usage

```typescript
import { createosSandbox } from '@computesdk/createos-sandbox';

const compute = createosSandbox({
  apiKey: process.env.CREATEOS_SANDBOX_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from CreateOS!"');
console.log(result.stdout); // "Hello from CreateOS!"

// Clean up
await sandbox.destroy();
```

### Standard sizes

`sizeClass` picks a listed CreateOS shape (from the
[shape catalog](https://createos.sh/docs/Sandbox/Limits)). Each class boots the
smallest shape that meets its profile, with the overlay disk the benchmarks
platform uses for that class:

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'md' })
```

| `sizeClass` | Shape | vCPU / RAM | Disk |
| --- | --- | --- | --- |
| `xs` | `s-1vcpu-1gb` | 1 / 1 GiB | 10 GiB (shape default) |
| `sm` | `s-1vcpu-2gb` | 1 / 2 GiB | 10 GiB |
| `md` | `s-2vcpu-4gb` | 2 / 4 GiB | 20 GiB |
| `lg` | `s-4vcpu-8gb` | 4 / 8 GiB | 40 GiB |
| `xl` | `s-8vcpu-16gb` | 8 / 16 GiB | 60 GiB (plan maximum) |
| `2xl` | — | unsupported | |
| `3xl` | — | unsupported | |

`2xl` and `3xl` are unsupported: the largest listed shape (Enterprise) is
`s-8vcpu-16gb`. The `s-0.25vcpu-512mb` and `s-0.5vcpu-1gb` shapes run on a
fractional CPU quota and are never used for a standard size. Pass
`ephemeralDiskMb` to choose another disk size, within your plan's limit.

`sizeClass` cannot be combined with `shape`, `cpus` or `memoryMb` (conflict),
or with `snapshotId`: a fork keeps the paused source's shape, so sized snapshot
restores are rejected as unsupported. Plans cap which shapes you can boot; a
shape above your plan fails at create time.

### Configuration Options

```typescript
interface CreateosConfig {
  /** createos-sandbox API key. Falls back to the CREATEOS_SANDBOX_API_KEY env var. */
  apiKey?: string;
  /** Control-plane base URL. Falls back to the CREATEOS_SANDBOX_BASE_URL env var, then the production control plane. */
  baseUrl?: string;
  /** Default shape when create options pin neither `shape` nor cpus/memoryMb. */
  shape?: string;
  /** Default rootfs catalog name or template id. Empty = host default. */
  rootfs?: string;
  /** Reported `getInfo().timeout` in ms. Informational only. */
  timeout?: number;
}
```

### Supported Operations

| Method       | Supported | Notes                                                                                                                                           |
| ------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`     | ✅         | Sizes the VM from a fixed shape catalog; maps `cpus`/`memoryMb` onto the nearest shape. A `snapshotId` forks a paused sandbox into a fresh one. |
| `getById`    | ✅         | Returns `null` on a genuine 404; other errors propagate.                                                                                        |
| `list`       | ✅         | Lists up to 100 sandboxes.                                                                                                                      |
| `destroy`    | ✅         | Idempotent — a 404 is treated as already gone.                                                                                                  |
| `runCommand` | ✅         | Runs via `sh -c`; per-command `cwd`/`env`/`background` are synthesised into an inline script.                                                   |
| `getInfo`    | ✅         | Refreshes the handle from the control plane.                                                                                                    |
| `getUrl`     | ✅         | Returns a preview URL via `sandbox.previewUrl(port)` (defaults to `https`).                                                                     |
| `filesystem` | ✅         | `readFile`/`writeFile` use the native file upload/download API; other ops use shell commands.                                                   |
| `snapshot`   | ✅         | See notes below.                                                                                                                                |

### Snapshots

CreateOS snapshots are separate paused sandbox forks:

* `snapshot.create` briefly pauses a running source, creates a paused fork with its own id, then resumes the source. An already-paused source stays paused.
* `snapshot.list` returns all paused sandboxes.
* `snapshot.delete` destroys the paused sandbox.
* `create({ snapshotId })` forks the paused bundle into a fresh running sandbox.

### Notes

* Requires Node.js >= 22.
* `getInstance()` returns the native `@nodeops-createos/sandbox` handle for provider-specific disks, networks, and bandwidth controls. Pause/resume and snapshots are also exposed on the unified surface.
* `timeout` is informational only — it is reported by `getInfo()` but does not enforce an execution limit.
