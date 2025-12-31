# @computesdk/avm

AVM provider for ComputeSDK that enables creating and managing containerized sandboxes on AVM's infrastructure.

## Installation

```bash
npm install @computesdk/avm
```

## Configuration

The AVM provider requires the following environment variable:

```bash
AVM_API_KEY=your_avm_api_key
```

You can get your API key from [AVM Sandbox Platform](https://avm.codes/).

## Usage

### Gateway Mode (Recommended)

Use the gateway for zero-config auto-detection:

```typescript
import { compute } from 'computesdk';

// Auto-detects AVM from AVM_API_KEY environment variable
const sandbox = await compute.sandbox.create();
console.log(`Created sandbox: ${sandbox.id}`);

// List all sandboxes
const sandboxes = await compute.sandbox.list();
console.log(`Found ${sandboxes.length} sandboxes`);

// Destroy the sandbox
await sandbox.destroy();
```

### Direct Mode

For direct SDK usage without the gateway:

```typescript
import { avm } from '@computesdk/avm';

const compute = avm({
  apiKey: 'your_api_key'
});

// Create a sandbox
const sandbox = await compute.sandbox.create({
  name: 'my-sandbox',
  image: 'node:alpine',
  resources: {
    cpus: 0.25,
    memory: 512
  }
});
console.log(`Created sandbox: ${sandbox.id}`);

// List all sandboxes
const sandboxes = await compute.sandbox.list();
console.log(`Found ${sandboxes.length} sandboxes`);

// Destroy the sandbox
await sandbox.destroy();
```

## API Reference

### Sandbox Operations

#### `create(options?)`

Creates a new AVM sandbox with the specified configuration.

**Options:**
- `name` (string, optional) - Sandbox name (defaults to `computesdk-{timestamp}`)
- `image` (string, optional) - Docker image to use (defaults to `node:alpine`)
- `resources` (object, optional) - Resource allocation
  - `cpus` (number) - CPU allocation (default: 0.25)
  - `memory` (number) - Memory in MB (default: 512)
- `volumes` (array, optional) - Volume configurations
  - `volume_name` (string) - Name of the volume
  - `mount_path` (string) - Mount path in the container

**Returns:** `Promise<{ sandbox: AVMSandbox, sandboxId: string }>`

#### `getById(sandboxId)`

Retrieves logs for a specific sandbox.

**Parameters:**
- `sandboxId` (string) - The ID of the sandbox

**Returns:** `Promise<{ sandbox: any, sandboxId: string } | null>`

Returns `null` if the sandbox is not found.

#### `list()`

Lists all sandboxes in your AVM account.

**Returns:** `Promise<Array<{ sandbox: AVMSandbox, sandboxId: string }>>`

#### `destroy(sandboxId)`

Deletes a sandbox.

**Parameters:**
- `sandboxId` (string) - The ID of the sandbox to destroy

**Returns:** `Promise<void>`

## Configuration Options

The AVM provider accepts the following configuration:

```typescript
interface AVMConfig {
  apiKey?: string;  // AVM API key (falls back to AVM_API_KEY env var)
}
```

## Sandbox Structure

```typescript
interface AVMSandbox {
  id: string;
  name: string;
  created_at: string;
  cpu: number;
  memory: number;
  status: string;
  volumes?: Array<{
    volume_id: string;
    mount_path: string;
    volume_name: string;
  }>;
}
```

## Currently Implemented

### Sandbox Operations
- **create()** - Creates a new AVM sandbox with Docker container deployment
- **getById()** - Retrieves logs for a specific sandbox
- **list()** - Lists all sandboxes in the account
- **destroy()** - Deletes a sandbox

### Configuration Options
- **apiKey** - AVM API authentication token
- **name** - Custom sandbox name
- **image** - Custom Docker image
- **resources** - CPU and memory allocation
- **volumes** - Volume mount configurations

## Not Yet Implemented

The following methods are planned for future releases:
- `runCode()` - Execute code in the sandbox
- `runCommand()` - Run shell commands
- `getInfo()` - Get sandbox metadata
- `getUrl()` - Get sandbox URL for web access

## Notes

- Sandboxes are created with the specified resource allocation
- Default image is `node:alpine`
- Default resources: 0.25 CPUs, 512 MB memory
- Sandbox names are auto-generated with timestamp if not provided
- All operations use AVM's REST API v1
- Environment variables take precedence over config options
- The `getById()` method returns sandbox logs, not metadata
- Sandboxes are immediately deleted when destroyed

## API Documentation

For more information about the AVM Sandbox Platform API, visit:
- API Docs: https://api.avm.codes/
- Website: https://avm.codes/

## License

MIT
