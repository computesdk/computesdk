---
description: >-
  Lelantos provider for ComputeSDK — execute code in secure, EU-native
  Firecracker microVM sandboxes.
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

# Lelantos

Lelantos provider for ComputeSDK — execute code in secure, EU-native [Firecracker](https://firecracker-microvm.github.io/) microVM sandboxes. Lelantos is an E2B-API-compatible platform running on Hetzner bare-metal in the EU, so this provider wraps the same `e2b` npm SDK pointed at the Lelantos control plane.

## Installation & Setup

```bash
npm install @computesdk/lelantos
```

Add your Lelantos credentials to a `.env` file:

```bash
LELANTOS_API_KEY=lel_your_api_key_here
# Optional — override the control-plane + sandbox domain (defaults to lelantos.ai)
LELANTOS_DOMAIN=lelantos.ai
# Optional — explicit control-plane URL (overrides the domain-derived URL)
LELANTOS_API_URL=https://api.lelantos.ai
```

Lelantos issues `lel_…` keys. The provider accepts both the `lel_…` and `e2b_…` forms of a Lelantos key, and resolves credentials with the fallback order `config` → `LELANTOS_*` → `E2B_*` so it is a drop-in for E2B-shaped configs.

## Usage

```typescript
import { lelantos } from '@computesdk/lelantos';

const compute = lelantos({
  apiKey: process.env.LELANTOS_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Lelantos!"');
console.log(result.stdout); // "Hello from Lelantos!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface LelantosConfig {
  /**
   * Lelantos API key. Accepts the `lel_…` form OR the `e2b_…` form of a
   * lelantos key (a native `lel_<hex>` key is transparently presented to the
   * e2b SDK as its `e2b_<hex>` alias). If not provided, falls back to the
   * `LELANTOS_API_KEY` environment variable, then `E2B_API_KEY`.
   */
  apiKey?: string;
  /**
   * Lelantos control-plane + sandbox domain, e.g. `'lelantos.ai'`. The e2b SDK
   * derives the control-plane URL as `https://api.${domain}` and the sandbox
   * preview host as `{port}-{sandboxId}.${domain}`. If not provided, falls back
   * to the `LELANTOS_DOMAIN` then `E2B_DOMAIN` environment variable, then
   * defaults to `'lelantos.ai'`.
   */
  domain?: string;
  /**
   * Explicit control-plane URL override (e.g. a non-`api.` host or a port).
   * Takes precedence over `domain`-derived URLs for control-plane calls. Falls
   * back to `LELANTOS_API_URL` then `E2B_API_URL`.
   */
  apiUrl?: string;
  /** Execution timeout in milliseconds (defaults to 300000). */
  timeout?: number;
}
```

### Supported Operations

| Method       | Supported | Notes                                                                                                                                    |
| ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `create`     | ✅         | Boot from a `templateId` / `snapshotId` when supplied.                                                                                   |
| `getById`    | ✅         | Reconnects to a running sandbox by id.                                                                                                   |
| `list`       | ✅         |                                                                                                                                          |
| `destroy`    | ✅         |                                                                                                                                          |
| `runCommand` | ✅         | Supports `env`, `cwd`, `background`. Real non-zero exit codes are returned, not thrown. Transient infra errors are retried with backoff. |
| `getInfo`    | ✅         |                                                                                                                                          |
| `getUrl`     | ✅         | Returns `https://{port}-{sandboxId}.{domain}` for the given port.                                                                        |
| `filesystem` | ✅         | `readFile`, `writeFile`, `mkdir`, `readdir`, `exists`, `remove` (native e2b files).                                                      |
| `snapshot`   | ✅         | `compute.snapshot.create` snapshots a running sandbox; `list` / `delete` map to templates.                                               |
| `template`   | partial   | `list` / `delete` supported; `create` throws — build via the E2B template protocol / CLI or `snapshot.create()`.                         |

### Notes

* Because the wire protocol is E2B-compatible, `domain` / `apiUrl` are threaded into **every** SDK call (create, connect, list, kill, snapshot, template) so lifecycle operations stay on Lelantos rather than falling back to `api.e2b.app`.
* Sandboxes run in the EU (single-region today).
* Point at a self-hosted or staging slot by setting `domain` (and optionally `apiUrl`).
