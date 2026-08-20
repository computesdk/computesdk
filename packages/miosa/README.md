# @computesdk/miosa

MIOSA provider for [ComputeSDK](https://computesdk.com) with Firecracker microVM sandboxes on the MIOSA cloud.

MIOSA sandboxes can graduate to persistent desktops, serve public preview URLs on custom domains, and use off-host backups through a white-label control plane.

## Install

```bash
pnpm add @computesdk/miosa computesdk
```

## Usage

```typescript
import { createCompute } from 'computesdk';
import { miosa, prepareMiosaConnections } from '@computesdk/miosa';

const miosaConfig = { apiKey: process.env.MIOSA_API_KEY };

// Optional for latency-sensitive hosts: finish TCP, TLS, and HTTP/2 setup
// before starting a timed operation or accepting work.
await prepareMiosaConnections(miosaConfig);

const compute = createCompute({
  defaultProvider: miosa(miosaConfig),
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('python3 -c "print(40 + 2)"');
console.log(result.stdout); // "42"

await sandbox.filesystem.writeFile('/workspace/app.js', 'console.log("hi")');
const url = await sandbox.getUrl({ port: 3000 }); // white-label-aware preview URL

await sandbox.destroy();
```

### Configuration

```typescript
miosa({
  apiKey: 'msk_…',                       // or MIOSA_API_KEY env var
  baseUrl: 'https://api.miosa.ai/api/v1', // default; point at your white-label control plane
  timeout: 300_000,                       // default sandbox lifetime (ms)
});
```

Auth is a MIOSA API key (`msk_*`) sent as `Authorization: Bearer <key>`.

## Method → endpoint mapping

| ComputeSDK method | MIOSA endpoint | Notes |
|---|---|---|
| `sandbox.create()` | `POST /sandboxes` | Waits server-side until the sandbox is command-ready and returns a compact response; `templateId → template_id`, `snapshotId → snapshot_id`, `envs → env`, `timeout(ms) → timeout_sec` |
| `sandbox.getById()` | `GET /sandboxes/:id` | 404 → `null` |
| `sandbox.list()` | `GET /sandboxes` | |
| `sandbox.destroy()` | `DELETE /sandboxes/:id` | 404 treated as already destroyed |
| `runCommand()` | `POST /sandboxes/:id/exec` | `{command, cwd, env, timeout(sec)}`; `background` wraps in `nohup … &` |
| `getInfo()` | (from sandbox record) | `state → status`, `timeout_sec → timeout(ms)` |
| `getUrl({port})` | `POST /sandboxes/:id/expose` | Server resolves the tenant preview domain, never built client-side |
| `filesystem.readFile()` | `GET /sandboxes/:id/fs/read?path=` | native |
| `filesystem.writeFile()` | `POST /sandboxes/:id/fs/write` | native |
| `filesystem.mkdir()` | `POST /sandboxes/:id/fs/mkdir` | native, `recursive: true` |
| `filesystem.readdir()` | `GET /sandboxes/:id/fs?path=` | native |
| `filesystem.exists()` | `POST /sandboxes/:id/exec` (`test -e`) | **composed** because there is no boolean exists endpoint |
| `filesystem.remove()` | `DELETE /sandboxes/:id/fs?path=` | native |
| `snapshot.create()` | `POST /sandboxes/:id/snapshots` | native Firecracker checkpoints; `name → comment` |
| `snapshot.list({sandboxId})` | `GET /sandboxes/:id/snapshots` | MIOSA snapshots are sandbox-scoped |

Beyond the ComputeSDK surface, the same API key unlocks the full MIOSA API: sandbox fork/branching, pause/resume, desktop graduation, deploys, and off-host exports.

## Testing

```bash
pnpm test        # unit tests (mocked fetch, no network)
pnpm typecheck   # tsc --noEmit
```

## License

MIT
