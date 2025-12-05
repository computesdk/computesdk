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

```typescript
import { render } from '@computesdk/render';

const provider = render({
  apiKey: 'your_api_key',
  ownerId: 'your_owner_id'
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