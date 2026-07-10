---
description: >-
  Superserve provides sandbox infrastructure to run code in isolated cloud
  environments powered by Firecracker MicroVMs.
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

# Superserve

Superserve provides sandbox infrastructure to run code in isolated cloud environments powered by Firecracker MicroVMs.

## Installation & Setup

```bash
npm install @computesdk/superserve
```

Add your Superserve credentials to a `.env` file:

```bash
SUPERSERVE_API_KEY=your_api_key
```

## Usage

```typescript
import { superserve } from '@computesdk/superserve';

const compute = superserve({
  apiKey: process.env.SUPERSERVE_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Superserve!"');
console.log(result.stdout); // "Hello from Superserve!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface SuperserveConfig {
  /** Superserve API key. Falls back to `SUPERSERVE_API_KEY` env var. */
  apiKey?: string;
  /** API base URL. Falls back to `SUPERSERVE_BASE_URL` env var, then `https://api.superserve.ai`. */
  baseUrl?: string;
  /** Default sandbox idle timeout in milliseconds. */
  timeout?: number;
}
```

### Supported Operations

| Method       | Supported | Notes                                                                                                                                  |
| ------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `create`     | ✅         | Boots a Firecracker microVM; accepts `templateId` to boot from a template.                                                             |
| `getById`    | ✅         | Connects to a sandbox by id (issues `POST /activate`, auto-resumes paused).                                                            |
| `list`       | ✅         | Read-only — returns `SandboxInfo` stubs without opening a session.                                                                     |
| `destroy`    | ✅         | Kills the sandbox by id.                                                                                                               |
| `runCommand` | ✅         | Supports `cwd`, `env`, `timeout`, and `background`.                                                                                    |
| `getInfo`    | ✅         | `paused` maps to `stopped`, `failed` to `error`, otherwise `running`.                                                                  |
| `filesystem` | ✅         | `readFile`/`writeFile` use the data plane; `mkdir`/`readdir`/`exists`/`remove` are shell fallbacks.                                    |
| `getUrl`     | ❌         | Throws — arbitrary port forwarding is not supported. Run a reverse-proxy inside the sandbox.                                           |
| `snapshot`   | ❌         | Throws — Superserve has no standalone snapshot resource. Use templates, or SDK `pause()` / `resume()` for in-place state preservation. |

### Notes

* Templates are supported for listing and deletion. `template.create` throws — creating a template requires a build spec (`from` + `steps`), so use `@superserve/sdk` `Template.create()` directly.
* Authentication failures (HTTP 401, missing key, SDK `AuthenticationError`) are normalized into a single user-facing message.
