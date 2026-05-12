# @computesdk/k8s

Kubernetes provider for ComputeSDK.

Run each sandbox as a Pod in your cluster, execute code/commands with `pods/exec`, and expose app ports through a Service.

## Installation

```bash
npm install @computesdk/k8s
```

## Quick Start

```ts
import { k8s } from '@computesdk/k8s';

const compute = k8s({
  namespace: 'default',
  runtime: 'node',
});

const sandbox = await compute.sandbox.create();

const result = await sandbox.runCommand('node -e "console.log(\"hello from k8s\")"');
console.log(result.stdout);

await sandbox.destroy();
```

## Configuration

```ts
interface K8sConfig {
  kubeConfigPath?: string;
  context?: string;
  namespace?: string;
  image?: string;
  runtime?: 'node' | 'python' | 'deno' | 'bun';
  timeout?: number;
  serviceType?: 'ClusterIP' | 'NodePort';
  podNamePrefix?: string;
  ttlSeconds?: number;
  urlTemplate?: string;
}
```

## Notes

- Sandboxes are labeled with `computesdk.io/managed=true`.
- `getUrl` returns an internal cluster URL by default.
- Set `serviceType: 'NodePort'` to return a localhost node port URL when available.
