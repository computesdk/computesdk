# @computesdk/tenki

[Luxor](https://luxor.ai) provider for ComputeSDK - run code in fast microVM sandboxes with native filesystem operations, public preview URLs, snapshots, volumes, and SSH. Tenki Cloud is now Luxor; the `tenki` export remains as a compatibility alias.

## Installation

```bash
npm install @computesdk/tenki
```

Requires Node.js 20 or later (the Luxor Sandbox SDK's gRPC transport depends on it).

## Setup

1. Sign up at [luxor.ai](https://luxor.ai)
2. Create an API key in your workspace settings
3. Set it as an environment variable:

```bash
export LUXOR_API_KEY=lx_your_api_key
```

`LUXORAI_*` and `TENKI_*` variables remain accepted as fallbacks.

## Usage

### With ComputeSDK

```typescript
import { compute } from 'computesdk';
import { luxor } from '@computesdk/tenki';

compute.setConfig({ provider: luxor({ apiKey: process.env.LUXOR_API_KEY }) });

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('echo "Hello from Luxor!"');
console.log(result.stdout);

await sandbox.destroy();
```

### Filesystem operations

Luxor exposes native file primitives over its data plane, so filesystem operations do not go through shell commands (no escaping hazards, works with any path or content):

```typescript
await sandbox.filesystem.writeFile('/home/tenki/app.py', 'print("hi")');
const content = await sandbox.filesystem.readFile('/home/tenki/app.py');
const entries = await sandbox.filesystem.readdir('/home/tenki');
await sandbox.filesystem.mkdir('/home/tenki/data');
const exists = await sandbox.filesystem.exists('/home/tenki/app.py');
await sandbox.filesystem.remove('/home/tenki/app.py');
```

### Public preview URLs

```typescript
// Start a server (background commands are detached automatically)
await sandbox.runCommand('python3 -m http.server 3000', { background: true });

// Expose the port at a public URL
const url = await sandbox.getUrl({ port: 3000 });
// => https://<slug>.sb.tenki.sh
```

## Configuration

| Option | Env var | Default | Description |
|---|---|---|---|
| `apiKey` | `LUXOR_API_KEY` / `LUXOR_AUTH_TOKEN`, then `LUXORAI_API_KEY` / `LUXORAI_AUTH_TOKEN`, then `TENKI_API_KEY` / `TENKI_AUTH_TOKEN` | required | Luxor API key (`lx_...`; `tk_...` remains accepted) |
| `baseUrl` | `LUXOR_API_ENDPOINT` / `LUXOR_API_URL`, then `LUXORAI_API_ENDPOINT` / `LUXORAI_API_URL`, then `TENKI_API_ENDPOINT` / `TENKI_API_URL` | `https://api.luxor.ai` | API endpoint |
| `workspaceId` | `LUXOR_WORKSPACE_ID` / `LUXORAI_WORKSPACE_ID` / `TENKI_WORKSPACE_ID` | inferred from workspace API key | Explicit workspace for trusted service credentials |
| `projectId` | - | ignored | Deprecated; Luxor no longer scopes sandboxes by project |
| `timeout` | - | none | Default `runCommand` timeout (ms) |
| `cpuCores` / `memoryMb` / `diskSizeGb` | - | Luxor defaults | Default sandbox resources |

Workspace API keys infer their workspace server-side. Set `workspaceId`, or `LUXOR_WORKSPACE_ID` / `LUXORAI_WORKSPACE_ID` / `TENKI_WORKSPACE_ID`, only when using trusted service credentials that require explicit scope.

Per-sandbox resource overrides are accepted on `create`:

```typescript
await compute.instances.create({ cpuCores: 4, memoryMb: 8192 });
```

## Feature support

| Feature | Supported |
|---|---|
| Commands (`runCommand`) | Yes - via `sh -lc`, so pipes, globs, and env expansion work |
| Filesystem | Yes - native data-plane file API |
| Public URLs (`getUrl`) | Yes - per-port preview URLs |
| List / getById / destroy | Yes |
| Background commands | Yes - `{ background: true }` detaches stdio automatically |
| Custom images | Via Luxor templates (`templateId` maps to a Luxor image ref) |
| Pause / resume | Yes - `sandbox.pause()` / `sandbox.resume()`; memory, processes and files (including `/tmp`) survive |
| Snapshots | Yes - `compute.snapshot.create(id)`, restore with `create({ snapshotId })`; memory snapshots that keep the rootfs except `/tmp` (emptied on the source too), source keeps running |

## Notes

- `runCommand` wraps the command in `sh -lc` because Luxor's exec runs argv directly (execve, no shell).
- A long-running process started with a bare `&` would hold the exec output stream open; use `{ background: true }`, which detaches stdio for you.
- For advanced features (SSH, tunnels, git operations), use the underlying SDK directly via `sandbox.getInstance()`, which returns the Luxor Sandbox SDK `Session`.

## License

MIT

---

[Sandbox providers](https://www.computesdk.com/providers/sandboxes) · [Sandbox Router](https://www.computesdk.com/sandbox-router)
