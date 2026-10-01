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
const sandbox = await compute.sandbox.create({ templateId: 'images/tmpl_...' });

const result = await sandbox.runCommand('node -v');
console.log(result.stdout);

await sandbox.destroy();
```

## Configuration

| Option | Environment variable | Description |
|---|---|---|
| `username` | `DOCKER_SANDBOXES_USERNAME` | Docker username or organization |
| `token` | `DOCKER_SANDBOXES_TOKEN` | Docker personal or organization access token |
| `image` | `DOCKER_SANDBOXES_IMAGE` | Snapshot template used when `create()` gets no `templateId` or `snapshotId` |
| `timeout` | | Sandbox lifetime in milliseconds (default 300000) |

`templateId` and `snapshotId` both take a snapshot template name (`images/...`). Registry images are not accepted: they would be pulled on every create. Providers built with the same credentials share one SDK client, so the token exchange happens once per process.

## Supported

- Sandbox create, get, list and destroy
- `runCommand`, with `cwd`, `env`, `timeout` and `background`

Not supported yet: filesystem methods, `getUrl`, snapshots and templates.
