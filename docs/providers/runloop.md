---
description: >-
  Set up the Runloop provider for ComputeSDK, configure your API key, and create
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

# Runloop

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/runloop/" %}

Runloop provider for ComputeSDK

## Installation & Setup

```bash
npm install @computesdk/runloop
```

Add your Runloop credentials to a `.env` file:

```bash
RUNLOOP_API_KEY=your_runloop_api_key
```

## Usage

```typescript
import { runloop } from '@computesdk/runloop';

const compute = runloop({
  apiKey: process.env.RUNLOOP_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Runloop!"');
console.log(result.stdout); // "Hello from Runloop!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface RunloopConfig {
  /** Runloop API key - if not provided, will use RUNLOOP_API_KEY env var */
  apiKey?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
}
```

## Standard sizes

`instances.create({ sizeClass: 'md' })` sets CPU, memory, and disk using Runloop's `CUSTOM_SIZE` launch parameters. The same fields are sent when creating a Devbox from a blueprint or disk snapshot.

| `sizeClass` | vCPU | Memory (MiB) | Disk (MiB) |
| --- | ---: | ---: | ---: |
| `sm` | 1 | 2048 | 4096 |
| `md` | 2 | 4096 | 8192 |
| `lg` | 4 | 8192 | 16384 |
| `xl` | 8 | 16384 | 16384 |
| `2xl` | 16 | 32768 | 16384 |

`xs` is unsupported because Runloop's `X_SMALL` preset has 0.5 vCPU and a custom 1-vCPU Devbox requires at least 2 GiB of RAM. `3xl` exceeds Runloop's custom limits of 16 vCPUs and 64 GiB of RAM. [Runloop sizing guide](https://docs.runloop.ai/docs/devboxes/configuration/sizes)

Omit `sizeClass` when supplying native `launch_parameters`.
