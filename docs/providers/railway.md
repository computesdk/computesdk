# Railway

Railway provider for ComputeSDK — run commands in [Railway Sandboxes](https://docs.railway.com/sandboxes), ephemeral compute environments backed by the Railway platform.

## Installation & Setup

```bash
npm install @computesdk/railway
```

> **Requires Node.js >= 22** — the underlying `railway` SDK depends on Node 22 APIs (e.g. global `WebSocket`).

Add your Railway credentials to a `.env` file:

```bash
RAILWAY_API_TOKEN=your_token
RAILWAY_ENVIRONMENT_ID=your_environment_id
```

Create the token at [railway.com/account/tokens](https://railway.com/account/tokens); find the environment ID under your Railway project's environment settings.

## Usage

```typescript
import { railway } from '@computesdk/railway';

const compute = railway({
  token: process.env.RAILWAY_API_TOKEN,
  environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Railway!"');
console.log(result.stdout); // "Hello from Railway!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface RailwayConfig {
  /** Railway API token - falls back to the RAILWAY_API_TOKEN environment variable */
  token?: string;
  /** Railway environment ID - falls back to the RAILWAY_ENVIRONMENT_ID environment variable */
  environmentId?: string;
}
```

### Supported Operations

| Method | Supported | Notes |
| --- | --- | --- |
| `create` | ✅ | Creates a Railway sandbox. Honors `envs`, `idleTimeoutMinutes`, and `networkIsolation` create options. |
| `getById` | ✅ | Returns `null` when the sandbox is not found. |
| `list` | ✅ | Connects to each listed sandbox; unreachable ones are dropped. |
| `destroy` | ✅ | Best-effort; ignores already-destroyed / unreachable sandboxes. |
| `runCommand` | ✅ | Runs via Railway's `sandbox.exec`. A signal-terminated command reports exit code `-1`. |
| `getInfo` | ✅ | |
| `getUrl` | ❌ | Throws — Railway sandboxes cannot expose ports / public URLs. Use sandbox-to-sandbox networking within a Railway environment instead. |
| `filesystem` | ✅ | Implemented over the shell (`base64`, `ls -la`, `mkdir -p`, `rm -rf`, etc.). |

### Notes

- Railway has no dedicated filesystem or port-exposure API, so `getUrl` throws and filesystem operations are shell-backed.
