---
description: >-
  Set up the Docker Sandboxes provider for ComputeSDK, configure your Docker
  access token, and create sandboxes from snapshot templates to run commands.
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
---

# Docker Sandboxes

Docker Sandboxes provider for ComputeSDK: cloud microVM sandboxes from Docker, through the official `@docker/sandboxes` SDK.

## Installation & Setup

```bash
npm install @computesdk/docker-sandboxes
```

Add your Docker credentials to a `.env` file. Your Docker account needs Docker Sandboxes access.

```bash
DOCKER_SANDBOXES_USERNAME=your_docker_username
DOCKER_SANDBOXES_TOKEN=your_docker_access_token
DOCKER_SANDBOXES_IMAGE=images/your_snapshot_template
```

> **Note:** Sandboxes start from a snapshot template (`images/...`). Registry images are not accepted.

## Usage

```typescript
import { dockerSandboxes } from '@computesdk/docker-sandboxes';

const compute = dockerSandboxes({
  username: process.env.DOCKER_SANDBOXES_USERNAME,
  token: process.env.DOCKER_SANDBOXES_TOKEN,
});

// Create sandbox from a snapshot template
const sandbox = await compute.sandbox.create({ templateId: 'images/your_snapshot_template' });

// Run a command
const result = await sandbox.runCommand('echo "Hello from Docker Sandboxes!"');
console.log(result.stdout); // "Hello from Docker Sandboxes!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface DockerSandboxesConfig {
  /** Docker username or organization - falls back to DOCKER_SANDBOXES_USERNAME */
  username?: string;
  /** Docker personal or organization access token - falls back to DOCKER_SANDBOXES_TOKEN */
  token?: string;
  /** Snapshot template used when create() gets no templateId or snapshotId - falls back to DOCKER_SANDBOXES_IMAGE */
  image?: string;
  /** Sandbox lifetime in milliseconds */
  timeout?: number;
}
```
