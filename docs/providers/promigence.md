---
description: >-
  Promigence provider for ComputeSDK - production-grade sandboxes for AI agents,
  with filesystem and streaming output.
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

# Promigence

[Promigence](https://www.promigence.ai) provider for ComputeSDK - production-grade sandboxes for AI agents, with filesystem and streaming output, and a spend cap on every sandbox.

## Installation & Setup

```bash
npm install @computesdk/promigence
```

The package needs Node.js 20 or later.

Add your Promigence API key to a `.env` file:

```bash
PROMIGENCE_API_KEY=prom_api_...
```

To get a key, sign up with the Promigence CLI: `npm install -g promigence`, then `promigence signup` (or `promigence login` for an account you already have). The CLI stores the key on your machine, and the provider uses it when `PROMIGENCE_API_KEY` is not set.

Two more variables are optional. `PROMIGENCE_SPEND_CAP` is the most one sandbox may spend, in US dollars; unset, your organization's default cap applies. `PROMIGENCE_API_URL` picks the API to use.

## Usage

```typescript
import { promigence } from '@computesdk/promigence';

const compute = promigence({
  apiKey: process.env.PROMIGENCE_API_KEY,
});

// Create a sandbox from the built-in base snapshot
// (pass { templateId: '<snapshot id or alias>' } to start from one you built)
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Promigence!"');
console.log(result.stdout); // "Hello from Promigence!"

// Stream a command's output while it runs
await sandbox.runCommand('for i in 1 2 3; do echo "step $i"; sleep 1; done', {
  onStdout: (text) => process.stdout.write(text),
});

// Work with files
await sandbox.filesystem.writeFile('/tmp/hello.py', 'print("Hello World")');
const content = await sandbox.filesystem.readFile('/tmp/hello.py');
console.log(content);

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface PromigenceConfig {
  /** Promigence API key - if not provided, will use PROMIGENCE_API_KEY, then the key `promigence login` stored */
  apiKey?: string;
  /** Promigence API URL - if not provided, will use PROMIGENCE_API_URL, then the default Promigence API */
  apiUrl?: string;
  /** The most one sandbox may spend, in US dollars - if not provided, will use PROMIGENCE_SPEND_CAP, then your organization's default cap */
  spendCap?: number;
  /** The snapshot create() starts from when it names none (id, alias or alias@commit); default: the built-in base snapshot */
  snapshot?: string;
  /** Sandbox lifetime in milliseconds when create() sets none; also the bound on a command that sets none */
  timeout?: number;
  /** Size of a sandbox created from an image: 'xsmall', 'small', 'medium', 'large', 'xlarge' or '2xlarge' */
  tier?: string;
  /** 'start' (the default) or 'compute' (long, memory-heavy jobs on the larger tiers) */
  optimizeFor?: 'start' | 'compute';
  /** A client from @promigence/sdk to use instead of one built from apiKey and apiUrl */
  client?: PromigenceClient;
}
```

### Create options

`templateId` or `snapshotId` picks the snapshot to start from: its id, its alias, `alias@commit`, or the name of a Promigence template (`promigence templates` lists them). Pass `image` instead to start from a container image, such as `python:3.12` or `name@sha256:...`. The first `create()` from an image builds its snapshot, billed per second while it builds, and later ones reuse it; with `image`, `tier` sets the size and `registrySecret` names a stored secret that holds the registry credentials.

`create()` also takes `timeout`, `envs`, `metadata` (labels), `spendCap` and `optimizeFor`. Set `allowInternetAccess: false` for no network access, or `allowHosts: [...]` to reach only those destinations.

## Supported features

Commands take `cwd`, `env`, `timeout` and `background`, and a non-zero exit comes back as the result's `exitCode`. With `onStdout` or `onStderr`, output streams while the command runs; a command that outruns its `timeout` is stopped and reported with exit code 124.

The filesystem API covers reading, writing and listing files, creating directories, checking a path and removing it. `create`, `getById`, `list` (every sandbox that has not ended) and `destroy` manage sandboxes, and `snapshot.list()` / `snapshot.delete(id)` manage snapshots. `sandbox.getInstance()` returns the `Sandbox` from `@promigence/sdk`, its client and the provider config, for what the SDK offers beyond the ComputeSDK interface.

Errors from Promigence keep the SDK's `code` and `fix` (what to do next). Every code is listed at [promigence.ai/docs/errors](https://www.promigence.ai/docs/errors).

## Limitations

- There are no preview URLs yet, so `getUrl()` throws. To reach a server in the sandbox, call it from a command in the same sandbox, for example with `curl`.
- Creating a snapshot from a running sandbox is not offered, and `snapshot.create()` throws. Build snapshots with the Promigence CLI (`promigence snapshot create --image <image>`), or pass `image` to `create()`.
- Templates are snapshots here: the `template` methods throw, and `templateId` names a snapshot.
- The output of a `background: true` command is not collected.
- CPU and memory fields on `create()` are ignored, because a sandbox has its snapshot's size.
