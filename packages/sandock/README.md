# @computesdk/sandock

Sandock provider for ComputeSDK - Docker-based sandboxes for AI agents, with streaming output, filesystem access and preview URLs.

[Sandock](https://sandock.ai) runs each sandbox from a Docker image of your choice. With this package, code written against `computesdk` runs on Sandock sandboxes.

## Installation

```bash
npm install @computesdk/sandock
```

## Setup

Get an API key from your account at [sandock.ai](https://sandock.ai) and set it in the environment:

```bash
export SANDOCK_API_KEY=your_sandock_api_key
```

| Environment variable | Meaning |
|---|---|
| `SANDOCK_API_KEY` | Your API key, when `apiKey` is not passed |
| `SANDOCK_SPACE_ID` | Optional: the team space to create and look up sandboxes in, when `spaceId` is not passed. Unset, your personal space is used |
| `SANDOCK_BASE_URL` | Optional: the API to use, when `baseUrl` is not passed. Default `https://sandock.ai` |

## Quick Start

```typescript
import { compute } from 'computesdk';
import { sandock } from '@computesdk/sandock';

compute.setConfig({
  provider: sandock({ apiKey: process.env.SANDOCK_API_KEY }),
});

const sandbox = await compute.instances.create();

const result = await sandbox.runCommand('python3 -c "print(\'Hello from Sandock\')"');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'hello');
console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'));

await sandbox.destroy();
```

You can also call the provider directly:

```typescript
import { sandock } from '@computesdk/sandock';

const provider = sandock({}); // reads SANDOCK_API_KEY
const sandbox = await provider.instances.create({ image: 'python:3.12-slim', timeout: 15 * 60_000 });
```

## Configuration

```typescript
interface SandockConfig {
  /** Sandock API key - if not provided, uses SANDOCK_API_KEY */
  apiKey?: string;
  /** Sandock API URL - if not provided, uses SANDOCK_BASE_URL, then https://sandock.ai */
  baseUrl?: string;
  /** Space to create and look up sandboxes in - if not provided, uses SANDOCK_SPACE_ID, then your personal space */
  spaceId?: string;
  /** Docker image create() uses when it names none. Default: 'sandockai/sandock-code:latest' */
  image?: string;
  /** Sandbox lifetime in milliseconds when create() sets none. Default: 30 minutes, max 24 hours */
  timeout?: number;
  /** Bound on a command that sets no timeout, in milliseconds. Default: 300000 (5 minutes) */
  commandTimeout?: number;
  /** CPU shares for new sandboxes */
  cpu?: number;
  /** Memory limit for new sandboxes, in MB */
  memory?: number;
  /** Minutes until a stopped sandbox is deleted (-1: never, 0: at once). Default: 1 day */
  autoDeleteInterval?: number;
  /** A client from `sandock` (createSandockClient) to use instead of one built from apiKey and baseUrl */
  client?: SandockClient;
}
```

### Create options

| Option | Maps to |
|---|---|
| `image` / `templateId` | The Docker image to run (`image` wins when both are set) |
| `timeout` | The sandbox lifetime (Sandock `activeDeadlineSeconds`); a sandbox that reaches it is stopped |
| `envs` | Environment variables for the sandbox |
| `name` | The sandbox title shown in the Sandock dashboard |
| `cpu`, `memory` | CPU shares and memory limit (MB) |

## Features

| Capability | Supported | Notes |
|---|---|---|
| `runCommand` | ✅ | `cwd`, `env`, `timeout`, `background` |
| Live output (`onStdout` / `onStderr`) | ✅ | Native, over Sandock's SSE shell stream; a timed-out command reports exit code 124 |
| Interactive processes (`startProcess`) | ✅ | Through ComputeSDK's daemon; needs Node.js in the image (the default image has it) |
| Filesystem | ✅ | Read, write (parent directories are created), list, mkdir, exists, remove |
| `getUrl` | ✅ | Signed preview URL for the port, valid for an hour, token embedded |
| `list` / `getById` | ✅ | |
| Templates / snapshots | ❌ | Templates are Docker images; `snapshotId` throws |

`sandbox.getInstance()` returns `{ id, client, config, status, createdAt, timeout, image }`, where `client` is the `sandock` SDK client.

## Notes

- Sandock's shell API currently reports every non-zero exit status as `1`. The provider runs each command in a subshell and recovers the real exit code from a marker on stderr, which it strips again, so `exitCode` is the command's own.
- Sandock has no get-by-id endpoint yet: `getById` and `getInfo` look the sandbox up in the space's sandbox list, so they take longer in a space with many sandboxes.
- Files are read and written as UTF-8 text.

## License

MIT
