# @computesdk/namespace

Namespace provider for ComputeSDK that enables creating and managing containerized sandboxes on Namespace's infrastructure.

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

### Gateway Mode (Recommended)

Use the gateway for zero-config auto-detection:

```typescript
import { compute } from 'computesdk';

// Auto-detects Namespace from NSC_TOKEN environment variable
const sandbox = await compute.sandbox.create();
console.log(`Created sandbox: ${sandbox.id}`);

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy the sandbox
await sandbox.destroy();
```

### Direct Mode

For direct SDK usage without the gateway:

```typescript
import { namespace } from '@computesdk/namespace';

const compute = namespace({
  token: 'your_token'
});

// Create a sandbox
const sandbox = await compute.sandbox.create({ runtime: 'node' });
console.log(`Created sandbox: ${sandbox.id}`);

// List all sandboxes
const sandboxes = await compute.sandbox.list();

// Destroy the sandbox
await sandbox.destroy();
```

## Currently Implemented

### Sandbox Operations
- **create()** - Creates a new Namespace compute instance with container deployment
- **getById()** - Retrieves a specific Namespace instance by ID
- **list()** - Lists all Namespace instances in the account
- **destroy()** - Deletes a Namespace instance

### Configuration Options
- **token** - Namespace API authentication token

## Notes

- Instances are automatically deployed upon creation
- Instance names are generated automatically
- All operations use Namespace's compute API
- Environment variables take precedence over config options
- Instances are immediately deleted when destroyed (no delayed deletion)
