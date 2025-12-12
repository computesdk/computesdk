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

```typescript
import { avm } from '@computesdk/avm';

const provider = avm({
  apiKey: 'your_api_key'
});

// Create a sandbox
const sandbox = await provider.sandbox.create({
  name: 'my-sandbox',
  image: 'avmcodes/avm-default-sandbox',
  resources: {
    cpus: 0.25,
    memory: 512
  }
});
console.log(`Created sandbox: ${sandbox.sandboxId}`);

// List all sandboxes
const sandboxes = await provider.sandbox.list();
console.log(`Found ${sandboxes.length} sandboxes`);

// Get sandbox logs by ID
const logs = await provider.sandbox.getById(sandbox.sandboxId);
console.log('Sandbox logs:', logs);

// Destroy the sandbox
await provider.sandbox.destroy(sandbox.sandboxId);
```

## API Reference

### Sandbox Operations

#### `create(options?)`

Creates a new AVM sandbox with the specified configuration.

**Options:**
- `name` (string, optional) - Sandbox name (defaults to `avm-sandbox-{timestamp}`)
- `image` (string, optional) - Docker image to use (defaults to `avmcodes/avm-default-sandbox`)
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
- Default image is `avmcodes/avm-default-sandbox`
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
