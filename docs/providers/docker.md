# Docker

Docker provider for ComputeSDK — local containerized sandboxes (Python or Node.js) for development and testing.

## Installation & Setup

```bash
npm install @computesdk/docker
```

This provider is **local** — it talks to a Docker Engine/daemon rather than a hosted API, so there are no credentials to configure. Docker must be installed and running on the host. By default the provider connects over the standard socket, falling back to `DOCKER_HOST` or `/var/run/docker.sock`.

## Usage

```typescript
import { docker } from '@computesdk/docker';

const compute = docker({
  runtime: 'python',
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Docker!"');
console.log(result.stdout); // "Hello from Docker!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface DockerConfig {
  /** Connection to the Docker daemon (exactly what dockerode accepts). Defaults to socket / DOCKER_HOST. */
  connection?: DockerConnection;
  /** Default image runtime identifier, e.g. 'python' or 'node'. Defaults to 'python'. */
  runtime?: string;
  /** Reported timeout in ms. Defaults to 300000 (5 minutes). */
  timeout?: number;
  /** Default image & pull policy for sandboxes. Defaults to python:3.11-slim / ifNotPresent. */
  image: DockerImage;
  /** Declarative container defaults (workdir, env, ports, resources, etc.). */
  container?: ContainerDefaults;
  /** Raw dockerode container create options merged last. */
  createOptions?: ContainerCreateOptions;
  /** Raw dockerode container start options. */
  startOptions?: ContainerStartOptions;
  /** When the provider should clean up containers it created ('always' | 'onSuccess' | 'never'). */
  cleanup?: CleanupPolicy;
  /** Stream container logs. Defaults to false. */
  streamLogs?: boolean;
}

interface DockerImage {
  /** Image reference, e.g. 'python:3.11-slim'. */
  name: string;
  /** Pull strategy: 'always' | 'ifNotPresent' | 'never'. Defaults to 'ifNotPresent'. */
  pullPolicy?: PullPolicy;
  /** Auth for pulling private images (Engine API AuthConfig shape). */
  auth?: RegistryAuth;
}
```

The provider ships sensible defaults (`defaultDockerConfig`) that are merged with your config, so `docker()` with no arguments works out of the box using `python:3.11-slim` with a `/workspace` working directory and a 512 MB memory limit.

### Supported Operations

| Method | Supported | Notes |
| --- | --- | --- |
| `create` | ✅ | Only `'python'` or `'node'` runtimes are supported; any other value throws. Pulls the image (per `pullPolicy`) and starts a keep-alive container. |
| `getById` | ✅ | Resolves a container by id; returns `null` if it does not exist. |
| `list` | ✅ | Lists containers labeled `com.computesdk.sandbox`. |
| `destroy` | ✅ | Stops and force-removes the container. |
| `runCommand` | ✅ | Executes via `docker exec` (`/bin/sh -c`). |
| `getInfo` | ✅ | |
| `getUrl` | ✅ | Builds a URL from the container's published port bindings, or falls back to the container IP. Requires the port to be exposed via `container.ports`. |
| `filesystem` | ✅ | Implemented via shell commands inside the container. |

### Notes

- Runtime is limited to `'python'` (default `python:3.11-slim`) or `'node'` (default `node:20-alpine`). Passing any other runtime throws.
- Containers are launched with a keep-alive command so they stay running for exec, filesystem, and background use.
- `getUrl` reads published port bindings; set `container.ports` in the config to expose a port on the host.
