---
description: >-
  Set up the Arker provider for ComputeSDK, configure your API key, and create
  sandboxed VMs to run commands with a persistent filesystem.
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

# Arker

Arker provider for ComputeSDK — sandboxed VMs with persistent per-VM filesystems.


## Installation & Setup

```bash
npm install @computesdk/arker
```

Add your Arker credentials to a `.env` file:

```bash
ARKER_API_KEY=your_arker_api_key
```

> **Note:** Arker API keys start with `ark_` — get one from [arker.ai](https://arker.ai). By default the provider targets the `aws-us-east-1` region; select another region with `ARKER_REGION`.


## Usage

```typescript
import { arker } from '@computesdk/arker';

const compute = arker({
  apiKey: process.env.ARKER_API_KEY,
});

// Create sandbox (forks the `ubuntu-small` golden by default)
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Arker!"');
console.log(result.stdout); // "Hello from Arker!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface ArkerConfig {
  /** Arker API key (starts with `ark_`). Falls back to ARKER_API_KEY. */
  apiKey?: string;
  /** Region, e.g. `aws-us-east-1`. Falls back to ARKER_REGION, then the us-east-1 default. */
  region?: string;
  /** Golden source VM to fork on create(). Falls back to ARKER_SOURCE, then `ubuntu-small`. */
  source?: string;
}
```

### Supported Operations

- **Sandbox lifecycle** — `create` (fork from a golden image), `getById`, `list`, `destroy`
- **Command execution** — `runCommand` with `cwd`, `env`, `timeout`, and `background` options; Node.js and Python are preinstalled on the default `ubuntu-small` golden
- **Filesystem** — `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, `remove` (persistent per-VM filesystem)

### Notes

- **Creation is fork-only.** Direct VM creation is disabled; `create()` forks a source VM — a golden/template by name (`templateId` or `source`, `ubuntu-small` by default) or a specific VM by id (`snapshotId`). The `sandboxId` returned by `create()` can be passed back as a `snapshotId` to branch from that sandbox's state; there is no separate snapshot store. `snapshotId` wins if both are given.
- **`getUrl` is not supported** and throws. VMs forked with network reachability enabled get a stable per-VM hostname — see the [Arker SDK](https://github.com/ArkerHQ/arker-sdk) fork network options.
- **Automatic retries.** The underlying `@arker-ai/sdk` retries transient failures (HTTP 429/502/503/504 and transient backend errors).
