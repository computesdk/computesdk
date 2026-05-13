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

## Notes

- Sandboxes are labeled with `computesdk.io/managed=true`.
- `getUrl` is template-based in this MVP. Set `urlTemplate` (for example via your gateway/ingress pattern) to return a routable URL.
