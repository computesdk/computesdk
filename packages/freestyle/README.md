# @computesdk/freestyle

[Freestyle](https://www.freestyle.sh) provider for ComputeSDK — full Linux virtual machines designed for long-running, complex agent tasks, with instant startup, persistence, and cheap snapshotting.

## Installation

```bash
npm install @computesdk/freestyle

# .env
FREESTYLE_API_KEY=your_freestyle_api_key
```

Freestyle base images ship no language runtime, so the **first** sandbox on an account bakes a Node + Python snapshot once (~20 s) and every sandbox after boots from it in ~200–300 ms. Set `FREESTYLE_SNAPSHOT_ID` (or the `snapshotId` option) to your own snapshot to skip baking.

## Usage

```typescript
import { freestyle } from '@computesdk/freestyle';

const compute = freestyle({ apiKey: process.env.FREESTYLE_API_KEY });

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('node -v');
console.log(result.stdout); // "v22.19.0\n"

// Full native filesystem — Freestyle VMs are real Linux guests
await sandbox.filesystem.writeFile('/tmp/app.js', 'console.log("hi")');
console.log(await sandbox.filesystem.readFile('/tmp/app.js'));

await sandbox.destroy();
```

## Configuration

```typescript
interface FreestyleConfig {
  /** Freestyle API key. Falls back to FREESTYLE_API_KEY. */
  apiKey?: string;
  /** Snapshot every sandbox boots from. Falls back to FREESTYLE_SNAPSHOT_ID; auto-baked when unset. */
  snapshotId?: string;
  /** API base URL. Falls back to FREESTYLE_API_URL, then the SDK default. */
  baseUrl?: string;
  /** Idle seconds before Freestyle stops the VM (default 300). */
  idleTimeoutSeconds?: number;
  /** Default wall-clock limit for a single command, ms (default 300000). */
  timeout?: number;
  /** Keep the VM after it stops instead of deleting it (default: ephemeral). */
  persistent?: boolean;
  /** Outbound firewall. Defaults to allow-all outbound; pass { rules: [] } to seal. */
  firewall?: { rules: unknown[] };
}
```

## Capabilities

| Feature | Support |
|---|---|
| `runCommand` | ✅ |
| Filesystem: read, write, readdir, mkdir, exists, remove | ✅ (native) |
| Snapshots: create, list, delete | ✅ |
| Reconnect by id (`compute.sandbox.getById`) | ✅ |
| List sandboxes | ✅ (VMs this provider created) |
| `getUrl` (per-port URL) | ❌ — map a domain via [`freestyle.domains`](https://docs.freestyle.sh) |

## License

MIT
