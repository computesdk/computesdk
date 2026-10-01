# @computesdk/docker-sandboxes

Docker Sandboxes provider for ComputeSDK: cloud microVM sandboxes from Docker, through the official [`@docker/sandboxes`](https://www.npmjs.com/package/@docker/sandboxes) SDK.

## Installation

```bash
npm install @computesdk/docker-sandboxes
```

## Setup

Your Docker account needs Docker Sandboxes access. Authenticate with a Docker personal or organization access token:

```bash
export DOCKER_SANDBOXES_USERNAME=your_docker_username
export DOCKER_SANDBOXES_TOKEN=your_access_token
```

## Usage

```typescript
import { dockerSandboxes } from '@computesdk/docker-sandboxes';

const compute = dockerSandboxes({});
const sandbox = await compute.sandbox.create({ templateId: 'node:22' });

const result = await sandbox.runCommand('node -v');
console.log(result.stdout);

await sandbox.destroy();
```

## Configuration

| Option | Environment variable | Description |
|---|---|---|
| `username` | `DOCKER_SANDBOXES_USERNAME` | Docker username or organization |
| `token` | `DOCKER_SANDBOXES_TOKEN` | Docker personal or organization access token |
| `image` | `DOCKER_SANDBOXES_IMAGE` | Image used when `create()` gets no `templateId` or `snapshotId` |
| `timeout` | | Sandbox lifetime in milliseconds (default 300000) |

`templateId` and `snapshotId` both select the sandbox image: an `images/...` name for a saved image or snapshot, or a registry reference such as `node:22`. Providers built with the same credentials share one SDK client, so the token exchange happens once per process.

## Supported

- Sandbox create, get, list and destroy
- `runCommand`, with `cwd`, `env`, `timeout` and `background`

Not supported yet: filesystem methods, `getUrl`, snapshots and templates.
