---
description: >-
  Set up the Novita provider for ComputeSDK, configure your API key, and create
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
---

# Novita

Novita Sandbox provider for ComputeSDK, using the official `novita-sandbox` SDK.

## Standard sizes

CPU/RAM are fixed when a Novita template is built, so each standard `sizeClass` boots its own account template (node:22):

```typescript
const sandbox = await compute.instances.create({ sizeClass: 'md' });
```

| `sizeClass` | Template | Shape |
| --- | --- | --- |
| `xs` | `csdk-node22-1cpu-1gb` | 1 vCPU / 1024 MiB / 20480 MiB disk |
| `sm` | `csdk-node22-1cpu-2gb` | 1 vCPU / 2048 MiB / 20480 MiB disk |
| `md` | `csdk-node22-2cpu-4gb` | 2 vCPU / 4096 MiB / 20480 MiB disk |
| `lg` | `csdk-node22-4cpu-8gb` | 4 vCPU / 8192 MiB / 20480 MiB disk |

`xl`, `2xl` and `3xl` are `unsupported`: Novita caps a sandbox at 8 vCPU and 8 GiB of memory on the Free, Paid and (default) Enterprise tiers ([Quota Limits](https://novita.ai/docs/guides/sandbox-quota-limit)). The 20 GB disk is fixed per sandbox and reported in `resolved.diskMiB`.

[Provider Setup](../../ADD-PROVIDER.md#provider-setup) builds the size templates; a mapped template missing on the account fails at create time with setup guidance. Override the names with `sizeTemplates` in the provider config (only `xs`–`lg` are honored; an empty name is `unconfigured`). `sizeClass` cannot be combined with `templateId`, `snapshotId` or `sandboxId` (`unsupported`), or with native `cpuCount`, `memoryMB` or `build` (`conflict`). See [Sandbox sizes](../reference/sizes.md).

## Lifecycle

`pause()`/`resume()` preserve memory and processes; resume re-arms the sandbox's configured lifetime. Snapshot capabilities declare rootfs/memory preservation and the source kept. Snapshot names and metadata are accepted but ignored.

## Installation & Setup

```bash
npm install @computesdk/novita
```

Requires Node.js 20 or later.

Set your Novita API key in the environment:

```bash
export NOVITA_API_KEY=your_novita_api_key
```

You can also add `NOVITA_API_KEY` to a `.env` file if your application loads it.
This is the only environment variable required to configure the provider.

## Usage

```typescript
import { novita } from '@computesdk/novita';

const compute = novita({
  apiKey: process.env.NOVITA_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

try {
  // Run a command
  const result = await sandbox.runCommand('echo "Hello from Novita!"');
  console.log(result.stdout); // "Hello from Novita!"
} finally {
  // Clean up
  await sandbox.destroy();
}
```

### Configuration Options

```typescript
interface NovitaConfig {
  /** Novita API key - if not provided, will use NOVITA_API_KEY env var */
  apiKey?: string;
  /** Default sandbox lifetime in milliseconds (default: 300000) */
  timeout?: number;
  /** Template to boot per standard `sizeClass` (xs–lg); defaults to NOVITA_SIZE_TEMPLATES */
  sizeTemplates?: Partial<Record<InstanceSizeClass, string>>;
}
```

The provider reads `NOVITA_API_KEY` when `apiKey` is omitted. Set
`compute.instances.create({ timeout: 600_000 })` to override the default lifetime
for a sandbox. A command's `runCommand(..., { timeout })` is a separate deadline.

Create from a template with `templateId` or restore a snapshot with `snapshotId`.
These options are mutually exclusive; omitting both uses Novita's `base` template.
Creation also supports `envs`, `metadata`, `secure`, `allowInternetAccess`,
`network`, and `lifecycle`.

## Supported Operations

| Method | Notes |
| --- | --- |
| `compute.instances.create()` | Creates a sandbox from a template or snapshot. |
| `compute.instances.getById(id)` | Connects to a sandbox; returns `null` when it is not found. Connecting may resume a paused sandbox. |
| `compute.instances.list()` | Fetches all pages of running sandboxes and connects to each. Connections may extend sandbox lifetime. |
| `sandbox.destroy()` | Deletes the sandbox; succeeds if it is already gone. |
| `sandbox.runCommand()` | Supports `cwd`, `env`, `timeout`, background execution, and native `onStdout` / `onStderr` streaming. |
| `sandbox.getInfo()` | Reads current sandbox information from Novita. |
| `sandbox.getUrl({ port })` | Returns an HTTPS service URL by default. Service access may require a traffic token. |
| `sandbox.filesystem` | Supports `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, and `remove`. |
| `compute.snapshot` | Supports `create`, `list`, and `delete`, preserving memory/rootfs with the source kept. Names and metadata are accepted but ignored. |
| `compute.template` | Supports `create`, `list`, and `delete`. Creation builds a default base image, a specified `image`, or a native `template` definition. |

Nonzero command exits return their output and exit code. Authentication, network,
and timeout errors reject the call. Background execution returns a launch
acknowledgement and cannot be combined with streaming callbacks.

Use `sandbox.getInstance()` to access the native Novita Sandbox, including PTY,
binary file operations, and provider-specific lifecycle methods. See the
[package README](../../packages/novita/README.md) for streaming, snapshot, and
template examples.
