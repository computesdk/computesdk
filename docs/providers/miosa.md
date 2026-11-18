---
description: >-
  MIOSA provides hardware-isolated Firecracker microVM sandboxes with fast
  snapshot-backed startup, native filesystem APIs, preview URLs, and checkpoints.
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

# MIOSA

[MIOSA](https://miosa.ai) provides hardware-isolated Firecracker microVM sandboxes through the ComputeSDK interface.

The default sandbox uses 2 vCPU, 4 GiB of memory, and 10 GiB of copy-on-write disk.

## Lifecycle

Pause/resume and snapshots require a Firecracker source (`createOptions: { runtime: 'firecracker' }`). Both preserve memory and processes; snapshots keep the whole rootfs and leave the source running.

Snapshot operations use the account API, not regionally-created sandboxes. Create the source through the account endpoint for snapshots. Use `provider.snapshot.list({ sandboxId })`; unscoped listing rejects. Deletion resolves the owner from snapshots created/listed in the client or a bounded account scan, then deletes within that sandbox's scope.

## Installation & Setup

```bash
npm install computesdk @computesdk/miosa
```

Create an API key in MIOSA and add it to your environment:

```bash
MIOSA_API_KEY=msk_your_api_key
```

## Usage

```typescript
import { miosa } from '@computesdk/miosa';

const compute = miosa({
  apiKey: process.env.MIOSA_API_KEY,
});

const sandbox = await compute.instances.create();
const result = await sandbox.runCommand('node -v');
console.log(result.stdout);
await sandbox.destroy();
```

### Configuration Options

```typescript
interface MiosaConfig {
  /** MIOSA API key. Falls back to `MIOSA_API_KEY`. */
  apiKey?: string;
  /** API base URL for MIOSA or a white-label control plane. */
  baseUrl?: string;
  /** Default sandbox lifetime in milliseconds. */
  timeout?: number;
}
```

### Supported Operations

| Method | Supported | Notes |
|---|---|---|
| `create` | Yes | Creates a command-ready Firecracker microVM and accepts templates, snapshots, environment variables, metadata, and timeouts. |
| `getById` | Yes | Returns `null` when the sandbox does not exist. |
| `list` | Yes | Lists the caller's sandboxes. |
| `destroy` | Yes | Idempotent when the sandbox is already absent. |
| `runCommand` | Yes | Supports working directory, environment, timeout, and background execution. |
| `getInfo` | Yes | Maps MIOSA lifecycle state to the ComputeSDK status model. |
| `getUrl` | Yes | Creates a tenant-aware public preview URL for a port. |
| `filesystem` | Yes | Native read, write, directory, list, existence, and remove operations. |
| `snapshot` | Yes | Account-API Firecracker checkpoints: create, sandbox-scoped list, and delete with owner resolution. Regional sandboxes are not snapshot-capable. |

### Standard sizes

`sizeClass` picks one of MIOSA's named sandbox sizes and sends it as `size`. Each size fixes CPU, memory and disk together, so the disk is reported in `resolved.diskMiB`.

| Size class | MIOSA `size` | Resolved shape |
|---|---|---|
| `xs` | — | Unsupported: the smallest MIOSA size is `xs` (1 vCPU / 2 GiB) |
| `sm` | `xs` | 1 vCPU / 2 GiB / 10 GiB disk |
| `md` | `small` | 2 vCPU / 4 GiB / 10 GiB disk |
| `lg` | `medium` | 4 vCPU / 8 GiB / 20 GiB disk |
| `xl` | `large` | 8 vCPU / 16 GiB / 40 GiB disk |
| `2xl` | `xl` | 16 vCPU / 32 GiB / 80 GiB disk |
| `3xl` | — | Unsupported: the largest MIOSA size is `xl` (16 vCPU / 32 GiB) |

```typescript
const sandbox = await compute.sandbox.create({ sizeClass: 'lg' }); // size: "medium"
```

- `sizeClass` cannot be combined with `size`, `cpu_count`/`cpuCount`, `memory_mb`, any disk field, or the generic `vcpus`/`cpus`/`memory` hints; the call fails with a `conflict` error.
- `sizeClass` with `snapshotId` is refused: a restore keeps the source sandbox's resources.
- With a `templateId`, MIOSA's template catalog decides which sizes that template supports.
- Sizes above `xs` are always created through the account API; the regional endpoint serves `xs` only.
- Your plan caps the largest size you can select.

### Runtime Model

MIOSA serves the default create path from certified snapshot-derived warm slots, immutable shared base images, per-sandbox copy-on-write disks, and preallocated network capacity.

When warm capacity is unavailable, the snapshot restore path supports `userfaultfd` lazy paging and fails closed if the requested runtime contract cannot be proven.

The same API supports custom domains, persistent graduation, and off-host recovery outside the portable ComputeSDK surface.
