---
description: >-
  Leap0 provider for ComputeSDK - enterprise-grade cloud sandboxes for AI agents
  with full filesystem, git, process, and desktop support.
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

# Leap0

[Leap0](https://leap0.dev) provider for ComputeSDK - enterprise-grade cloud sandboxes for AI agents with full filesystem, git, process, and desktop support.

## Installation & Setup

```bash
npm install @computesdk/leap0
```

Add your Leap0 API key to a `.env` file:

```bash
LEAP0_API_KEY=your_leap0_api_key
```

Get your API key at [app.leap0.dev](https://app.leap0.dev/login).

## Usage

```typescript
import { leap0 } from '@computesdk/leap0';

const compute = leap0({
  apiKey: process.env.LEAP0_API_KEY,
  template: 'system/debian:bookworm',
});

// Create sandbox (uses the default template from config)
const sandbox = await compute.instances.create();

// Or override the template at create time via templateId
const sandbox2 = await compute.instances.create({
  templateId: 'system/code-interpreter:v0.1.0',
});

// Run a command
const result = await sandbox.runCommand('echo "Hello from Leap0!"');
console.log(result.stdout); // "Hello from Leap0!"

// Work with files
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
const content = await sandbox.filesystem.readFile('/tmp/hello.py');

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface Leap0Config {
  /** Leap0 API key - if not provided, will use LEAP0_API_KEY env var */
  apiKey?: string;
  /** Base URL for the Leap0 API (default: https://api.leap0.dev) */
  baseUrl?: string;
  /** Sandbox domain for URL generation (default: sandbox.leap0.dev) */
  sandboxDomain?: string;
  /** Client timeout in seconds */
  timeout?: number;
  /** Default template name to use when creating sandboxes (e.g. 'system/debian:bookworm') */
  template?: string;
}
```

## Standard sizes

`sizeClass` maps to Leap0's native `vcpu` / `memory` (MiB) create fields. Leap0 allows 1–8 vCPU and 512–8192 MiB memory per sandbox, with a fixed 10 GiB disk ([limits](https://leap0.dev/docs/limits)).

| `sizeClass` | Leap0 request | Resolved shape | Status |
| --- | --- | --- | --- |
| `xs` | `vcpu: 1`, `memory: 1024` | 1 vCPU / 1024 MiB / 10240 MiB disk | supported |
| `sm` | `vcpu: 1`, `memory: 2048` | 1 vCPU / 2048 MiB / 10240 MiB disk | supported |
| `md` | `vcpu: 2`, `memory: 4096` | 2 vCPU / 4096 MiB / 10240 MiB disk | supported |
| `lg` | `vcpu: 4`, `memory: 8192` | 4 vCPU / 8192 MiB / 10240 MiB disk | supported |
| `xl`, `2xl`, `3xl` | — | — | `unsupported`: above the 8 vCPU / 8192 MiB limit |

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'md', templateId: 'system/debian:bookworm' });
console.log(sandbox.sizing?.resolved); // { vcpus: 2, memoryMiB: 4096, diskMiB: 10240 }
```

`sizeClass` works with `templateId` and the configured `template`. With `snapshotId` it is `unsupported`, because a Leap0 restore takes its compute settings from the snapshot. Combining `sizeClass` with native `vcpu` or `memory` throws `InstanceSizeError` with code `conflict`.
