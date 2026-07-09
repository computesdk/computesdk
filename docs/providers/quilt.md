# Quilt

Quilt provider for ComputeSDK — tenant-scoped Linux sandboxes with exec, published HTTP/WebSocket services, shell-backed filesystem operations, and snapshots.

## Installation & Setup

```bash
npm install @computesdk/quilt
```

Add your Quilt configuration to a `.env` file. A base URL plus one credential (`apiKey` or `accessToken`) is required:

```bash
QUILT_BASE_URL=https://backend.example.com
QUILT_API_KEY=your_api_key
# or, instead of an API key:
QUILT_ACCESS_TOKEN=your_access_token
# required for snapshot operations:
QUILT_TENANT_ID=your_tenant_id
```

## Usage

```typescript
import { quilt } from '@computesdk/quilt';

const compute = quilt({
  baseUrl: process.env.QUILT_BASE_URL,
  apiKey: process.env.QUILT_API_KEY,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Quilt!"');
console.log(result.stdout); // "Hello from Quilt!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface QuiltConfig {
  /** Quilt backend base URL - falls back to QUILT_BASE_URL / QUILT_API_BASE_URL. Required. */
  baseUrl?: string;
  /** Quilt API key (sent as X-Api-Key) - falls back to QUILT_API_KEY. Provide this or accessToken. */
  apiKey?: string;
  /** Quilt access token (sent as a Bearer token) - falls back to QUILT_ACCESS_TOKEN. Provide this or apiKey. */
  accessToken?: string;
  /** Tenant ID - falls back to QUILT_TENANT_ID. Required for snapshot operations. */
  tenantId?: string;
  /** Container image - falls back to QUILT_IMAGE, then defaults to "prod" */
  image?: string;
  /** Operation timeout in ms - falls back to QUILT_TIMEOUT_MS, then defaults to 300000 */
  timeout?: number;
  /** Auth mode for published services - falls back to QUILT_PUBLISHED_SERVICE_AUTH_MODE, defaults to "service_token" */
  publishedServiceAuthMode?: 'service_token' | 'public';
  /** TTL in seconds for published services - falls back to QUILT_PUBLISHED_SERVICE_TTL_SECS */
  publishedServiceTtlSecs?: number;
  /** Poll interval for async operations in ms - falls back to QUILT_POLL_INTERVAL_MS, defaults to 1000 */
  pollIntervalMs?: number;
}
```

### Supported Operations

| Method | Supported | Notes |
| --- | --- | --- |
| `create` | ✅ | Creates a container; pass `snapshotId` in create options to clone from a snapshot instead. |
| `getById` | ✅ | Returns `null` for a missing container. |
| `list` | ✅ | Lists tenant containers (paginated). |
| `destroy` | ✅ | Deletes the container; a no-op if it no longer exists. |
| `runCommand` | ✅ | Synchronous exec via Quilt's `/exec` API. A timed-out command reports exit code `124`. |
| `getInfo` | ✅ | |
| `getUrl` | ✅ | Creates (or reuses) a published service. Supports `http`/`https` and `ws`/`wss` protocols. |
| `filesystem` | ✅ | Implemented over exec (`base64`, `ls -la`, `mkdir -p`, `rm -rf`, etc.). |
| `snapshot.create` / `list` / `delete` | ✅ | Requires `tenantId`. Snapshots are created crash-consistent with volumes excluded. |

### Notes

- A base URL and at least one credential (`apiKey` or `accessToken`) are required; the provider throws a descriptive error if either is missing.
- Snapshot operations (and cloning via `create({ snapshotId })`) require `tenantId`, sent as the `X-Tenant-Id` header.
