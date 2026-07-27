# @computesdk/sandbox0

[Sandbox0](https://sandbox0.ai) provider for ComputeSDK. Create fast persistent sandboxes, run shell commands, and use native filesystem operations through the official Sandbox0 JavaScript SDK.

## Installation

```bash
npm install computesdk @computesdk/sandbox0
```

## Setup

Create a team API key and export it:

```bash
export SANDBOX0_TOKEN=your_sandbox0_token
```

`SANDBOX0_BASE_URL` is optional and defaults to the public Sandbox0 API at
`https://api.sandbox0.ai`. For automated team workloads, set it to the team's
home-region endpoint so requests go directly to the regional gateway.

An interactive access token can also be used by setting both
`SANDBOX0_TOKEN` and `SANDBOX0_TEAM_ID`.

## Usage

```typescript
import { compute } from 'computesdk';
import { sandbox0 } from '@computesdk/sandbox0';

compute.setConfig({
  provider: sandbox0({
    token: process.env.SANDBOX0_TOKEN,
    hardTtl: 600,
  }),
});

const sandbox = await compute.sandbox.create({
  templateId: 'default',
  memory: 256,
});

const result = await sandbox.runCommand('node --version');
console.log(result.stdout);

await sandbox.filesystem.writeFile('/tmp/hello.txt', 'Hello from Sandbox0');
console.log(await sandbox.filesystem.readFile('/tmp/hello.txt'));

await sandbox.destroy();
```

## Configuration

| Option | Environment variable | Default | Description |
|---|---|---|---|
| `token` | `SANDBOX0_TOKEN` or `SANDBOX0_API_KEY` | required | Team API key, or an access token when `teamId` is set |
| `teamId` | `SANDBOX0_TEAM_ID` | none | Team ID required with access-token authentication |
| `baseUrl` | `SANDBOX0_BASE_URL` | SDK default | Sandbox0 API endpoint |
| `templateId` | `SANDBOX0_TEMPLATE` | `default` | Template used for new sandboxes |
| `ttl` | - | platform default | Soft runtime TTL in seconds |
| `hardTtl` | - | platform default | Hard sandbox TTL in seconds |
| `memory` | - | template default | Memory in MiB or a quantity such as `1Gi` |
| `envs` | - | none | Default environment variables |
| `commandTimeout` | - | none | Default command timeout in milliseconds |

Per-create `templateId`, `snapshotId`, `memory`, `envs`, `ttl`, `hardTtl`, and `autoResume` options override provider defaults where applicable. Numeric memory values are interpreted as MiB.

## Feature support

| Feature | Supported |
|---|---|
| Create / getById / list / destroy | Yes |
| Shell commands | Yes, through `sh -lc` |
| Command `cwd`, environment, timeout, and background mode | Yes |
| Filesystem | Yes, through Sandbox0's native file API |
| Public URLs | Yes, for public services already configured on the sandbox |
| Restore from snapshot | Yes, with `snapshotId` at create time |
| Snapshot management | Use the native Sandbox0 SDK |

`destroy` is idempotent and retries short-lived throttling or server failures. Setting `hardTtl` is still recommended for automated workloads so a failed client cannot leave a sandbox indefinitely.

For Sandbox0-specific capabilities such as pause/resume, services, snapshots, volumes, and observability, call `sandbox.getInstance()` to access the native `sandbox0` SDK handle.

## License

MIT
