---
description: >-
  Set up the Northflank provider for ComputeSDK, pass your project credentials,
  and create deployment-backed sandboxes to run commands and expose ports.
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
tags:
  - tag: benchmarked
    primary: true
---

# Northflank

{% embed url="https://www.computesdk.com/benchmarks/sandboxes/northflank/" %}

Northflank provider for ComputeSDK — each sandbox is a deployment service in your Northflank project. Commands run in the container via Northflank's exec API; ports are exposed through the service's public DNS.

## Installation & Setup

```bash
npm install @computesdk/northflank
```

Add your Northflank credentials to a `.env` file:

```bash
NORTHFLANK_TOKEN=your_api_token
NORTHFLANK_PROJECT_ID=your_project_id
```

Create the token under **Team settings → API → Tokens → Create API token**, then create (or pick) a Northflank project for your sandboxes.

## Usage

```typescript
import { northflank } from '@computesdk/northflank';

const compute = northflank({
  token: process.env.NORTHFLANK_TOKEN!,
  projectId: process.env.NORTHFLANK_PROJECT_ID!,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Northflank!"');
console.log(result.stdout); // "Hello from Northflank!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface NorthflankConfig {
  /** Northflank API token (required) */
  token: string;
  /** Northflank project ID that services are created in (required) */
  projectId: string;
  /** Northflank team ID (optional) */
  teamId?: string;
  /** Override the API base URL - defaults to "https://api.northflank.com" */
  host?: string;
  /** Prefix for generated service names - defaults to "computesdk-" */
  servicePrefix?: string;
  /** Container image - defaults to the image for the selected runtime (node:20-slim / python:3.11-slim) */
  image?: string;
  /** Runtime label - defaults to "node" */
  runtime?: string;
  /** Northflank deployment plan - defaults to "nf-compute-50" */
  deploymentPlan?: string;
  /** Ports to expose on create - a number or a { name, internalPort, public?, protocol? } object */
  ports?: (number | { name: string; internalPort: number; public?: boolean; protocol?: 'HTTP' | 'HTTP/2' | 'TCP' | 'UDP' })[];
  /** Time to wait for the container to become exec-ready, in ms - defaults to 120000 */
  timeout?: number;
  /** Deploy from a Northflank build service instead of an external image */
  internalDeployment?: {
    /** Build service ID inside the same Northflank project */
    id: string;
    /** Branch to deploy from - defaults to "main" */
    branch?: string;
    /** Build SHA to deploy - defaults to "latest" */
    buildSHA?: string;
  };
}
```

### Supported Operations

| Method       | Supported | Notes                                                                                                                    |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `create`     | ✅         | Creates a Northflank deployment service kept alive by a long-running command.                                            |
| `getById`    | ✅         | Only returns services whose name starts with `servicePrefix` (ComputeSDK-managed).                                       |
| `list`       | ✅         | Lists ComputeSDK-managed services in the project (paginated).                                                            |
| `destroy`    | ✅         | Deletes the service; a no-op if it no longer exists.                                                                     |
| `runCommand` | ✅         | Runs via Northflank's exec API. The first exec retries until the pod is ready.                                           |
| `getInfo`    | ✅         |                                                                                                                          |
| `getUrl`     | ✅         | Exposes the port publicly and returns its Northflank DNS. Only HTTP / HTTP/2 ports can get a public URL; TCP/UDP throws. |
| `filesystem` | ✅         | `readFile`/`writeFile` use Northflank's file-copy API; other ops run as shell commands.                                  |

### Notes

* `token` and `projectId` are required — the provider does not read them from the environment automatically, so pass `process.env.NORTHFLANK_TOKEN` / `process.env.NORTHFLANK_PROJECT_ID` yourself.
* Background commands (`runCommand(cmd, { background: true })`) are launched with `nohup` and redirected to `/tmp/computesdk-bg.log`.
