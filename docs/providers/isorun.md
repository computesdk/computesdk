---
description: >-
  Isorun provider for ComputeSDK — isolated Linux VM sandboxes for running
  untrusted and AI-generated code, billed by the second.
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

# Isorun

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/isorun/" %}

Isorun provider for ComputeSDK — isolated Linux VM sandboxes for running untrusted and AI-generated code, billed by the second.

## Installation & Setup

```bash
npm install @computesdk/isorun
```

Add your Isorun credentials to a `.env` file:

```bash
ISORUN_API_KEY=your_isorun_api_key
```

## Usage

```typescript
import { isorun } from '@computesdk/isorun';

const compute = isorun({
  apiKey: process.env.ISORUN_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Isorun!"');
console.log(result.stdout); // "Hello from Isorun!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface IsorunConfig {
  /** API key. Falls back to `ISORUN_API_KEY` env var. The runner endpoint is derived from the key. */
  apiKey?: string;
}
```

### Supported Operations

| Method       | Supported | Notes                                                                                                                                                      |
| ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`     | ✅         | Defaults to the `node` runtime (`node:22`); pass `runtime: 'python'` for `python:3.12-slim`. Accepts `image`, `vcpus`, `memMiB`, `diskMiB`, and `timeout`. |
| `getById`    | ✅         |                                                                                                                                                            |
| `list`       | ✅         |                                                                                                                                                            |
| `destroy`    | ✅         |                                                                                                                                                            |
| `runCommand` | ✅         | Supports `env`, `cwd`, and `background` options.                                                                                                           |
| `getInfo`    | ✅         |                                                                                                                                                            |
| `getUrl`     | ✅         | Returns the sandbox URL for a given port; honors a custom `protocol`.                                                                                      |
| `filesystem` | ✅         | `readFile` / `writeFile` are native; `mkdir`, `readdir`, `exists`, `remove` run via shell commands.                                                        |
| `snapshot`   | ✅         | `compute.snapshot.create` / `list` / `delete`.                                                                                                             |

### Notes

* The default command/sandbox timeout is 300000 ms (5 minutes).
* The `isorun` SDK exposes extra capabilities without ComputeSDK slots — `fork(n)`, `hibernate()` / `resume()`, and `setTimeout(seconds)`. Reach the raw instance via `compute.sandbox.getInstance(sandbox)`.
