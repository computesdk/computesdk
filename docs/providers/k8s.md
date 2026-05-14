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
  kubeConfigRaw?: string;
  context?: string;
  namespace?: string;
  image?: string;
  runtime?: 'node' | 'python';
  timeout?: number;
  serviceType?: 'ClusterIP' | 'NodePort';
  podNamePrefix?: string;
  urlTemplate?: string;
}
```

Kubeconfig loading precedence:
1. `kubeConfigRaw`
2. `KUBECONFIG_B64` (base64-encoded kubeconfig)
3. `kubeConfigPath`
4. default kubeconfig resolution

Note: In this MVP, `getUrl` uses `urlTemplate` for URL construction and does not provision Kubernetes Services automatically.
