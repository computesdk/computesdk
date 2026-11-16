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
