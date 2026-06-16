# @computesdk/createos-sandbox

[ComputeSDK](https://github.com/computesdk/computesdk) provider for **CreateOS** —
NodeOps' createos-sandbox Firecracker microVM sandbox service. Thin adapter over the
official [`@nodeops-createos/sandbox`](https://www.npmjs.com/package/@nodeops-createos/sandbox).

## Install

```bash
npm install computesdk @computesdk/createos-sandbox
```

## Usage

```typescript
import { compute } from "computesdk";
import { createosSandbox } from "@computesdk/createos-sandbox";

compute.setConfig({
  provider: createosSandbox({
    apiKey: process.env.CREATEOS_SANDBOX_API_KEY,
    baseUrl: process.env.CREATEOS_SANDBOX_BASE_URL,
  }),
});

const sandbox = await compute.sandbox.create({ memoryMb: 1024, image: "devbox:1" });
const { stdout } = await sandbox.runCommand("echo hello");
await sandbox.filesystem.writeFile("/tmp/x.txt", "hi");
await sandbox.destroy();
```

## Configuration

| Field | Env fallback | Notes |
|---|---|---|
| `apiKey` | `CREATEOS_SANDBOX_API_KEY` | Required. createos-sandbox API key. |
| `baseUrl` | `CREATEOS_SANDBOX_BASE_URL` | Control-plane URL. |
| `shape` | — | Default VM shape (e.g. `s-1vcpu-1gb`). |
| `rootfs` | — | Default rootfs catalog name / template. |
| `timeout` | — | Reported `getInfo().timeout` (ms). Informational. |

## Capability mapping

createos-sandbox sizes VMs from a **shape catalog** (not free-form cpu/mem), so
`create()` fetches the live catalog (`GET /v1/shapes`) and maps ComputeSDK's
`cpus`/`memoryMb` onto the smallest shape that fits. Pass a provider-specific
`shape` to pin one exactly (skips the catalog fetch). With no size pinned, the
default is the smallest live shape with ≥1 GiB RAM. `image`/`runtime` map to
`rootfs`; `ephemeralDiskMb` is passed straight through to `disk_mib` (the
control plane validates it; `0`/omitted = the shape's default disk).

| ComputeSDK | createos-sandbox |
|---|---|
| shape selection | `GET /v1/shapes` (live catalog, nearest fit) |
| `sandbox.create` / `getById` / `list` / `destroy` | `POST/GET/DELETE /v1/sandboxes` |
| `sandbox.runCommand` | `POST /v1/sandboxes/:id/exec` (wrapped in `sh -c`) |
| `sandbox.getInfo` | `GET /v1/sandboxes/:id` |
| `sandbox.getUrl({port})` | per-sandbox ingress URL |
| `filesystem.readFile` / `writeFile` | `GET/PUT /v1/sandboxes/:id/files` |
| `filesystem.mkdir` / `readdir` / `exists` / `remove` | synthesised via `runCommand` |
| `snapshot.create` / `list` / `delete` | `pause` / list paused / `destroy` |

Template builds (`/v1/templates`) are **not** exposed through the ComputeSDK
provider surface — ComputeSDK's public `Provider` type can't carry the
createos-specific `dockerfile` create option type-safely. Build templates with
the native `@nodeops-createos/sandbox` client (`client.templates.create`)
directly.

### Native escape hatch

ComputeSDK's core surface has no pause/resume/fork. Reach the full
`@nodeops-createos/sandbox` `Sandbox` handle via `getInstance()`:

```typescript
const native = sandbox.getInstance();
await native.pause();
await native.resume();
const clone = await native.fork();
await native.attachDisk({ diskId: "my-bucket", mountPath: "/mnt/data" });
```

## Known limitations

- **`runCommand` env/cwd are synthesised** — createos-sandbox drops per-exec env
  server-side, so `env`/`cwd` are injected by wrapping the command in an inline
  `sh -c` script. Sandbox-level env should be set at create time (`envs`).
- **Snapshot semantics differ** — `snapshot.create` *pauses* the sandbox (the
  source VM stops); the paused sandbox id IS the snapshot id. `create({ snapshotId })`
  forks that paused bundle into a fresh sandbox.
- **`getUrl` needs ingress + works in-process** — sandboxes are created with
  ingress enabled by default; `getUrl` is only available for sandboxes created in
  this process (the SDK handle from `getById`/`list` carries no ingress template).
  Ingress currently serves a non-CA TLS cert and strips the `Authorization`
  header upstream — use `protocol: "http"` / `curl -k` and don't rely on HTTP auth
  behind ingress.
- **`readdir` parses `ls` output** — relies on coreutils `ls` in the rootfs.

## License

MIT
