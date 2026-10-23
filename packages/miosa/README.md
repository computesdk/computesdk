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
import { miosa } from '@computesdk/miosa';

const compute = createCompute({
  defaultProvider: miosa({ apiKey: process.env.MIOSA_API_KEY }),
});

const sandbox = await compute.instances.create();

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
  runnerMode: true,                       // default; false (or MIOSA_RUNNER_MODE=0) keeps create/exec/destroy on the account API
  lazyCreate: false,                      // default; true (or MIOSA_LAZY_CREATE=1) defers create() to first use
});
```

Auth is a MIOSA API key (`msk_*`) sent as `Authorization: Bearer <key>`.

### Regional endpoint

Create, exec and destroy go to MIOSA's regional sandbox endpoint (`run-<region>.miosa.ai`) instead of the account API, which removes a hop from each call. Everything else (list, getById, getUrl, filesystem, snapshots) stays on the account API.

- With a custom `baseUrl` (or `MIOSA_BASE_URL`) the regional endpoint is off by default, so a white-label or self-hosted control plane's key is never sent to MIOSA's public regional host. Set `runnerMode: true`, `MIOSA_RUNNER_MODE=1` or a `runnerBaseDomain` to opt in.
- A create the regional endpoint does not serve, such as a template, a snapshot or a shape above the standard size, goes to the account API and the sandbox stays there for its whole life.
- A create is moved to the account API only when the regional endpoint refused it before provisioning anything: it could not be reached, had no capacity, or did not know the key yet. A timeout or a reset connection is surfaced as an error instead of being sent to the account API, because the request may have been delivered and a second create could provision a second sandbox.

### Lazy create

With `lazyCreate` on, `create()` makes no network call. The first `runCommand()` sends one request that creates the sandbox and runs the command. Any other first call (`getInfo`, `getUrl`, a filesystem call, `getById`, a snapshot) creates the sandbox first. Errors from the create surface on that first call. A first command the runner refuses (empty, too large, bad timeout) is reported as a failed command with exit code 127, creates nothing, and leaves the handle unused. A first command that runs but produces no result (deadline, spawn failure) is reported the same way and is not run again. Destroying a handle that was never used sends nothing.

`sandboxId` is a client-side placeholder for the whole life of the handle, before and after the sandbox exists, because the framework fixes it when `create()` returns. It names the sandbox only inside the process that created it and is only honoured for the API key that created it. To store or pass the sandbox on, read the real id from `getInfo().id`. The option only applies while the regional endpoint is in use.

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
| `snapshot.list({instanceId})` | `GET /sandboxes/:id/snapshots` | MIOSA snapshots are sandbox-scoped |

Beyond the ComputeSDK surface, the same API key unlocks the full MIOSA API: sandbox fork/branching, pause/resume, desktop graduation, deploys, and off-host exports.

## Testing

```bash
pnpm test        # unit tests (mocked fetch, no network)
pnpm typecheck   # tsc --noEmit
```

## License

MIT
