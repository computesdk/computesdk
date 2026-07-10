---
tags:
  - tag: benchmarked
    primary: true
---

# CreateOS

CreateOS provider for ComputeSDK — NodeOps VM sandboxes with pause/resume/fork snapshots. A thin adapter over the official `@nodeops-createos/sandbox` package.

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
const sandbox = await compute.sandbox.create();

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

CreateOS has no decoupled snapshot object — **pausing IS the snapshot**, and the paused sandbox id is the snapshot id:

* `snapshot.create` pauses the sandbox (the source VM stops) and returns the sandbox id as the snapshot id.
* `snapshot.list` returns all paused sandboxes.
* `snapshot.delete` destroys the paused sandbox.
* `create({ snapshotId })` forks the paused bundle into a fresh running sandbox.

### Notes

* Requires Node.js >= 22.
* `getInstance()` returns the bare native `@nodeops-createos/sandbox` handle, exposing the full stateful API (pause / resume / fork / disks / networks / bandwidth) that ComputeSDK's core surface does not model.
* `timeout` is informational only — it is reported by `getInfo()` but does not enforce an execution limit.
