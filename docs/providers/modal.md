---
description: >-
  Set up the Modal provider for ComputeSDK, configure your credentials, and
  create sandboxes to run commands with optional GPU support.
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

# Modal

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/modal/" %}

Modal provider for ComputeSDK - Execute code with GPU support for machine learning workloads.

## Lifecycle

Snapshots capture rootfs without memory and leave the source running. Restore with `snapshotId`; running processes do not continue from the captured image.

## Installation & Setup

```bash
npm install @computesdk/modal
```

Add your Modal credentials to a `.env` file:

```bash
MODAL_TOKEN_ID=your_modal_token_id
MODAL_TOKEN_SECRET=your_modal_token_secret
```

## Usage

```typescript
import { modal } from '@computesdk/modal';

const compute = modal({
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Modal!"');
console.log(result.stdout); // "Hello from Modal!"

// Clean up
await sandbox.destroy();
```

### Standard sizes

`sizeClass` requests an exact CPU/RAM shape. Modal's `cpu` counts physical
cores (1 core = 2 vCPUs), so each size sets half its vCPUs as cores, and sets
the request and the limit to the same value so the Sandbox does not burst past
the size:

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'md' });
```

| `sizeClass` | `cpu` / `cpuLimit` (cores) | `memoryMiB` / `memoryLimitMiB` |
| --- | ---: | ---: |
| `xs` | 0.5 | 1024 |
| `sm` | 0.5 | 2048 |
| `md` | 1 | 4096 |
| `lg` | 2 | 8192 |
| `xl` | 4 | 16384 |
| `2xl` | 8 | 32768 |
| `3xl` | 16 | 131072 |

Sandbox disk cannot be resized: the VM runtime's root filesystem is a fixed
512 GiB, reported as `resolved.diskMiB: 524288`. Sizes apply to the default
image, `templateId`, and `snapshotId` creates. `sizeClass` cannot be combined
with `cpu`, `cpuLimit`, `memory`, `memoryMiB`, or `memoryLimitMiB`, and a
`experimentalOptions.vm_sidecar_memory_reserve_mib` reserve is `unsupported`
because it boots the main VM below the size.

### Configuration Options

```typescript
interface ModalConfig {
  /** Modal token ID - if not provided, will use MODAL_TOKEN_ID env var */
  tokenId?: string;
  /** Modal token secret - if not provided, will use MODAL_TOKEN_SECRET env var */
  tokenSecret?: string;
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Modal environment (sandbox or main) */
  environment?: string;
  /** Ports to expose (unencrypted by default) */
  ports?: number[];
  /** Optional-daemond SSE port (defaults to 38989); false disables port exposure, not runtime selection */
  daemonSsePort?: number | false;
  /** Modal app name (default: 'computesdk-modal') */
  appName?: string;
}
```


Ports are exposed with unencrypted tunnels by default for maximum compatibility.

Streaming/processes use native hooks where implemented, otherwise the shell tier.
`processRuntime: 'daemond'` opts into the daemon fallback; `daemonSsePort` alone
does not enable it. See [process tiers](../reference/Instance.md#startprocesscommand-options).
