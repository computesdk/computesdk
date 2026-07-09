# @computesdk/cloud-run

Google Cloud Run Sandboxes provider for [ComputeSDK](https://computesdk.com).

Cloud Run Sandboxes are currently in beta and require your GCP project to be allow-listed by the Cloud Run team.

This package supports two modes:

- Remote mode: deploy a gateway Cloud Run service with `npx @computesdk/cloud-run`, then connect using `CLOUD_RUN_SANDBOX_URL` and `CLOUD_RUN_SANDBOX_SECRET`.
- Direct mode: run your app inside a Cloud Run service deployed with `--sandbox-launcher`, then call the in-container sandbox CLI at `/usr/local/gcp/bin/sandbox`.

## Install

```bash
npm install @computesdk/cloud-run
```

## Setup Remote Gateway

Set your GCP project and region, then run the setup command:

```bash
export CLOUD_RUN_PROJECT_ID="your-gcp-project"
export CLOUD_RUN_REGION="us-central1"

npx @computesdk/cloud-run
```

The setup command uses `gcloud` to:

- Build a small ComputeSDK gateway container.
- Deploy it to Cloud Run with `--sandbox-launcher` and `--no-cpu-throttling`.
- Configure the gateway for low-latency sandbox execution with 1 CPU, 2Gi memory, concurrency 1, session affinity, CPU boost, and 100 min/max instances.
- Allow unauthenticated Cloud Run invocation with `--allow-unauthenticated`.
- Generate a bearer token for gateway authentication.
- Print the runtime environment variables.

By default, the gateway executes each ComputeSDK command with `sandbox do`. The ComputeSDK sandbox object is a logical handle used to carry configuration such as environment variables and working directory between calls. Set `executionMode: 'stateful'` to use `sandbox run`, `sandbox exec`, and `sandbox delete` for persistent sandbox sessions.

Execution mode controls how SDK methods map to the Cloud Run sandbox CLI:

| SDK method | Ephemeral mode (default) | Stateful mode |
|---|---|---|
| `create()` | Creates a local logical handle only | Calls `sandbox run <id> --detach` |
| `runCommand()` | Calls `sandbox do -- /bin/sh -c <command>` | Calls `sandbox exec <id> -- /bin/sh -c <command>` |
| `destroy()` | Removes local bookkeeping only | Calls `sandbox delete <id>` |
| `filesystem` | Runs each operation with `sandbox do` | Runs each operation with `sandbox exec <id>` |

Add the printed values to your app environment:

```bash
CLOUD_RUN_SANDBOX_URL=https://computesdk-sandbox-...run.app
CLOUD_RUN_SANDBOX_SECRET=...
```

Prerequisites:

- Your GCP project is allow-listed for Cloud Run Sandboxes.
- `gcloud` is installed, up to date, and authenticated.
- Cloud Build and Cloud Run APIs are enabled for the project.
- Your organization policy allows public Cloud Run invokers, or callers must provide `CLOUD_RUN_AUTH_TOKEN`.

### Public Gateway Access

The remote gateway is designed to be public at the Cloud Run layer and protected by `CLOUD_RUN_SANDBOX_SECRET` for sandbox operations. Public Cloud Run access avoids requiring each SDK caller to mint a Google identity token.

The setup command passes `--allow-unauthenticated`. If your organization blocks public IAM members with `constraints/iam.allowedPolicyMemberDomains`, the deploy can succeed with an IAM warning but the service will still require Cloud Run IAM auth. In that case, either allow `allUsers` as `roles/run.invoker` for this gateway service or set `CLOUD_RUN_AUTH_TOKEN` to a Google-signed identity token for the gateway URL.

## Manual Direct Deploy

Deploy your service with the sandbox launcher enabled:

```bash
gcloud beta run deploy my-sandbox-service \
  --image=gcr.io/$PROJECT_ID/my-sandbox-service:latest \
  --region=$REGION \
  --project=$PROJECT_ID \
  --sandbox-launcher \
  --no-cpu-throttling
```

The sandbox binary is only available in Cloud Run containers with `--sandbox-launcher` enabled.

## Remote Usage

```typescript
import { cloudRun } from '@computesdk/cloud-run'

const compute = cloudRun({
  sandboxUrl: process.env.CLOUD_RUN_SANDBOX_URL,
  sandboxSecret: process.env.CLOUD_RUN_SANDBOX_SECRET,
})

const sandbox = await compute.sandbox.create()

const result = await sandbox.runCommand('echo hello')
console.log(result.stdout)

await sandbox.destroy()
```

### Stateful Execution

```typescript
import { cloudRun } from '@computesdk/cloud-run'

const compute = cloudRun({
  sandboxUrl: process.env.CLOUD_RUN_SANDBOX_URL,
  sandboxSecret: process.env.CLOUD_RUN_SANDBOX_SECRET,
  executionMode: 'stateful',
  write: true,
})

const sandbox = await compute.sandbox.create()
await sandbox.runCommand('echo hello > /tmp/hello.txt')
const result = await sandbox.runCommand('cat /tmp/hello.txt')
console.log(result.stdout)
await sandbox.destroy()
```

## Direct Usage

```typescript
import { cloudRun } from '@computesdk/cloud-run'

const compute = cloudRun({
  persistDir: '/tmp/cloud-run-sandbox',
  write: true,
})

const sandbox = await compute.sandbox.create({
  envs: { NODE_ENV: 'production' },
})

const result = await sandbox.runCommand('echo hello')
console.log(result.stdout)

await sandbox.destroy()
```

## Configuration

| Option | Env var | Default | Description |
|---|---|---|---|
| `sandboxUrl` | `CLOUD_RUN_SANDBOX_URL` | | URL of deployed gateway service for remote mode |
| `sandboxSecret` | `CLOUD_RUN_SANDBOX_SECRET` | | Bearer token for deployed gateway service |
| `gatewayAuthToken` | `CLOUD_RUN_AUTH_TOKEN` | | Optional Google identity token when Cloud Run IAM auth is enabled |
| `executionMode` | | `ephemeral` | Use `ephemeral` for `sandbox do` or `stateful` for `sandbox run`/`exec`/`delete` |
| `sandboxBinary` | `CLOUD_RUN_SANDBOX_BINARY` | `/usr/local/gcp/bin/sandbox` | Path to the Cloud Run sandbox CLI |
| `mode` | | CLI default | Sandbox CLI mode, `local` or `container` |
| `allowEgress` | | `false` | Allow sandbox network egress |
| `rootfs` | | `/` | Root filesystem exposed to sandboxes |
| `workdir` | | CLI default | Default working directory |
| `template` | | | Cloud Run container template name |
| `persistDir` | | | Host path used for persistent filesystem state |
| `overlayDir` | | | Writable overlay directory |
| `write` | | `false` | Allow mounted filesystems to be writable |
| `mounts` | | `[]` | Bind mounts passed to `--mount` |
| `env` | | `{}` | Environment variables for new sandbox sessions |
| `globalArgs` | | `[]` | Extra CLI global args |
| `runArgs` | | `[]` | Extra args for `sandbox do` and `sandbox run` |
| `execArgs` | | `[]` | Extra args for `sandbox exec` in stateful mode |

## Notes

Commands use ephemeral `sandbox do` execution by default. Filesystem writes are only preserved when your Cloud Run sandbox CLI configuration supports host-backed persistence such as `--persist-dir`. Use `executionMode: 'stateful'` when you need a detached sandbox session created with `sandbox run` and reused with `sandbox exec`.

`getUrl()` is not supported because the current Cloud Run sandbox CLI does not expose per-sandbox ports.

## CI with Workload Identity Federation

When Cloud Run IAM auth is enabled, CI needs a Google-signed ID token for the gateway URL. Some federated credentials cannot use `gcloud auth print-identity-token` directly; use IAM Credentials `generateIdToken` with a federated access token instead:

```bash
ACCESS_TOKEN="$(gcloud auth print-access-token)"
SERVICE_URL="$(gcloud run services describe computesdk-sandbox --region=$CLOUD_RUN_REGION --project=$CLOUD_RUN_PROJECT_ID --format='value(status.url)')"

CLOUD_RUN_AUTH_TOKEN="$(node -e '
const [accessToken, audience, serviceAccount] = process.argv.slice(1)
fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateIdToken`, {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ audience, includeEmail: true }),
}).then(r => r.json()).then(j => process.stdout.write(j.token))
' "$ACCESS_TOKEN" "$SERVICE_URL" "$CLOUD_RUN_SERVICE_ACCOUNT")"
```

The federated principal must be allowed to impersonate `CLOUD_RUN_SERVICE_ACCOUNT` and mint OpenID tokens for it.
