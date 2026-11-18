---
description: >-
  Set up the Upstash provider for ComputeSDK, configure your API key, and create
  default or ephemeral boxes to run commands.
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

# Upstash

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/upstash/" %}

Upstash provider for ComputeSDK

## Lifecycle

Create a persistent Box with `{ ephemeral: false }` to use `pause()`/`resume()`. These preserve the filesystem, not memory or running processes. Snapshot capabilities likewise declare rootfs-only capture with the source kept. EphemeralBox is not a pausable persistent Box.

## Installation & Setup

```bash
npm install @computesdk/upstash
```

Add your Upstash credentials to a `.env` file:

```bash
UPSTASH_BOX_API_KEY=your_upstash_box_api_key
```

## Usage

```typescript
import { upstash } from '@computesdk/upstash';

const compute = upstash({
  apiKey: process.env.UPSTASH_BOX_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Upstash!"');
console.log(result.stdout); // "Hello from Upstash!"

// Clean up
await sandbox.destroy();
```

## Standard sizes

`sizeClass` picks an Upstash Box `size` tier. It works on every create path (new box, snapshot restore, ephemeral box and ephemeral restore):

| `sizeClass` | Box `size` | Listed shape (vCPU / RAM / disk) |
| --- | --- | --- |
| `md` | `small` | 2 / 4 GB / 10 GB |
| `lg` | `medium` | 4 / 8 GB / 30 GB |
| `xl` | `large` | 8 / 16 GB / 30 GB |

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'lg' }); // Box size 'medium'
console.log(sandbox.sizing?.resolved); // { vcpus: 4, memoryMiB: 8192, diskMiB: 30720 }
```

`xs` and `sm` are `unsupported` (the smallest Box is 2 vCPU / 4 GB), and so are `2xl` and `3xl` (the largest Box is 8 vCPU / 16 GB). Disk is fixed by the tier and cannot be chosen. Do not combine `sizeClass` with the native `size` option; that is a `conflict`. Without `sizeClass`, Upstash boots its default `small` Box. See [Sandbox sizes](../reference/sizes.md).

## Box Types

Upstash supports two box variants:

* **Default Box** — Full sandbox with filesystem, shell, snapshots, and preview URLs. Best for persistent or long-running work.
* **Ephemeral Box** _(optional)_ — Lightweight, instant-ready box with code execution and filesystem only. No preview URLs. Best for short-lived, one-off tasks.

For more details, see the [Upstash Box documentation](https://upstash.com/docs/box/overall/quickstart).

```typescript
// Default box
const sandbox = await compute.instances.create();

// Ephemeral box
const sandbox = await compute.instances.create({ ephemeral: true });
```

### Configuration Options

```typescript
interface UpstashConfig {
  /** Upstash Box API key - if not provided, will use UPSTASH_BOX_API_KEY env var */
  apiKey?: string;
  /** Default runtime environment (e.g. 'node', 'python') */
  runtime?: string;
  /** Execution timeout in milliseconds (default: 600000) */
  timeout?: number;
}
```
