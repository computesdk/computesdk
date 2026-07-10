---
description: >-
  Use the Google Cloud Run provider for ComputeSDK to run sandboxed commands in
  remote or direct mode, with ephemeral or stateful sandboxes, gateway auth, and
  sandbox CLI configuration.
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

# Cloud Run

Use the Google Cloud Run sandbox provider for ComputeSDK to run isolated commands and filesystem operations inside Cloud Run. Choose remote mode for a deployed gateway, or direct mode for in-container sandbox CLI control.

## Install and set up the Cloud Run provider

```bash
npm install @computesdk/cloud-run
```

The Google Cloud Run provider works in two modes:

* **Remote mode** — connect to a deployed Cloud Run gateway service. Set both `CLOUD_RUN_SANDBOX_URL` and `CLOUD_RUN_SANDBOX_SECRET`:

```bash
CLOUD_RUN_SANDBOX_URL=https://your-gateway-xyz.run.app
CLOUD_RUN_SANDBOX_SECRET=your_shared_secret
# Optional: Google-signed identity token for IAM-authenticated services
CLOUD_RUN_AUTH_TOKEN=your_identity_token
```

* **Direct mode** — run your app inside a Cloud Run service deployed with `gcloud beta run deploy --sandbox-launcher`, and the provider drives the in-container `sandbox` CLI (default `/usr/local/gcp/bin/sandbox`). Override the binary with `CLOUD_RUN_SANDBOX_BINARY`.

Remote mode is selected automatically when both `sandboxUrl` and `sandboxSecret` are set; otherwise the provider runs in direct mode.

Cloud Run supports two execution modes for sandbox sessions:

* **Ephemeral mode** (default) — `create()` creates a local logical handle only, `runCommand()` uses `sandbox do`, and `destroy()` removes local bookkeeping only.
* **Stateful mode** — set `executionMode: 'stateful'` to have `create()` call `sandbox run <id> --detach`, `runCommand()` call `sandbox exec <id>`, and `destroy()` call `sandbox delete <id>`.

| SDK method     | Ephemeral mode (default)             | Stateful mode                               |
| -------------- | ------------------------------------ | ------------------------------------------- |
| `create()`     | Local logical handle only            | `sandbox run <id> --detach`                 |
| `runCommand()` | `sandbox do -- /bin/sh -c <command>` | `sandbox exec <id> -- /bin/sh -c <command>` |
| `destroy()`    | Local bookkeeping only               | `sandbox delete <id>`                       |
| `filesystem`   | Per-operation `sandbox do`           | Per-operation `sandbox exec <id>`           |

## Use the Cloud Run provider

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

### Cloud Run configuration options

```typescript
interface CloudRunConfig {
  /** URL of the deployed Cloud Run gateway service for remote mode. */
  sandboxUrl?: string;
  /** Shared bearer token for the deployed Cloud Run gateway service. */
  sandboxSecret?: string;
  /** Optional Google-signed identity token for Cloud Run services that require IAM auth. */
  gatewayAuthToken?: string;
  /** Execution mode. Ephemeral uses `sandbox do`; stateful uses `sandbox run`, `exec`, and `delete`. Defaults to ephemeral. */
  executionMode?: 'ephemeral' | 'stateful';
  /** Path to the Cloud Run sandbox binary. Defaults to CLOUD_RUN_SANDBOX_BINARY or /usr/local/gcp/bin/sandbox. */
  sandboxBinary?: string;
  /** Sandbox CLI mode. Cloud Run's CLI defaults this to local. */
  mode?: 'local' | 'container';
  /** Allow network egress from sandboxed commands. GCP service account access remains blocked by Cloud Run. */
  allowEgress?: boolean;
  /** Root filesystem to expose to sandboxes. Defaults to /. */
  rootfs?: string;
  /** Working directory for sandboxed commands or newly-created stateful sessions. */
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
  /** Environment variables applied to sandboxed commands or newly-created stateful sessions. */
  env?: Record<string, string>;
  /** Extra args passed before the sandbox subcommand, e.g. global debug flags. */
  globalArgs?: string[];
  /** Extra args passed to `sandbox do` and `sandbox run`. */
  runArgs?: string[];
  /** Extra args passed to `sandbox exec` in stateful mode. */
  execArgs?: string[];
}

interface CloudRunMount {
  type?: 'bind';
  src: string;
  dst: string;
}
```

### Supported ComputeSDK operations

| Method       | Supported | Notes                                                                                                |
| ------------ | --------- | ---------------------------------------------------------------------------------------------------- |
| `create`     | ✅         | Ephemeral mode creates a logical handle; stateful mode starts a detached sandbox with `sandbox run`. |
| `getById`    | ✅         | Remote mode checks the gateway `/v1/sandbox/info` endpoint.                                          |
| `list`       | ✅         | Returns sandboxes tracked in-process.                                                                |
| `destroy`    | ✅         | Ephemeral mode drops the handle; stateful mode deletes the detached sandbox.                         |
| `runCommand` | ✅         | Uses `sandbox do` in ephemeral mode and `sandbox exec` in stateful mode.                             |
| `getInfo`    | ✅         |                                                                                                      |
| `getUrl`     | ❌         | Throws — Cloud Run Sandboxes do not expose per-sandbox ports through the sandbox CLI.                |
| `filesystem` | ✅         | Uses `sandbox do` in ephemeral mode and `sandbox exec` in stateful mode.                             |

### Cloud Run notes and limitations

* Default command timeout is 300,000 ms (5 minutes).
* Direct mode requires the service to be deployed with `gcloud beta run deploy --sandbox-launcher`, or the sandbox binary check will fail.
* `getUrl` is not supported and throws for the requested port.
