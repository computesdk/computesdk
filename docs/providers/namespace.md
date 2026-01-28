# Namespace

## Deploy sandboxes on Namespace with ComputeSDK

Deploy and manage containerized sandboxes on Namespace's cloud infrastructure with ComputeSDK.

---

Namespace is a cloud compute platform that provides ephemeral container instances. With ComputeSDK's Namespace provider, you can create isolated sandbox environments without managing infrastructure.

---

**Prerequisites**:

- A <a href="https://console.computesdk.com/register" target="_blank">ComputeSDK account</a> with an API key
- A <a href="https://namespace.so/" target="_blank">Namespace account</a> and `nsc token` (i.e. API key)
- Node.js 18+ installed

---

## Using ComputeSDK with Namespace
---

### Step 1: Install ComputeSDK

Install the ComputeSDK package in your application:

```bash
npm install computesdk
```

---

### Step 2: Configure environment variables

Add your credentials to a `.env` file:

```bash
# ComputeSDK credentials
COMPUTESDK_API_KEY=your_computesdk_api_key

# Namespace credentials
NSC_TOKEN=your_namespace_nsc_token
```

---

### Step 3: Create and manage sandboxes

ComputeSDK auto-detects Namespace as your provider from the environment variables:

```typescript
import { compute } from 'computesdk';

// Create a new sandbox
const sandbox = await compute.sandbox.create();
console.log(`Sandbox created: ${sandbox.sandboxId}`);

// Get sandbox info
const info = await sandbox.getInfo();
console.log(`Sandbox status: ${info.status}`);

// Clean up when done
await sandbox.destroy();
```

Your sandboxes are now running on Namespace's cloud infrastructure!

---

### Explicit provider configuration (optional)

If you prefer to configure the provider programmatically—useful for multi-provider setups or dynamic configuration—pass credentials directly:

```typescript
import { compute } from 'computesdk';

compute.setConfig({
   computesdkApiKey: process.env.COMPUTESDK_API_KEY,
   provider: 'namespace',
   namespace: {
     token: process.env.NSC_TOKEN
   }
});

const sandbox = await compute.sandbox.create();
```

---

### Configuration reference

The Namespace provider accepts the following configuration options:

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

---

### Customizing instance resources

You can customize the compute resources allocated to your sandboxes:

```typescript
import { compute } from 'computesdk';

compute.setConfig({
   computesdkApiKey: process.env.COMPUTESDK_API_KEY,
   provider: 'namespace',
   namespace: {
     token: process.env.NSC_TOKEN,
     virtualCpu: 4,
     memoryMegabytes: 8192
   }
});

const sandbox = await compute.sandbox.create();
```

---

## Next steps

- Learn about [sandbox lifecycle management](/docs/reference/computesandbox)
- Explore [Sandbox methods](/docs/reference/sandbox)
- View the [@computesdk/namespace package](https://github.com/computesdk/computesdk/blob/main/packages/namespace/README.md)
