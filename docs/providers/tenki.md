---
description: >-
  Luxor Agent Cloud provider for ComputeSDK - microVM sandboxes with native
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

# Luxor Agent Cloud

Luxor Agent Cloud provider for ComputeSDK - microVM sandboxes with native filesystem, preview URLs, snapshots, and SSH. Tenki Cloud is now Luxor Agent Cloud; the `tenki` export remains as a compatibility alias.

## Lifecycle

`pause()`/`resume()` preserve memory and processes. Snapshot methods `create`/`list`/`delete` are exposed directly. Snapshots preserve rootfs and memory and keep the source; the adapter notes that Luxor empties `/tmp` on the source during capture. Keep durable state outside `/tmp` (the declared path is `/home/tenki`). Restore with `snapshotId`.

## Installation & Setup

```bash
npm install @computesdk/tenki
```

Requires Node.js 20 or later (the Luxor Sandbox SDK's gRPC transport depends on it).

Add your Luxor credentials to a `.env` file:

```bash
LUXORAI_API_KEY=lx_your_api_key
```

`TENKI_API_KEY` / `TENKI_AUTH_TOKEN` remain accepted as fallbacks.

## Usage

```typescript
import { luxor } from '@computesdk/tenki';

const compute = luxor({
  apiKey: process.env.LUXORAI_API_KEY,
});

// Create sandbox
const sandbox = await compute.instances.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Luxor!"');
console.log(result.stdout); // "Hello from Luxor!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface LuxorConfig {
  /** Luxor API key (lx_...; tk_... remains accepted). Falls back to LUXORAI_API_KEY / LUXORAI_AUTH_TOKEN, then TENKI_API_KEY / TENKI_AUTH_TOKEN. */
  apiKey?: string;
  /** API base URL. Falls back to LUXORAI_API_ENDPOINT / LUXORAI_API_URL, then TENKI_API_ENDPOINT / TENKI_API_URL, then https://api.tenki.cloud. */
  baseUrl?: string;
  /** Workspace to create sandboxes in. Falls back to LUXORAI_WORKSPACE_ID / TENKI_WORKSPACE_ID; workspace API keys infer it server-side. */
  workspaceId?: string;
  /** @deprecated Luxor no longer scopes sandboxes by project. */
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

* Workspace API keys infer their workspace server-side. Set `workspaceId`, or `LUXORAI_WORKSPACE_ID` / `TENKI_WORKSPACE_ID`, only when using trusted service credentials that require explicit scope.
* Background commands (`{ background: true }`) detach stdio automatically; a bare `&` would hold the exec output stream open.
* Snapshots and pause/resume are wired to the unified surface. Use `sandbox.getInstance()` for additional native SDK controls such as SSH, tunnels, and git.
