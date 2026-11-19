---
description: >-
  Use Blaxel with ComputeSDK to create sandboxes with API key and workspace
  authentication, and configure image, region, memory, and exposed ports.
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

# Blaxel

Blaxel provider for ComputeSDK

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/blaxel/" %}

## Lifecycle

Snapshots declare whole-rootfs and memory preservation with the source kept. Restore with `snapshotId`; see [snapshot semantics and cleanup](../reference/compute.md#snapshot-capabilities).

## Standard sizes

`create({ sizeClass })` sets Blaxel's `memory` (MB). Blaxel has no CPU field: the [API reference](https://docs.blaxel.ai/api-reference/compute/create-sandbox) allocates CPU cores = memory / 2048.

| `sizeClass` | Status | Blaxel `memory` | Resolved shape |
| --- | --- | ---: | --- |
| `xs` | `supported` | 2048 MB (1 core / 2048 MiB) | vCPU picks the size: 1024 MB would get 0.5 core, so `xs` takes the first 1-core shape and records the extra RAM. |
| `sm` | supported | 2048 | 1 vCPU / 2048 MiB |
| `md` | supported | 4096 | 2 vCPU / 4096 MiB |
| `lg` | supported | 8192 | 4 vCPU / 8192 MiB |
| `xl`, `2xl`, `3xl` | `unknown` | — | Blaxel's docs disagree on CPU from 16 GB up (API reference: 8 cores at 16 GB; [Sandboxes overview](https://docs.blaxel.ai/Sandboxes/Overview) and troubleshooting: 6 cores), so these are not mapped. |

`sizeClass` overrides the configured `memory` default. It cannot be combined with a native `memory` option (`conflict`), or with `snapshotId` or `sandboxId` (`unsupported`: a fork or an existing sandbox keeps its own memory). `templateId` and `image` still work. The rootfs is an in-memory overlay sized from memory, so no disk is set.

## Installation & Setup

```bash
npm install @computesdk/blaxel
```

Add your Blaxel credentials to a `.env` file:

```bash
BL_API_KEY=your_blaxel_api_key
BL_WORKSPACE=your_blaxel_workspace
```

## Usage

```typescript
import { blaxel } from '@computesdk/blaxel';

const compute = blaxel({
  apiKey: process.env.BL_API_KEY,
  workspace: process.env.BL_WORKSPACE,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Blaxel!"');
console.log(result.stdout); // "Hello from Blaxel!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface BlaxelConfig {
  /** Blaxel API key - if not provided, will use BL_API_KEY env var */
  apiKey?: string;
  /** Blaxel workspace ID - if not provided, will use BL_WORKSPACE env var */
  workspace?: string;
  /** Default image for sandboxes */
  image?: string;
  /** Default region for sandbox deployment */
  region?: string;
  /** Default memory allocation in MB */
  memory?: number;
  /** Default ports to expose on the sandbox */
  ports?: number[];
}
```

### Default Images

The provider automatically selects images based on the runtime specified at creation time:

* **Python:** `blaxel/py-app:latest`
* **Node.js:** `blaxel/ts-app:latest`
* **Default:** `blaxel/base-image:latest`
