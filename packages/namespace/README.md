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

```typescript
import { namespace } from '@computesdk/namespace';

const provider = namespace({
  token: 'your_token'
});

// Create a sandbox
const sandbox = await provider.sandbox.create({ runtime: 'node' });
console.log(`Created sandbox: ${sandbox.sandboxId}`);

// Get sandbox by ID
const retrieved = await provider.sandbox.getById(sandbox.sandboxId);

// List all sandboxes
const sandboxes = await provider.sandbox.list();

// Destroy the sandbox
await provider.sandbox.destroy(sandbox.sandboxId);
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
