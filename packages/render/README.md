# @computesdk/render

Render provider for ComputeSDK that enables creating and managing containerized sandboxes on Render's infrastructure.

## Installation

```bash
npm install @computesdk/render
```

## Configuration

The Render provider requires the following environment variables:

```bash
RENDER_API_KEY=your_render_api_key
RENDER_OWNER_ID=your_render_owner_id
```

## Usage

### Gateway Mode (Recommended)

Use the gateway for zero-config auto-detection:

```typescript
import { compute } from 'computesdk';

// Auto-detects Render from RENDER_API_KEY environment variable
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
import { render } from '@computesdk/render';

const compute = render({
  apiKey: 'your_api_key',
  ownerId: 'your_owner_id'
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
- **create()** - Creates a new Render web service with Docker container deployment
- **getById()** - Retrieves a specific Render service by ID
- **list()** - Lists all Render services in the account
- **destroy()** - Deletes a Render service

### Configuration Options
- **apiKey** - Render API authentication token
- **ownerId** - Render owner/account identifier

## Notes

- Services are automatically deployed upon creation with auto-deploy enabled
- Service names are generated with timestamp: `render-sandbox-{timestamp}`
- All operations use Render's REST API v1
- Environment variables take precedence over config options
- Services are immediately deleted when destroyed (no delayed deletion)