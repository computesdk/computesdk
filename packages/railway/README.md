# @computesdk/railway

Railway provider for ComputeSDK - run commands in [Railway Sandboxes](https://docs.railway.com/sandboxes), ephemeral compute environments backed by the Railway platform.

## Installation

```bash
npm install @computesdk/railway
```

## Setup

1. Create a Railway API token at [railway.com/account/tokens](https://railway.com/account/tokens).
2. Find the environment ID you want sandboxes to run in (Railway project → environment settings).
3. Set the environment variables:

```bash
export RAILWAY_API_TOKEN=your_token_here
export RAILWAY_ENVIRONMENT_ID=your_environment_id_here
```

## Quick Start

Configure `compute` with the Railway provider and create a sandbox:

```typescript
import { compute } from 'computesdk';
import { railway } from '@computesdk/railway';

compute.setConfig({
  provider: railway({
    token: process.env.RAILWAY_API_TOKEN,
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
  }),
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('echo "hello from Railway"');
console.log(result.stdout);

await sandbox.destroy();
```

Alternatively, call the provider factory directly when you only need one provider:

```typescript
import { railway } from '@computesdk/railway';

const sdk = railway({ token: process.env.RAILWAY_API_TOKEN });
const sandbox = await sdk.sandbox.create();
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `RAILWAY_API_TOKEN` | Yes | Railway API token used to authenticate. |
| `RAILWAY_ENVIRONMENT_ID` | Recommended | Railway environment the sandbox runs in. |

### Config options

```typescript
railway({
  token: '...',          // defaults to RAILWAY_API_TOKEN
  environmentId: '...',  // defaults to RAILWAY_ENVIRONMENT_ID
  timeout: 300000,       // reported via getInfo(); milliseconds
});
```

## Supported Features

| Feature | Supported | Notes |
|---|---|---|
| Command execution (`runCommand`) | ✅ | Backed by `sandbox.exec`. `timeout` is mapped to Railway's `timeoutSec`. |
| Filesystem (`filesystem.*`) | ✅ | Implemented over the shell (`cat`/`base64`/`mkdir`/`ls`/`rm`) since Railway has no dedicated filesystem API. |
| List sandboxes (`list`) | ✅ | Enumerates sandboxes in the configured environment. |
| Get / destroy by ID | ✅ | Via `Sandbox.connect` / `sandbox.destroy`. |
| Port exposure (`getUrl`) | ❌ | Railway sandboxes do not expose public per-port URLs. |
| Templates / snapshots | ❌ | Railway templates are a build-time builder (`Sandbox.template()`), not an ID-addressable resource, so they are not mapped to ComputeSDK templates/snapshots. |

## Limitations

- **No port exposure.** `getUrl` throws — Railway sandboxes don't publish public URLs per port.
- **Filesystem is shell-based.** File operations run shell commands inside the sandbox, so they require a POSIX shell with `base64`, `ls`, and the usual coreutils (present on Railway's default image).
- **Templates/snapshots are not exposed.** Use the underlying `railway` SDK's `Sandbox.template()` builder directly if you need custom base images.

## License

MIT
