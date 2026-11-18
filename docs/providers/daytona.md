---
description: >-
  Install and use the Daytona provider for ComputeSDK to create sandboxes and
  run commands in Daytona development workspaces.
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

# Daytona

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/daytona/" %}

Daytona provider for ComputeSDK - Execute code in Daytona development workspaces.

## Lifecycle

`pause()`/`resume()` perform a stop/start and do not preserve running processes or memory. Snapshots capture the rootfs without memory and keep the source. Restore with `snapshotId`; disk preservation is not process suspension.

## Installation & Setup

```bash
npm install @computesdk/daytona
```

Add your Daytona credentials to a `.env` file:

```bash
DAYTONA_API_KEY=your_daytona_api_key
```

## Usage

```typescript
import { daytona } from '@computesdk/daytona';

const compute = daytona({
  apiKey: process.env.DAYTONA_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Daytona!"');
console.log(result.stdout); // "Hello from Daytona!"

// Clean up
await sandbox.destroy();
```

### Standard sizes

`sizeClass` requests an exact CPU/RAM shape. Daytona takes per-sandbox
`resources` (vCPU, GiB RAM, GiB disk) on image-based creates, so each standard
size boots an image with exactly that shape:

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'md' })
```

| `sizeClass` | `resources` (cpu / memory / disk) |
| --- | --- |
| `xs` | 1 vCPU / 1 GiB / Daytona default disk |
| `sm` | 1 vCPU / 2 GiB / 10 GiB |
| `md` | 2 vCPU / 4 GiB / 20 GiB |
| `lg` | 4 vCPU / 8 GiB / 40 GiB |

`xl`, `2xl` and `3xl` are unsupported: Daytona limits a sandbox to 4 vCPU /
8 GiB RAM. Without an `image`, a sized create boots `node:22`; set `sizeImage`
in the provider config to change it. `sizeClass` cannot be combined with
`templateId`, `snapshotId` or `snapshot` (a snapshot fixes the resources), or
with native `cpu`, `memory`, `resources`, `disk` or `gpu`.

### Configuration Options

```typescript
interface DaytonaConfig {
  /** Daytona API key - if not provided, will use DAYTONA_API_KEY env var */
  apiKey?: string;
  /** Default runtime environment (e.g. 'node', 'python') */
  runtime?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Image booted for a `sizeClass` create without an `image`; defaults to `node:22` */
  sizeImage?: string;
}
```
