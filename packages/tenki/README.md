# @computesdk/tenki

[Tenki Cloud](https://tenki.cloud) provider for ComputeSDK - run code in fast microVM sandboxes with native filesystem operations, public preview URLs, snapshots, volumes, and SSH.

## Installation

```bash
npm install @computesdk/tenki
```

## Setup

1. Sign up at [app.tenki.cloud](https://app.tenki.cloud)
2. Create an API key in your workspace settings
3. Set it as an environment variable:

```bash
export TENKI_API_KEY=tk_your_api_key
```

## Usage

### With ComputeSDK

```typescript
import { compute } from 'computesdk';
import { tenki } from '@computesdk/tenki';

compute.setConfig({ provider: tenki({ apiKey: process.env.TENKI_API_KEY }) });

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('echo "Hello from Tenki!"');
console.log(result.stdout);

await sandbox.destroy();
```

### Filesystem operations

Tenki exposes native file primitives over its data plane, so filesystem operations do not go through shell commands (no escaping hazards, works with any path or content):

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
| `apiKey` | `TENKI_API_KEY` / `TENKI_AUTH_TOKEN` | required | Tenki API key (`tk_...`) |
| `baseUrl` | `TENKI_API_URL` | `https://api.tenki.cloud` | API endpoint |
| `workspaceId` | `TENKI_WORKSPACE_ID` | auto-resolved | Workspace for new sandboxes |
| `projectId` | `TENKI_PROJECT_ID` | auto-resolved | Project for new sandboxes |
| `timeout` | - | none | Default `runCommand` timeout (ms) |
| `cpuCores` / `memoryMb` / `diskSizeGb` | - | Tenki defaults | Default sandbox resources |

When `workspaceId`/`projectId` are not set, the provider resolves them once from the API key's identity (first workspace with a project).

Per-sandbox resource overrides are accepted on `create`:

```typescript
await compute.sandbox.create({ options: { cpuCores: 4, memoryMb: 8192 } });
```

## Feature support

| Feature | Supported |
|---|---|
| Commands (`runCommand`) | Yes - via `sh -lc`, so pipes, globs, and env expansion work |
| Filesystem | Yes - native data-plane file API |
| Public URLs (`getUrl`) | Yes - per-port preview URLs |
| List / getById / destroy | Yes |
| Background commands | Yes - `{ background: true }` detaches stdio automatically |
| Custom images | Via Tenki templates (`templateId` maps to a Tenki image ref) |
| Snapshots / pause-resume | In the Tenki SDK (`@tenkicloud/sandbox`); not yet wired to provider snapshot methods |

## Notes

- `runCommand` wraps the command in `sh -lc` because Tenki's exec runs argv directly (execve, no shell).
- A long-running process started with a bare `&` would hold the exec output stream open; use `{ background: true }`, which detaches stdio for you.
- For advanced features (SSH, volumes, tunnels, git operations, snapshots), use the underlying SDK directly via `sandbox.getInstance()`, which returns the `@tenkicloud/sandbox` `Session`.

## License

MIT
