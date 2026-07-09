# Cloud Run

Google Cloud Run Sandboxes provider for ComputeSDK.

## Installation & Setup

```bash
npm install @computesdk/cloud-run
```

The provider works in two modes:

- **Remote mode** — connect to a deployed Cloud Run gateway service. Set both `CLOUD_RUN_SANDBOX_URL` and `CLOUD_RUN_SANDBOX_SECRET`:

```bash
CLOUD_RUN_SANDBOX_URL=https://your-gateway-xyz.run.app
CLOUD_RUN_SANDBOX_SECRET=your_shared_secret
# Optional: Google-signed identity token for IAM-authenticated services
CLOUD_RUN_AUTH_TOKEN=your_identity_token
```

- **Direct mode** — run your app inside a Cloud Run service deployed with `gcloud beta run deploy --sandbox-launcher`, and the provider drives the in-container `sandbox` CLI (default `/usr/local/gcp/bin/sandbox`). Override the binary with `CLOUD_RUN_SANDBOX_BINARY`.

Remote mode is selected automatically when both `sandboxUrl` and `sandboxSecret` are set; otherwise the provider runs in direct mode.

## Usage

```typescript
import { cloudRun } from '@computesdk/cloud-run';

const compute = cloudRun({
  sandboxUrl: process.env.CLOUD_RUN_SANDBOX_URL,
  sandboxSecret: process.env.CLOUD_RUN_SANDBOX_SECRET,
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from Cloud Run!"');
console.log(result.stdout); // "Hello from Cloud Run!"

// Clean up
await sandbox.destroy();
```

### Configuration Options

```typescript
interface CloudRunConfig {
  /** URL of the deployed Cloud Run gateway service for remote mode. */
  sandboxUrl?: string;
  /** Shared bearer token for the deployed Cloud Run gateway service. */
  sandboxSecret?: string;
  /** Optional Google-signed identity token for Cloud Run services that require IAM auth. */
  gatewayAuthToken?: string;
  /** Path to the Cloud Run sandbox binary. Defaults to CLOUD_RUN_SANDBOX_BINARY or /usr/local/gcp/bin/sandbox. */
  sandboxBinary?: string;
  /** Sandbox CLI mode. Cloud Run's CLI defaults this to local. */
  mode?: 'local' | 'container';
  /** Allow network egress from sandboxed commands. GCP service account access remains blocked by Cloud Run. */
  allowEgress?: boolean;
  /** Root filesystem to expose to sandboxes. Defaults to /. */
  rootfs?: string;
  /** Working directory for newly-created persistent sandbox sessions. */
  workdir?: string;
  /** Container template name for Cloud Run multi-container services. */
  template?: string;
  /** Writable persistent host path shared across executions. */
  persistDir?: string;
  /** Writable overlay directory. Caller is responsible for cleanup. */
  overlayDir?: string;
  /** Allow mounted filesystems to be writable. */
  write?: boolean;
  /** Bind mounts to attach to the sandbox. */
  mounts?: CloudRunMount[];
  /** Environment variables applied when the persistent sandbox starts. */
  env?: Record<string, string>;
  /** Extra args passed before the sandbox subcommand, e.g. global debug flags. */
  globalArgs?: string[];
  /** Extra args passed to `sandbox do`. */
  runArgs?: string[];
}

interface CloudRunMount {
  type?: 'bind';
  src: string;
  dst: string;
}
```

### Supported Operations

| Method | Supported | Notes |
| --- | --- | --- |
| `create` | ✅ | Direct mode verifies the sandbox binary exists; remote mode registers a gateway-backed handle. |
| `getById` | ✅ | Remote mode checks the gateway `/v1/sandbox/info` endpoint. |
| `list` | ✅ | Returns sandboxes tracked in-process. |
| `destroy` | ✅ | Remote mode calls the gateway; direct mode drops the in-process handle. |
| `runCommand` | ✅ | Direct mode spawns the `sandbox do` CLI; remote mode posts to the gateway exec endpoint. |
| `getInfo` | ✅ | |
| `getUrl` | ❌ | Throws — Cloud Run Sandboxes do not expose per-sandbox ports through the sandbox CLI. |
| `filesystem` | ✅ | Direct mode implements FS via shell commands; remote mode uses dedicated gateway endpoints. |

### Notes

- Default command timeout is 300,000 ms (5 minutes).
- Direct mode requires the service to be deployed with `gcloud beta run deploy --sandbox-launcher`, or the sandbox binary check will fail.
- `getUrl` is not supported and throws for the requested port.
