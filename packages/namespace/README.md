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

`create()` accepts raw Namespace API fields, merged as-is (snake_case) into the request. `containerOptions` goes into the container's [`ContainerRequest`](https://buf.build/namespace/cloud/docs/main:namespace.cloud.compute.v1beta#namespace.cloud.compute.v1beta.ContainerRequest), and `instanceOptions` into [`CreateInstanceRequest`](https://buf.build/namespace/cloud/docs/main:namespace.cloud.compute.v1beta#namespace.cloud.compute.v1beta.CreateInstanceRequest). Fields the provider sets itself (shape, deadline, container name/args/env) take precedence, and the image is always chosen by `image` (`image_ref`/`known_image_id` in `containerOptions` are ignored).

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

## Standard sizes (local discovery)

`provider.sizes.list()` / `resolve('sm', context?)` declares exact `sm`, `md`, `lg`,
and `xl` CPU/RAM requests for **Linux amd64 only**. `create({ sizeClass: 'sm' })`
requests `instanceOptions.shape.virtual_cpu: 1` and `memory_megabytes: 2048`.
Per-create standard requests override factory CPU/RAM defaults while preserving
other instance options. Combining them with explicit native CPU/RAM fields is an
error, even when the numbers match. Non-Linux/unverified architectures and
`xs`/`2xl` remain `unknown`. Legacy native shape overrides are unchanged.

These are adapter-declared requests based on the documented Linux machine-shape
catalog, not account/region availability checks or observed resources. Discovery
never reads token files or calls Namespace. Successful standardized creates expose
frozen `instance.sizing` request metadata.

Unit boundary: the resolver intentionally sends the canonical MiB number
unchanged to Namespace's `memory_megabytes` field (2048/4096/8192/16384), matching
the adapter's existing binary-sized request convention. This is an explicit
provider API mapping assumption, not an empirical inference from the machine
shape documentation's “GB” labels or a certification of delivered bytes. Factory
CPU/RAM values are defaults overridden by `sizeClass`; explicit per-create
CPU/RAM selectors, including ambiguous aliases, are rejected instead.
