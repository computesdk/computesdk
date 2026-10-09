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
  /** Soft request threshold, independent of connection pooling. Defaults to 32. */
  maxConcurrentRequests?: number;
  /** Share HTTP/2 connections for Node HTTPS endpoints. Defaults to true. */
  http2?: boolean;
  /** Outbound network access. On by default. */
  networkEnabled?: boolean;
  /** Lifetime of a URL from getUrl, in seconds. Defaults to 3600. */
  previewExpiresInSeconds?: number;
}
```

Per-sandbox `templateId`, `runtime`, `memoryMb`, `memoryMiB`, `vcpus`, `cpus`, and `metadata` options override the provider defaults.

On Node 22.19+ with HTTPS, independent Mosaic provider instances share up to four HTTP/2 connections per origin. ALPN negotiation happens before the first request, and its socket is reused. HTTP/1.1-only endpoints, HTTP endpoints and older Node versions retain native `fetch`. HTTP/1.1-only HTTPS endpoints incur one TLS-only negotiation on first use; no HTTP probe is sent. Undici is optional, so installations without it also retain native fetch. Set `http2: false` to retain native fetch for a custom dispatcher or proxy, or for a transport comparison. The matching Undici fetch implementation is used only for this provider’s HTTP/2 requests. Other providers and the global dispatcher are unchanged.

The origin cache holds at most 16 entries and closes unused pools after 30 seconds. The existing FIFO request gate, one-second queue escape and response-body lifetime are unchanged. Request deadlines cover connection negotiation and response consumption; cancellation does not replay create or command requests.

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

## Verifying a packed candidate

After building and packing, install the tarball into a clean directory. The
synthetic fixture below checks two 100-factory create/command/delete bursts,
per-request credentials, real HTTP protocol/connections and zero remaining
fixture allocations. Its timings are not production latency evidence.

```bash
NODE_EXTRA_CA_CERTS=packages/mosaic/src/__tests__/fixtures/tls-cert.pem \
  node packages/mosaic/scripts/verify-packed.mjs /absolute/path/to/clean-install/node_modules/@computesdk/mosaic/dist/index.mjs esm h2
```

Use the CJS entry with `cjs h2` to check CommonJS. `esm native` sets
`http2: false`; for older Node or an installation without optional dependencies,
use `esm default` and confirm all requests went through native fetch.
