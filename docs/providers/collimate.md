# Collimate

Collimate provider for ComputeSDK.

## Installation & Setup

```bash
npm install @computesdk/collimate
```

Add your Collimate credentials to a `.env` file:

```bash
COLLIMATE_API_KEY=your_collimate_api_key
```

Get your key at https://collimate.ai.

## Usage

Collimate sandboxes are created from a template, so a `templateId` is required — pass it in the provider config or in the `create()` options.

```typescript
import { collimate } from '@computesdk/collimate';

const compute = collimate({
  apiKey: process.env.COLLIMATE_API_KEY,
  templateId: 'python',
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Collimate!"');
console.log(result.stdout); // "Hello from Collimate!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface CollimateConfig {
  /** Collimate API server URL. Default: "https://api.collimate.ai" */
  serverUrl?: string;
  /** API key. Falls back to COLLIMATE_API_KEY env var. */
  apiKey?: string;
  /** Default template ID for sandbox creation. */
  templateId?: string;
  /** Default execution timeout in seconds. Default: 900 */
  timeout?: number;
}
```

### Supported Operations

| Method | Supported | Notes |
| --- | --- | --- |
| `create` | ✅ | Requires a `templateId` from config or create options. |
| `getById` | ✅ | Returns `null` when the session no longer exists. |
| `list` | ✅ | Lists sessions visible to the API key. |
| `destroy` | ✅ | Deletes the session. |
| `runCommand` | ✅ | Executes via the Collimate exec API (`bash -lc`). |
| `getInfo` | ✅ | |
| `getUrl` | ❌ | Throws — sandboxes are accessed through the exec API, not a per-port public URL. |
| `filesystem` | ✅ | Implemented against the exec API (`writeFile` uploads file specs; reads/dirs use shell commands). |

### Notes

- `timeout` is expressed in **seconds** (default 900) and is converted to milliseconds internally.
- `getUrl` is not supported and throws for the requested port.
