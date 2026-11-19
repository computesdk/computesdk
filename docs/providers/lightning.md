---
description: >-
  Lightning AI provider for ComputeSDK — create and manage Lightning AI cloud
  sandboxes: run shell commands, read/write files, and manage the sandbox
  lifecycle.
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

# Lightning

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/lightning/" %}

Lightning AI provider for ComputeSDK — create and manage [Lightning AI](https://lightning.ai/) cloud sandboxes: run shell commands, read/write files, and manage the sandbox lifecycle.

## Installation & Setup

```bash
npm install @computesdk/lightning
```

> The underlying `@lightningai/sdk` is published ESM-only and requires **Node.js 22+**. This package loads it via dynamic `import()`, so it works from both ESM and CommonJS projects.

Add your Lightning AI credentials to a `.env` file:

```bash
LIGHTNING_API_KEY=your_api_key_here
# Optional: override the Lightning Cloud base URL
LIGHTNING_CLOUD_URL=https://lightning.ai
```

`LIGHTNING_SANDBOX_API_KEY` is also accepted and takes precedence over `LIGHTNING_API_KEY`, matching the SDK.

## Usage

```typescript
import { lightning } from '@computesdk/lightning';

const compute = lightning({
  apiKey: process.env.LIGHTNING_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Lightning!"');
console.log(result.stdout); // "Hello from Lightning!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface LightningConfig {
  /** Lightning AI API key - falls back to LIGHTNING_SANDBOX_API_KEY, then LIGHTNING_API_KEY env vars. */
  apiKey?: string;
  /** Lightning Cloud base URL - falls back to LIGHTNING_CLOUD_URL, then production. */
  baseUrl?: string;
  /** Instance type for new sandboxes (e.g. "cpu-1", "cpu-2", ... "cpu-16"). Defaults to "cpu-1". */
  instanceType?: string;
  /** Curated runtime image for new sandboxes (e.g. "node24", "python313"). */
  runtime?: string;
  /** Whether new sandboxes persist filesystem state across stops via auto-snapshots. */
  persistent?: boolean;
  /** Request spot capacity for new sandboxes. */
  spot?: boolean;
  /** Ports to expose on new sandboxes when none are supplied per-create. */
  ports?: number[];
  /** Maximum sandbox lifetime in milliseconds before auto-stop. */
  timeout?: number;
}
```

### Supported Operations

| Method       | Supported | Notes                                                                                                               |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------- |
| `create`     | ✅         | Honors `instanceType` (per create or config), `runtime`, `ports`, `spot`, `persistent`, `timeout`, `sizeClass`; boot from a `snapshotId`. |
| `getById`    | ✅         | Reconnects by id.                                                                                                   |
| `list`       | ✅         |                                                                                                                     |
| `destroy`    | ✅         |                                                                                                                     |
| `runCommand` | ✅         | Supports `cwd`, `env`, `background`. Combined stdout/stderr surfaced on `stdout` (`stderr` left empty).             |
| `getInfo`    | ✅         |                                                                                                                     |
| `getUrl`     | ✅         | Returns the public HTTPS URL for a port; the port must be declared via `ports` at create time, otherwise it throws. |
| `filesystem` | ✅         | `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, `remove`.                                                    |
| `snapshot`   | ✅         | `compute.snapshot.create` / `list` / `delete`, and restore via `snapshotId` on create.                              |

## Standard sizes

`create({ sizeClass })` picks a Lightning CPU instance type (sent as `instanceType`, which overrides `config.instanceType`). Shapes are Lightning's [listed instance types](https://lightning.ai/docs/platform/build/sandbox#instance-types); RAM and disk are listed in GB and read as GiB. Default disk comes from the SDK's `storageGb` docs.

| `sizeClass` | Instance type | Resolved shape (vCPU / RAM / disk) |
| --- | --- | --- |
| `xs` | `cpu-1` | 1 / 1 GiB / ≈5 GB (not declared) |
| `sm` | — | `unsupported`: no 1-vCPU type with 2 GiB; `cpu-2` is `md` |
| `md` | `cpu-2` | 2 / 8 GiB / 10 GiB |
| `lg` | `cpu-4` | 4 / 16 GiB / 40 GiB |
| `xl` | `cpu-8` | 8 / 32 GiB / 60 GiB |
| `2xl` | `cpu-16` | 16 / 64 GiB / 80 GiB |
| `3xl` | — | `unsupported`: the largest type is `cpu-16` |

* `sizeClass` with a native `instanceType` (or any generic CPU/memory field) rejects with `InstanceSizeError('conflict')`.
* `storageGb` stays usable: it is forwarded and reported as `resolved.diskMiB`.
* Restoring with `snapshotId`/`templateId` keeps the mapped instance type.

### Notes

* **Node.js 22+** is required by the underlying `@lightningai/sdk`.
* **Combined output** — stdout and stderr are returned as a single combined stream on `result.stdout`.
* **Snapshots** — Lightning snapshots are unnamed, so `CreateSnapshotOptions.name` / `metadata` are accepted for parity but not persisted. `/tmp` and other platform defaults are excluded from snapshots — persist data under `$HOME` to survive a restore.
* **Credentials & concurrency** — the SDK stores auth in process-global state, so the provider serializes the brief credential switch between provider instances using _different_ API keys. Same-key operations run fully concurrently.
* Drop down to the native SDK sandbox via `sandbox.getInstance()`.
