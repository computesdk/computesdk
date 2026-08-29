# @computesdk/mosaic

Mosaic provider for ComputeSDK. Mosaic provides Firecracker-based sandbox environments with command execution, a workspace filesystem, preview URLs, snapshots, and environments built from container images.

## Installation

```bash
npm install computesdk @computesdk/mosaic
```

## Quick start

```typescript
import { compute } from 'computesdk';
import { mosaic } from '@computesdk/mosaic';

compute.setConfig({
  provider: mosaic({
    baseUrl: process.env.MOSAIC_API_URL,
    apiKey: process.env.MOSAIC_API_TOKEN,
  }),
});

const sandbox = await compute.sandbox.create({ templateId: 'node-20' });

await sandbox.filesystem.writeFile('/workspace/server.js', 'require("http").createServer((_, r) => r.end("ok")).listen(3000)');
await sandbox.runCommand('node /workspace/server.js', { background: true });
console.log(await sandbox.getUrl({ port: 3000 }));

await sandbox.destroy();
```

The provider also reads `MOSAIC_API_URL` and `MOSAIC_API_TOKEN` when those values are omitted from the configuration. `baseUrl` should point to a Mosaic API deployment, and `apiKey` is sent as a bearer token.

## Configuration

```typescript
interface MosaicConfig {
  baseUrl?: string;
  apiKey?: string;
  template?: string;
  memoryMb?: number;
  vcpu?: number;
  requestTimeoutMs?: number;
  /** Outbound network access. On by default. */
  networkEnabled?: boolean;
  /** Lifetime of a URL from getUrl, in seconds. Defaults to 3600. */
  previewExpiresInSeconds?: number;
}
```

Per-sandbox `templateId`, `runtime`, `memoryMb`, `memoryMiB`, `vcpus`, `cpus`, and `metadata` options override the provider defaults.

## Templates, snapshots, and images

`node-20` and `python-3.11` are Mosaic's stock templates. Anything else — a `templateId` that is not stock, a `snapshotId`, or an `image` — is one of your own environments, addressed by id or by the name you gave it:

```typescript
const provider = mosaic({});

// Build an environment from any linux/amd64 registry image (minutes, once).
await provider.template.create({ name: 'my-env', image: 'python:3.12-slim' });

// Sandboxes from it restore in about a second, like any other template.
const sandbox = await compute.sandbox.create({ templateId: 'my-env' });

// Or checkpoint a sandbox you have already set up.
const snapshot = await provider.snapshot.create(sandbox.sandboxId, { name: 'my-toolchain' });
await compute.sandbox.create({ snapshotId: 'my-toolchain' });
```

`template.create` accepts `image` plus optional `retentionSeconds` and `registryUsername`/`registryPassword` for a private image. Registry credentials are used for that single pull and are never stored.

## Supported operations

| Method | Supported | Notes |
|---|---|---|
| `create` | ✅ | Stock template, snapshot, or image environment; resource and metadata overrides. |
| `getById` | ✅ | Returns `null` when the sandbox is not found. |
| `list` | ✅ | Lists sandboxes visible to the API token. |
| `destroy` | ✅ | Idempotent for missing sandboxes. |
| `runCommand` | ✅ | Working directory, environment, timeout, and background execution. |
| `getInfo` | ✅ | Returns lifecycle state and resource metadata. |
| `getUrl` | ✅ | Expiring HTTPS preview URL for a guest port. |
| `filesystem` | ✅ | Read, write, mkdir, readdir, exists, remove. |
| `snapshot` | ✅ | Create, list, and delete; a snapshot can be named and restored by name. |
| `template` | ✅ | Build, list, and delete environments from container images. |

## Notes

- `background: true` starts a durable process rather than a backgrounded shell job, so a dev server outlives the request that started it. The returned `stdout` is the process id.
- Filesystem calls inside `/workspace` use Mosaic's binary-safe files API; paths outside it fall back to the shell.
- Images must be `linux/amd64` and contain `/bin/sh`, so distroless and scratch images are refused.
- Previews are served over HTTPS by Mosaic's edge; `getUrl` rejects any other protocol.

## License

MIT
