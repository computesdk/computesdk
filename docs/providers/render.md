---
description: >-
  Render provider for ComputeSDK - Render Sandboxes (public beta) with native
  command streaming, file transfer and snapshots.
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

# Render

[Render](https://render.com/docs/sandboxes) provider for ComputeSDK - Render Sandboxes (public beta): isolated Linux environments with native command streaming, file transfer and snapshots.

## Installation & Setup

```bash
npm install @computesdk/render
```

Create an API key on your Account Settings page in the [Render Dashboard](https://dashboard.render.com), and copy your workspace ID (`tea-...`) from your workspace's Settings page. Then add both to a `.env` file:

```bash
RENDER_API_KEY=your_render_api_key
RENDER_WORKSPACE_ID=tea-xxxxxxxxxxxxxxxxxxxx
```

## Usage

```typescript
import { compute } from 'computesdk';
import { render } from '@computesdk/render';

compute.setConfig({
  provider: render({
    apiKey: process.env.RENDER_API_KEY,
    workspaceId: process.env.RENDER_WORKSPACE_ID,
  }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('echo "Hello from Render!"');
console.log(result.stdout);

await sandbox.destroy();
```

Or call the provider factory directly:

```typescript
import { render } from '@computesdk/render';

const sdk = render({});

const sandbox = await sdk.sandbox.create({ plan: '2c-4g', timeout: 30 * 60 * 1000 });

// Output streams in as the command runs
await sandbox.runCommand('for i in 1 2 3; do echo $i; sleep 1; done', {
  onStdout: (chunk) => process.stdout.write(chunk),
});

await sandbox.filesystem.writeFile('/tmp/hello.sh', 'echo $((6 * 7))');
console.log((await sandbox.runCommand('sh /tmp/hello.sh')).stdout); // "42\n"

// Runtime snapshot: filesystem plus memory. Restore it into a new sandbox.
const snapshot = await sdk.snapshot.create(sandbox.sandboxId, { name: 'checkpoint' });
const copy = await sdk.sandbox.create({ snapshotId: snapshot.id });

await copy.destroy();
await sandbox.destroy();
```

## Configuration

```typescript
interface RenderConfig {
  /** Render API key - if not provided, will use RENDER_API_KEY env var */
  apiKey?: string;
  /** Workspace ID (`tea-...`) - if not provided, will use RENDER_WORKSPACE_ID env var */
  workspaceId?: string;
  /** Sandbox group for new sandboxes and snapshot lookups - defaults to the workspace's default group */
  sandboxGroupId?: string;
  /** Default compute plan, e.g. `2c-4g` - defaults to Render's `1c-2g` */
  plan?: string;
}
```

## Create Options

| Option | Maps to | Notes |
|---|---|---|
| `timeout` (ms) | `timeoutSeconds` | Maximum runtime. Rounded up to whole seconds and clamped to Render's 60 s - 30 day range. |
| `plan` | `plan` | `1c-2g` (default), `2c-4g`, `4c-8g` or `8c-16g`. |
| `envs` | `env` | Environment variables for the sandbox. |
| `name` | `name` | Sandbox name. |
| `image` / `templateId` | `image` | Custom image reference. Ignored when `snapshotId` is set. |
| `snapshotId` | `snapshotId` | Restore a snapshot into the new sandbox. |
| `sandboxGroupId` | `sandboxGroupId` | Overrides the config value. |
| `idleTimeoutSeconds` | `idleTimeoutSeconds` | Idle seconds before Render suspends the sandbox. |
| `networkPolicy` | `networkPolicy` | Passed through to Render. |

## Features

- **Command execution** with live `stdout`/`stderr` streaming, `cwd`, `env`, `timeout` and background commands
- **Filesystem**: `readFile` and `writeFile` use Render's native upload and download; `mkdir`, `readdir`, `exists` and `remove` run as shell commands
- **Snapshots**: `snapshot.create()` takes a runtime snapshot (filesystem and memory) of a running sandbox without stopping it; `snapshot.list()` and `snapshot.delete()` work on the configured sandbox group (or the workspace's default group). Restore with `sandbox.create({ snapshotId })`.
- **List**: `sandbox.list()` returns active sandboxes in the workspace (or the configured group)

## Limitations

- Render Sandboxes are in public beta, and Render documents a single region (Oregon).
- `getUrl()` throws: Render Sandboxes do not provide public URLs during the beta.
- `runCommand`'s `timeout` stops the command inside the sandbox with the `timeout` utility and reports exit code 124.
- Suspended sandboxes are reported by `getInfo()` as `stopped`; Render resumes them automatically on the next command.
- Sandboxes and snapshots in groups other than the configured one are not listed.
