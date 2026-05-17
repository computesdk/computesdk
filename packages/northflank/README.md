# @computesdk/northflank

Northflank provider for ComputeSDK.

Each sandbox is a deployment service in your Northflank project. Commands run in the container via Northflank's exec API; ports are exposed through the service's public DNS.

## Installation

```bash
npm install @computesdk/northflank
```

## Setup

1. Get your API token: **Team settings → API → Tokens → Create API token**
2. Create (or pick) a Northflank project
3. Set environment variables:

```bash
export NORTHFLANK_TOKEN=your_api_token_here
export NORTHFLANK_PROJECT_ID=your_project_id
```

## Quick Start

```ts
import { northflank } from '@computesdk/northflank';

const compute = northflank({
  token: process.env.NORTHFLANK_TOKEN!,
  projectId: process.env.NORTHFLANK_PROJECT_ID!,
  runtime: 'node',
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand(`node -e "console.log('hello from northflank')"`);
console.log(result.stdout);

await sandbox.destroy();
```

## Configuration

```ts
interface NorthflankConfig {
  /** Northflank API token */
  token: string;
  /** Project ID (slug, e.g. "my-project") */
  projectId: string;
  /** Team ID — required for organization API tokens */
  teamId?: string;
  /** API host — defaults to https://api.northflank.com */
  host?: string;
  /** Service name prefix used to identify managed sandboxes — defaults to "computesdk-" */
  servicePrefix?: string;
  /** Container image — overrides the default for the runtime */
  image?: string;
  /** Default runtime when none is passed to create() — "node" | "python" */
  runtime?: 'node' | 'python';
  /** Northflank deployment plan — defaults to "nf-compute-50" */
  deploymentPlan?: string;
  /** Default ports to expose on every sandbox */
  ports?: { name: string; internalPort: number; public?: boolean; protocol?: 'HTTP' | 'HTTP/2' | 'TCP' | 'UDP' }[];
  /** Deployment readiness timeout in ms (default: 120000) */
  timeout?: number;
  /** Deploy from a Northflank build service instead of an external image */
  internalDeployment?: { id: string; branch?: string; buildSHA?: string };
}
```

## Internal deployments (recommended for production)

By default, sandboxes pull `node:20-slim` / `python:3.11-slim` (or your `image`) from an external registry. For production workloads we recommend deploying from a **Northflank build service** in the same project — internal deployments are optimized for faster cold starts and don't depend on external registries.

```ts
const compute = northflank({
  token: process.env.NORTHFLANK_TOKEN!,
  projectId: process.env.NORTHFLANK_PROJECT_ID!,
  internalDeployment: {
    id: 'my-build-service',   // build service ID in the same project
    branch: 'main',           // optional — defaults to "main"
    buildSHA: 'latest',       // optional — defaults to "latest"
  },
});
```

You can also pass `internalDeployment` on a per-sandbox basis to `create()`; it overrides the config-level value. External images keep working — `internalDeployment` is just the recommended path.

## Per-sandbox options

`create()` accepts these provider-specific options on top of the standard ones:

```ts
await compute.sandbox.create({
  runtime: 'python',                    // overrides config.runtime
  image: 'my-registry/custom:tag',      // overrides config.image and the runtime default
  ports: [{ name: 'app', internalPort: 3000 }], // overrides config.ports
  deploymentPlan: 'nf-compute-200',     // overrides config.deploymentPlan
  timeout: 180000,                      // overrides config.timeout
  envs: { LOG_LEVEL: 'debug' },         // merged into runtimeEnvironment
  name: 'my-sandbox',                   // service name (auto-prefixed)
});
```

Image defaults: `node:20-slim`, `python:3.11-slim`.

## Running code

There is no `runCode` — invoke the runtime directly through `runCommand`:

```ts
// Python
const py = await sandbox.runCommand(`python -c "import json; print(json.dumps({'hello': 'world'}))"`);

// Node.js
const js = await sandbox.runCommand(`node -e "console.log(JSON.stringify({hello: 'world'}))"`);
```

For multi-line scripts, write the file first and then invoke it:

```ts
await sandbox.filesystem.writeFile('/tmp/script.py', `
import pandas as pd
print(pd.__version__)
`);
const result = await sandbox.runCommand('python /tmp/script.py');
```

## Commands

```ts
// Simple command
await sandbox.runCommand('ls -la');

// Working directory
await sandbox.runCommand('npm install', { cwd: '/app' });

// Environment variables
await sandbox.runCommand('echo $MY_VAR', { env: { MY_VAR: 'hello' } });

// Background execution
await sandbox.runCommand('python server.py', { background: true });
```

## Filesystem

```ts
await sandbox.filesystem.writeFile('/tmp/hello.txt', 'hello world');
const content = await sandbox.filesystem.readFile('/tmp/hello.txt');

await sandbox.filesystem.mkdir('/tmp/data');
const entries = await sandbox.filesystem.readdir('/tmp');

const exists = await sandbox.filesystem.exists('/tmp/hello.txt');
await sandbox.filesystem.remove('/tmp/hello.txt');
```

All paths are shell-escaped before being interpolated into exec commands.

## Sandbox management

```ts
// List managed sandboxes (filtered by servicePrefix)
const sandboxes = await compute.sandbox.list();

// Look up by service ID (slug of the service name)
const sandbox = await compute.sandbox.getById('computesdk-1700000000-abc123');

// Inspect — refetches the live deployment status
const info = await sandbox.getInfo();
console.log(info.id, info.status, info.createdAt);

// Get the public URL for a port — exposes it dynamically if not already public
const url = await sandbox.getUrl({ port: 3000 });

await sandbox.destroy();
```

## Notes

- Services are named `<servicePrefix><timestamp>-<random>` (or `<servicePrefix><name>` if you pass `name`). `list`, `getById` and `destroy` only operate on services whose name starts with the prefix.
- Sandboxes are tagged via the `COMPUTESDK_RUNTIME` runtime env var. `list` skips any service that doesn't have it set to `node` or `python`.
- `create` waits for the service to become **exec-ready** (up to `timeout` ms) by spam-calling `exec` (`true`) until it succeeds — this is faster than polling `deployment.status` because the exec proxy connects to the pod *before* Kubernetes reports `COMPLETED`. The loop retries on 5xx and connection-level errors; it fast-fails on `401`/`403` (auth) and `404` (service was deleted mid-wait). If readiness times out, the orphaned service is deleted before the error is thrown.
- `getInfo` re-reads the service from the API every call — `running` means the deployment status is `COMPLETED` and the service isn't paused; `stopped` means paused, `PENDING`, or `IN_PROGRESS`; `error` means `FAILED`.
- `getUrl` will patch the service's port config to make the requested port public if it isn't already, then return its `dns`.

## Limitations

- **Startup time** — Northflank pulls and starts the image; expect tens of seconds.
- **Memory & CPU** — bounded by the chosen `deploymentPlan`.
- **File persistence** — files live in the container and are lost when the service is destroyed.

## Support

- [Northflank docs](https://northflank.com/docs)
- [ComputeSDK issues](https://github.com/computesdk/computesdk/issues)

## License

MIT
