---
description: >-
  Install and use the CodeSandbox provider for ComputeSDK to create sandboxes
  and run commands in CodeSandbox environments.
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

# CodeSandbox

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/codesandbox/" %}

CodeSandbox provider for ComputeSDK - Execute code in CodeSandbox development environments.

## Lifecycle

`pause()`/`resume()` preserve memory and processes. Snapshot capabilities declare `scope: 'rootfs'`, `memory: true`, `source: 'kept'`, `fork: true`, and `readiness: 'immediate'`. A snapshot can restore into multiple independent instances using `snapshotId`; capture keeps the source running. See [snapshot cleanup](../reference/compute.md#restore-and-fork).

## Standard sizes

`sizeClass` boots a native CodeSandbox VM tier (`vmTier`). Each standard size maps to the smallest tier that meets its vCPU and RAM:

| `sizeClass` | VM tier | Listed shape |
| --- | --- | --- |
| `sm` | Pico | 1 vCPU / 2 GiB |
| `md` | Nano | 2 vCPU / 4 GiB |
| `lg` | Micro | 4 vCPU / 8 GiB |
| `xl` | Small | 8 vCPU / 16 GiB |
| `2xl` | Medium | 16 vCPU / 32 GiB, size template `csdk@csdk-node22-16cpu-32gb` |
| `3xl` | XLarge | 64 vCPU / 128 GiB, size template `csdk@csdk-node22-64cpu-128gb` |

`xs` is `unsupported`: Pico is the smallest tier. For `3xl`, `sizing.resolved` reports XLarge's 64 vCPU. Large (32 vCPU / 64 GiB) maps to no class because its RAM is below `3xl`.

CodeSandbox applies a tier above Small to the core count only unless the sandbox forks a template built at that tier, so `2xl` and `3xl` boot a size template. Build them once per workspace, then override the names with `sizeTemplates` if yours differ:

```bash
npx @codesandbox/sdk build ./template --vm-tier Medium --alias csdk@csdk-node22-16cpu-32gb
npx @codesandbox/sdk build ./template --vm-tier XLarge --alias csdk@csdk-node22-64cpu-128gb
```

`sm`–`xl` also apply to forks of your own `templateId` or a `snapshotId` restore; CodeSandbox does not downsize below the tier a template was built at. `2xl`/`3xl` cannot be combined with `templateId` or `snapshotId`. `sizeClass` cannot be combined with a native `vmTier`. Storage is set by the CodeSandbox subscription, not the tier. See [Sandbox sizes](../reference/sizes.md).

## Installation & Setup

```bash
npm install @computesdk/codesandbox
```

Add your CodeSandbox credentials to a `.env` file:

```bash
CSB_API_KEY=your_codesandbox_api_key
```

## Usage

```typescript
import { codesandbox } from '@computesdk/codesandbox';

const compute = codesandbox({
  apiKey: process.env.CSB_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from CodeSandbox!"');
console.log(result.stdout); // "Hello from CodeSandbox!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface CodesandboxConfig {
  /** CodeSandbox API key - if not provided, will fallback to CSB_API_KEY environment variable */
  apiKey?: string;
  /** Template to use for new sandboxes */
  templateId?: string;
  /** Default runtime environment, e.g. 'node', 'python' */
  runtime?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Template id or `namespace@alias` per standard size (2xl, 3xl) */
  sizeTemplates?: Partial<Record<InstanceSizeClass, string>>;
}
```
