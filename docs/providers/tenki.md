---
description: >-
  Tenki Cloud provider for ComputeSDK - microVM sandboxes with native
  filesystem, preview URLs, snapshots, and SSH.
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

# Tenki

Tenki Cloud provider for ComputeSDK - microVM sandboxes with native filesystem, preview URLs, snapshots, and SSH.

## Installation & Setup

```bash
npm install @computesdk/tenki
```

Requires Node.js 20 or later (the Tenki SDK's gRPC transport depends on it).

Add your Tenki credentials to a `.env` file:

```bash
TENKI_API_KEY=tk_your_api_key
```

## Usage

```typescript
import { tenki } from '@computesdk/tenki';

const compute = tenki({
  apiKey: process.env.TENKI_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Tenki!"');
console.log(result.stdout); // "Hello from Tenki!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface TenkiConfig {
  /** Tenki API key (tk_...). Falls back to TENKI_API_KEY / TENKI_AUTH_TOKEN env vars. */
  apiKey?: string;
  /** API base URL. Falls back to TENKI_API_URL, then https://api.tenki.cloud. */
  baseUrl?: string;
  /** Workspace to create sandboxes in. Falls back to TENKI_WORKSPACE_ID, then auto-resolved from the API key. */
  workspaceId?: string;
  /** Project to create sandboxes in. Falls back to TENKI_PROJECT_ID, then auto-resolved from the API key. */
  projectId?: string;
  /** Default runCommand timeout in milliseconds. */
  timeout?: number;
  /** Default sandbox resources applied at create() time. */
  cpuCores?: number;
  memoryMb?: number;
  diskSizeGb?: number;
}
```

### Supported Operations

| Method       | Supported | Notes                                                                                                                                     |
| ------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `create`     | ✅         | Boots a microVM in the resolved workspace/project; accepts per-call `cpuCores`/`memoryMb`/`diskSizeGb` overrides.                         |
| `getById`    | ✅         | Resolves a session by id; returns null for unknown/invalid ids.                                                                           |
| `list`       | ✅         | Lists sessions for the API key.                                                                                                           |
| `destroy`    | ✅         | Closes the session (no-op if already gone).                                                                                               |
| `runCommand` | ✅         | Wrapped in `sh -lc` so pipes, globs, and env expansion work; supports `cwd`, `env`, `timeout`, `background`, and stdout/stderr streaming. |
| `getInfo`    | ✅         |                                                                                                                                           |
| `getUrl`     | ✅         | Exposes a port and returns its public preview URL (e.g. `https://<slug>.sb.tenki.sh`).                                                    |
| `filesystem` | ✅         | Native data-plane file API (`readFile`, `writeFile`, `mkdir`, `readdir`, `remove`); `exists` uses `test -e` for consistency.              |

### Notes

* When `workspaceId`/`projectId` are not set, the provider resolves them once from the API key's identity (first workspace with a project). Set them explicitly, or via `TENKI_WORKSPACE_ID` / `TENKI_PROJECT_ID`, to skip the lookup.
* Background commands (`{ background: true }`) detach stdio automatically; a bare `&` would hold the exec output stream open.
* Snapshots and pause/resume exist in the underlying `@tenkicloud/sandbox` SDK but are not yet wired to the provider's snapshot methods. For advanced features (SSH, volumes, tunnels, git, snapshots), use `sandbox.getInstance()` to reach the SDK `Session` directly.
