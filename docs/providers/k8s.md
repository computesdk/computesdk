# Kubernetes

Kubernetes provider for ComputeSDK — run each sandbox as a Pod in your cluster and execute commands via `pods/exec`.

## Installation

```bash
npm install @computesdk/k8s
```

## Setup

The provider uses your current kubeconfig context by default. It calls `loadFromDefault()` from `@kubernetes/client-node`, which reads `$KUBECONFIG` if set, otherwise `~/.kube/config`. Override with `kubeConfigPath` or `context` in the provider config if you need to target a specific cluster.

The identity used by your kubeconfig needs the following RBAC in the target namespace:

| Resource | Verbs |
|---|---|
| `pods` | `create`, `get`, `list`, `delete` |
| `pods/exec` | `create` |
| `services` | `delete` |

Local clusters (kind, k3d, minikube, Docker Desktop) grant cluster-admin by default and need no extra setup.

## Usage

```typescript
import { k8s } from '@computesdk/k8s';

const compute = k8s({
  namespace: 'default',
  runtime: 'node',
});

// Create sandbox
const sandbox = await compute.sandbox.create();

// Run a command
const result = await sandbox.runCommand('echo "Hello from k8s!"');
console.log(result.stdout); // "Hello from k8s!"

// Clean up
await sandbox.destroy();
```

### Run Commands

```typescript
const result = await sandbox.runCommand('ls -la /');
console.log(result.stdout);

// Pipes, redirects, cwd, env, background
await sandbox.runCommand('node app.js', {
  cwd: '/app',
  env: { NODE_ENV: 'production' },
});

await sandbox.runCommand('python server.py', { background: true });
```

### Environment Variables

Pass environment variables to the Pod at creation time:

```typescript
const sandbox = await compute.sandbox.create({
  envs: {
    API_KEY: 'your-api-key',
    DATABASE_URL: 'postgresql://localhost:5432/mydb',
  },
});
```

These are set on the Pod's container spec and available to every command in the sandbox.

### Port Forwarding

`getUrl` is template-based in this MVP — set `urlTemplate` to construct routable URLs through your own ingress, gateway, or DNS pattern. The provider substitutes these placeholders:

| Placeholder | Value |
|---|---|
| `{protocol}` | From the `protocol` option (default `http`) |
| `{service}` | `<pod-name>-svc` |
| `{namespace}` | Pod namespace |
| `{port}` | From the `port` option |

```typescript
const compute = k8s({
  urlTemplate: '{protocol}://{service}.{namespace}.svc.cluster.local:{port}',
});

const sandbox = await compute.sandbox.create();
const url = await sandbox.getUrl({ port: 3000 });
// http://computesdk-sbx-abc123-svc.default.svc.cluster.local:3000
```

If `urlTemplate` is not set, `getUrl` returns a placeholder URL ending in `.invalid` so misconfiguration is obvious.

### Configuration Options

```typescript
interface K8sConfig {
  /** Path to kubeconfig file - if not set, uses $KUBECONFIG or ~/.kube/config */
  kubeConfigPath?: string;
  /** Raw kubeconfig YAML/JSON string - takes precedence over path-based loading */
  kubeConfigRaw?: string;
  /** Kubeconfig context to use - defaults to the current-context */
  context?: string;
  /** Target namespace for created Pods - defaults to "default" */
  namespace?: string;
  /** Container image - defaults to node:20-alpine or python:3.11-slim based on runtime */
  image?: string;
  /** Runtime - defaults to "node" */
  runtime?: 'node' | 'python';
  /** Time to wait for Pod to reach Running state, in ms - defaults to 120000 */
  timeout?: number;
  /** Service type used when constructing URLs - defaults to "ClusterIP" */
  serviceType?: 'ClusterIP' | 'NodePort';
  /** Prefix for generated Pod names - defaults to "computesdk-sbx" */
  podNamePrefix?: string;
  /** URL template for getUrl - see Port Forwarding section */
  urlTemplate?: string;
}
```

Kubeconfig loading precedence:
1. `kubeConfigRaw`
2. `KUBECONFIG_B64` (base64-encoded kubeconfig)
3. `kubeConfigPath`
4. default kubeconfig resolution

## Limitations

- Filesystem methods are not implemented in this MVP — use `runCommand` with `cat`, `tee`, etc. to read and write files.
- `getUrl` does not provision Kubernetes Services automatically. Set `urlTemplate` to match your existing routing setup.
- Pod resource requests and limits are fixed (250m / 256Mi requests, 1 CPU / 1Gi limits).
