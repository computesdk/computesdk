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

const sandbox = await compute.sandbox.create();
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
| `snapshot` | Partial | Creates and lists Firecracker checkpoints. ComputeSDK does not currently pass the sandbox scope required for deletion. |

### Runtime Model

MIOSA serves the default create path from certified snapshot-derived warm slots, immutable shared base images, per-sandbox copy-on-write disks, and preallocated network capacity.

When warm capacity is unavailable, the snapshot restore path supports `userfaultfd` lazy paging and fails closed if the requested runtime contract cannot be proven.

The same API supports custom domains, persistent graduation, and off-host recovery outside the portable ComputeSDK surface.
