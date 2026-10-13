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

const compute = namespace({
  token: 'your_token'
});

// Create a sandbox
const sandbox = await compute.instances.create();
console.log(`Created sandbox: ${sandbox.instanceId}`);

// List all sandboxes
const sandboxes = await compute.instances.list();

// Destroy the sandbox
await sandbox.destroy();
```

### Passing Namespace API fields through

`create()` accepts raw Namespace API fields, merged as-is (snake_case) into the request. `containerOptions` goes into the container's [`ContainerRequest`](https://buf.build/namespace/cloud/docs/main:namespace.cloud.compute.v1beta#namespace.cloud.compute.v1beta.ContainerRequest), and `instanceOptions` into [`CreateInstanceRequest`](https://buf.build/namespace/cloud/docs/main:namespace.cloud.compute.v1beta#namespace.cloud.compute.v1beta.CreateInstanceRequest). Fields the provider sets itself (shape, deadline, container name/image/args/env) take precedence.

```typescript
// Inject the instance's workload token into the container at /var/run/nsc
const sandbox = await compute.instances.create({
  containerOptions: { nsc_state_path: '/var/run/nsc' },
});
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
