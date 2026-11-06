---
description: >-
  Set up the E2B provider for ComputeSDK, configure your API key, and create
  sandboxes to run commands.
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

# E2B

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/e2b/" %}

E2B provider for ComputeSDK

## Sizes and lifecycle

`sizeClass` supports `sm`, `md`, `lg`, and `xl` through per-size team templates, not per-create CPU overrides. Run [Provider Setup](../../ADD-PROVIDER.md#provider-setup) for `e2b` first. The default names are `csdk-node22-1cpu-2gb`, `csdk-node22-2cpu-4gb`, `csdk-node22-4cpu-8gb`, and `csdk-node22-8cpu-16gb`; `sizeTemplates` config overrides tier names. Do not pass `templateId`, `snapshotId`, or `sandboxId` with `sizeClass`. Missing mapped templates fail at create time with setup guidance; see [Sandbox sizes](../reference/sizes.md).

`pause()`/`resume()` preserve memory and processes. Snapshots preserve memory and the rootfs; capture briefly pauses the source, then keeps it running. Restore with `instances.create({ snapshotId })`. Create-time `timeout` defaults to 300,000 ms (config or per-create options can override it); command timeouts are separate.

## Installation & Setup

```bash
npm install @computesdk/e2b
```

Add your E2B credentials to a `.env` file:

```bash
E2B_API_KEY=your_e2b_api_key
```

> **Note:** E2B API keys must start with `e2b_`. The provider throws an error if the key is in any other format.

## Usage

```typescript
import { e2b } from '@computesdk/e2b';

const compute = e2b({
  apiKey: process.env.E2B_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from E2B!"');
console.log(result.stdout); // "Hello from E2B!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface E2BConfig {
  /** E2B API key - if not provided, will use E2B_API_KEY env var */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```
