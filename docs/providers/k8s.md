# Kubernetes

Kubernetes provider for ComputeSDK.

## Installation & Setup

```bash
npm install @computesdk/k8s
```

The provider uses your current kubeconfig context by default (`~/.kube/config`).

## Usage

```typescript
import { k8s } from '@computesdk/k8s';

const compute = k8s({
  namespace: 'default',
  runtime: 'node',
});

const sandbox = await compute.sandbox.create();
const result = await sandbox.runCommand('node -e "console.log(\"Hello from k8s\")"');
console.log(result.stdout);
await sandbox.destroy();
```

### Configuration Options

```typescript
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

Note: In this MVP, `getUrl` uses `urlTemplate` for URL construction and does not provision Kubernetes Services automatically.
