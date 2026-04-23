# Namespace

Namespace provider for ComputeSDK - Deploy and manage containerized sandboxes on Namespace's cloud infrastructure.

## Installation & Setup

```bash
npm install @computesdk/namespace
```

Add your Namespace credentials to a `.env` file:

```bash
NSC_TOKEN=your_namespace_nsc_token
```

## Usage

```typescript
import { namespace } from '@computesdk/namespace';

const compute = namespace({
  token: process.env.NSC_TOKEN,
});

// Create a new sandbox
const sandbox = await compute.sandbox.create();
console.log(`Sandbox created: ${sandbox.sandboxId}`);

// Get sandbox info
const info = await sandbox.getInfo();
console.log(`Sandbox status: ${info.status}`);

// Clean up when done
await sandbox.destroy();
```

### Customizing Instance Resources

You can customize the compute resources allocated to your sandboxes:

```typescript
const compute = namespace({
  token: process.env.NSC_TOKEN,
  virtualCpu: 4,
  memoryMegabytes: 8192,
});

const sandbox = await compute.sandbox.create();
```

### Configuration Reference

| Option | Environment Variable | Required | Description |
|--------|---------------------|----------|-------------|
| `token` | `NSC_TOKEN` | Yes | Your Namespace API token |
| `virtualCpu` | - | No | Number of virtual CPU cores (default: 2) |
| `memoryMegabytes` | - | No | Memory allocation in MB (default: 4096) |
| `machineArch` | - | No | Machine architecture (default: 'amd64') |
| `os` | - | No | Operating system (default: 'linux') |

```typescript
interface NamespaceConfig {
  /** Namespace API token - if not provided, uses NSC_TOKEN env var */
  token?: string;
  /** Virtual CPU cores for the instance (default: 2) */
  virtualCpu?: number;
  /** Memory in megabytes for the instance (default: 4096) */
  memoryMegabytes?: number;
  /** Machine architecture (default: 'amd64') */
  machineArch?: string;
  /** Operating system (default: 'linux') */
  os?: string;
}
```

## Next Steps

- Learn about [sandbox lifecycle management](/docs/reference/computesandbox)
- Explore [Sandbox methods](/docs/reference/sandbox)
- View the [@computesdk/namespace package](https://github.com/computesdk/computesdk/blob/main/packages/namespace/README.md)
