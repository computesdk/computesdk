---
description: >-
  just-bash provider for ComputeSDK — local sandboxed bash execution with a
  virtual filesystem. No external services, containers, or authentication
  required.
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

# Just Bash

just-bash provider for ComputeSDK — local sandboxed bash execution with a virtual filesystem. No external services, containers, or authentication required.

## Installation & Setup

```bash
npm install @computesdk/just-bash
```

No environment variables or credentials are required. just-bash runs entirely locally, interpreting commands in TypeScript against an in-memory virtual filesystem.

## Usage

```typescript
import { justBash } from '@computesdk/just-bash';

const compute = justBash({});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from just-bash!"');
console.log(result.stdout); // "Hello from just-bash!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface JustBashConfig {
  /** Enable Python support via pyodide (disabled by default) */
  python?: boolean;
  /** Initial files to populate in the virtual filesystem */
  files?: BashOptions['files'];
  /** Initial environment variables */
  env?: Record<string, string>;
  /** Working directory (defaults to /home/user) */
  cwd?: string;
  /** Custom filesystem implementation (InMemoryFs by default; also OverlayFs, ReadWriteFs, MountableFs) */
  fs?: BashOptions['fs'];
  /** Custom commands created with defineCommand() */
  customCommands?: BashOptions['customCommands'];
  /** Network configuration for curl (disabled by default) */
  network?: BashOptions['network'];
}
```

### Supported Operations

| Method       | Supported | Notes                                                                       |
| ------------ | --------- | --------------------------------------------------------------------------- |
| `create`     | ✅         | Creates an in-process sandbox; `runtime: 'python'` also enables Python.     |
| `getById`    | ✅         | Looks up sandboxes tracked in the current process.                          |
| `list`       | ✅         |                                                                             |
| `destroy`    | ✅         | Removes the sandbox from the in-process registry.                           |
| `runCommand` | ✅         | Supports `env` and `cwd`. 60+ built-in commands (jq, awk, sed, grep, etc.). |
| `getInfo`    | ✅         |                                                                             |
| `getUrl`     | ❌         | Throws — just-bash is a local sandbox with no network capabilities.         |
| `filesystem` | ✅         | `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, `remove`.            |

### Notes

* **Local, no network** — no API keys, containers, or external services. Ideal for tests, CI, AI-agent tooling, and offline use.
* **In-memory by default** — files do not persist across process restarts unless you supply an `OverlayFs`, `ReadWriteFs`, or `MountableFs` backend via `fs`.
* **Not real processes** — commands are interpreted in TypeScript, not executed as OS processes; there is no real Node.js runtime.
* **Python via pyodide** — requires `python: true` and runs a WebAssembly-based interpreter.
