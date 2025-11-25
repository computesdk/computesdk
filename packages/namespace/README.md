# @computesdk/namespace

Namespace provider for ComputeSDK that enables creating and managing containerized compute instances on Namespace's cloud infrastructure.

## Installation

```bash
npm install @computesdk/namespace
```

## Configuration

The Namespace provider requires the following environment variable:

```bash
NSC_TOKEN=your_namespace_token
```

## Usage

```typescript
import { namespace } from '@computesdk/namespace';

const provider = namespace({
  token: 'your_nsc_token',
  virtualCpu: 2,
  memoryMegabytes: 4096,
  documentedPurpose: 'Development sandbox'
});

// Create a sandbox
const sandbox = await provider.sandbox.create({ runtime: 'node' });
console.log(`Created sandbox: ${sandbox.sandboxId}`);

// Get sandbox details
const details = await provider.sandbox.getById(sandbox.sandboxId);
console.log(`Sandbox status:`, details);

// List all sandboxes
const sandboxes = await provider.sandbox.list();
console.log(`Found ${sandboxes.length} sandboxes`);

// Destroy the sandbox
await provider.sandbox.destroy(sandbox.sandboxId);
```

## API Methods

### Sandbox Operations

#### `create(options?: CreateSandboxOptions)`
Creates a new Namespace compute instance with the specified configuration.

**Parameters:**
- `options.runtime` - Runtime environment ('node' | 'python')

**Returns:** `{ sandbox: NamespaceSandbox, sandboxId: string }`

#### `getById(sandboxId: string)`
Retrieves details for a specific sandbox instance.

**Parameters:**
- `sandboxId` - The instance ID to retrieve

**Returns:** `{ sandbox: NamespaceSandbox, sandboxId: string } | null`

#### `list()`
Lists all compute instances in your Namespace account.

**Returns:** `Array<{ sandbox: NamespaceSandbox, sandboxId: string }>`

#### `destroy(sandboxId: string)`
Destroys a compute instance and cleans up resources.

**Parameters:**
- `sandboxId` - The instance ID to destroy

## Configuration Options

### NamespaceConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `token` | `string` | `process.env.NSC_TOKEN` | Namespace API authentication token |
| `virtualCpu` | `number` | `2` | Number of virtual CPU cores |
| `memoryMegabytes` | `number` | `4096` | Memory allocation in MB |
| `machineArch` | `string` | `'amd64'` | Machine architecture |
| `os` | `string` | `'linux'` | Operating system |
| `documentedPurpose` | `string` | `'ComputeSDK sandbox'` | Purpose documentation for the instance |
| `destroyReason` | `string` | `'ComputeSDK cleanup'` | Reason for instance destruction |

## Supported Runtimes

- **node** - Uses `node:alpine` Docker image
- **python** - Uses `python:alpine` Docker image

## Instance Lifecycle

1. **Creation** - Instances are created with specified resource allocation
2. **Container Setup** - Docker containers are automatically provisioned
3. **Startup** - Containers start with a sleep command for 300 seconds
4. **Management** - Full CRUD operations available via API
5. **Cleanup** - Graceful shutdown and resource deallocation

## API Endpoints

The provider uses Namespace's compute API:

- **Base URL:** `https://us.compute.namespaceapis.com`
- **Service:** `namespace.cloud.compute.v1beta.ComputeService`
- **Authentication:** Bearer token

## Error Handling

The provider includes comprehensive error handling:

- **Authentication errors** - Invalid or missing NSC_TOKEN
- **Resource limits** - Quota exceeded or invalid configurations  
- **Network errors** - API connectivity issues
- **Instance errors** - Non-existent or inaccessible instances

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NSC_TOKEN` | Yes | Namespace authentication token |

## Notes

- All operations use Namespace's REST API over HTTPS
- Instance IDs are globally unique within your account
- Resource quotas apply based on your Namespace plan
- Containers start with basic sleep command and can be customized
- Graceful error handling for destroy operations (won't fail if instance already deleted)